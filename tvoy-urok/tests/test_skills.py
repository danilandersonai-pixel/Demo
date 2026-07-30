"""Тесты навыков и сборки промпта.

Главные риски, за которыми следим:

  1. РАСХОЖДЕНИЕ С КОДОМ. Если в тексте навыка продублировать нормы объёма
     или список ролей слайдов, они через месяц разойдутся с валидатором:
     модель получает одни требования, брак ловится по другим. Тесты ловят
     дублирование чисел в тексте.
  2. ПРОМАХ КЭША. Кэш побайтовый: одна нестабильная деталь в префиксе —
     и экономия 0,1× превращается в полную цену на каждом вызове.
     Проверяем побайтовую воспроизводимость.
  3. ЛИШНЕЕ В ПРОМПТЕ. Каждый блок оплачивается на каждом вызове; роль
     должна получать только то, что ей нужно.

Запуск:  python -m tests.test_skills
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from generator import validators as V  # noqa: E402
from skills.loader import (  # noqa: E402
    ROLES,
    age_profile,
    build_prompt,
    estimate,
    load_skill,
    norms_block,
)

_passed = 0
_failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  ok   {name}")
    else:
        _failed += 1
        print(f"  FAIL {name} {detail}")


def test_skills_load() -> None:
    print("\n[1] Навыки на месте и осмысленного размера")
    for role in ROLES:
        text = load_skill(role)
        check(f"{role}: загружается", bool(text))
        # Навык оплачивается на каждом вызове: слишком длинный — это деньги,
        # слишком короткий — модель недоинструктирована.
        check(f"{role}: размер разумный ({len(text)} симв.)",
              800 < len(text) < 6000, f"{len(text)}")
        check(f"{role}: на русском", bool(re.search(r"[а-яё]", text.lower())))
        check(f"{role}: есть заголовок", text.lstrip().startswith("#"))

    try:
        load_skill("несуществующая-роль")
        check("неизвестная роль отвергается", False)
    except ValueError:
        check("неизвестная роль отвергается", True)


def test_no_drift_with_code() -> None:
    print("\n[2] Навыки не дублируют то, что живёт в коде")
    # Нормы объёма приходят из validators.py — числа не должны быть вшиты
    # в текст навыка, иначе разойдутся при первой же правке норм.
    numbers = {
        str(V.MAX_WORDS_PER_CONTENT_SLIDE),
        str(V.MIN_WORDS_PER_CONTENT_SLIDE),
        f"{V.SENTENCE_WORDS[0]}–{V.SENTENCE_WORDS[1]}",
        f"{V.DEFINITION_WORDS[0]}–{V.DEFINITION_WORDS[1]}",
    }
    for role in ROLES:
        text = load_skill(role)
        leaked = {n for n in numbers if n in text}
        check(f"{role}: нормы не вшиты в текст", not leaked, str(leaked))

    # Схема дека тоже не дублируется: она генерируется из schema.py
    for role in ROLES:
        text = load_skill(role)
        check(f"{role}: схема не скопирована в текст",
              '"type": "object"' not in text and "$defs" not in text)

    # А блок норм, который подставляет загрузчик, наоборот обязан
    # содержать актуальные числа из кода
    nb = norms_block()
    for n in numbers:
        check(f"блок норм содержит {n}", n in nb, nb[:120])


def test_prompt_structure() -> None:
    print("\n[3] Структура промпта")
    blocks = build_prompt("author", "История России", 6, "Правление Василия III",
                          wishes="акцент на Пскове",
                          source_chunks=["Василий III запретил братьям чеканить монету."])
    check("блоков 2–4", 2 <= len(blocks) <= 4, str(len(blocks)))
    check("все блоки — text", all(b["type"] == "text" for b in blocks))

    texts = [b["text"] for b in blocks]
    joined = "\n".join(texts)
    check("навык в промпте", "Навык: автор презентации" in joined)
    check("нормы в промпте", "[НОРМЫ ОБЪЁМА]" in joined)
    check("схема в промпте", "[СХЕМА ОТВЕТА]" in joined)
    check("слой ФГОС в промпте", "[СЛОЙ 4" in joined)
    check("возрастной профиль в промпте", "[ВОЗРАСТНОЙ ПРОФИЛЬ" in joined)
    check("задание в промпте", "[ЗАДАНИЕ]" in joined)
    check("источник в промпте", "[ИСТОЧНИК]" in joined)
    check("пожелания переданы", "акцент на Пскове" in joined)

    # Порядок: стабильное раньше волатильного — условие работы кэша
    check("навык раньше задания", joined.index("Навык: автор") < joined.index("[ЗАДАНИЕ]"))
    check("схема раньше задания", joined.index("[СХЕМА ОТВЕТА]") < joined.index("[ЗАДАНИЕ]"))
    check("ФГОС раньше задания", joined.index("[СЛОЙ 4") < joined.index("[ЗАДАНИЕ]"))

    # Последний блок — волатильный и НЕ кэшируется
    check("последний блок без кэша", "cache_control" not in blocks[-1])
    check("в последнем блоке — задание", "[ЗАДАНИЕ]" in blocks[-1]["text"])
    check("тема не попала в кэшируемую часть",
          all("Правление Василия III" not in b["text"]
              for b in blocks if "cache_control" in b))
    check("источник не попал в кэшируемую часть",
          all("чеканить монету" not in b["text"]
              for b in blocks if "cache_control" in b))


def test_cache_stability() -> None:
    print("\n[4] Кэш: побайтовая воспроизводимость")
    args = dict(subject="История России", grade=6, topic="Правление Василия III")
    a = build_prompt("author", **args, source_chunks=["текст источника"])
    b = build_prompt("author", **args, source_chunks=["текст источника"])
    check("два одинаковых вызова дают одинаковые байты",
          [x["text"] for x in a] == [x["text"] for x in b])

    # Смена волатильной части не должна менять кэшируемый префикс
    c = build_prompt("author", subject="История России", grade=6,
                     topic="Иван III и присоединение Новгорода",
                     source_chunks=["совсем другой источник"])
    cached_a = [x["text"] for x in a if "cache_control" in x]
    cached_c = [x["text"] for x in c if "cache_control" in x]
    check("смена темы не ломает первый кэш-блок",
          cached_a[0] == cached_c[0])

    # В кэшируемой части не должно быть ничего изменчивого во времени
    for blk in [x for x in a if "cache_control" in x]:
        check("в кэше нет дат/времени",
              not re.search(r"\b20\d\d-\d\d-\d\d\b|\b\d\d:\d\d:\d\d\b", blk["text"]))

    # Схема сериализуется с sort_keys — иначе порядок ключей поплывёт
    schema_block = next(x["text"] for x in a if "[СХЕМА ОТВЕТА]" in x["text"])
    again = next(x["text"] for x in b if "[СХЕМА ОТВЕТА]" in x["text"])
    check("схема сериализуется стабильно", schema_block == again)


def test_per_role_needs() -> None:
    print("\n[5] Каждая роль получает только своё")
    common = dict(subject="История России", grade=6, topic="Правление Василия III")

    def joined(role: str) -> str:
        return "\n".join(b["text"] for b in build_prompt(role, **common))

    author = joined("author")
    helper = joined("helper")
    illustrator = joined("illustrator")
    reviewer = joined("reviewer")
    inspector = joined("fgos-inspector")

    check("автор получает схему", "[СХЕМА ОТВЕТА]" in author)
    check("подсобная модель НЕ получает схему", "[СХЕМА ОТВЕТА]" not in helper)
    check("подсобная модель НЕ получает нормы", "[НОРМЫ ОБЪЁМА]" not in helper)
    check("подсобная модель НЕ получает требования ФГОС", "[СЛОЙ 4" not in helper)
    check("подсобная модель знает класс", "[ВОЗРАСТНОЙ ПРОФИЛЬ" in helper)

    check("художник НЕ получает нормы текста", "[НОРМЫ ОБЪЁМА]" not in illustrator)
    check("художник НЕ получает полный ФГОС", "[СЛОЙ 4" not in illustrator)
    check("художник получает границы эпохи",
          "[ДОСТОВЕРНОСТЬ ЭПОХИ]" in illustrator, illustrator[:200])

    check("проверяющий получает границы эпохи", "[ДОСТОВЕРНОСТЬ ЭПОХИ]" in reviewer)
    check("проверяющий НЕ получает полный ФГОС (это дело инспектора)",
          "[СЛОЙ 4" not in reviewer)
    check("инспектор получает полный ФГОС", "[СЛОЙ 4" in inspector)

    # Подсобная модель должна получать заметно меньше автора
    check("подсобной модели промпт втрое короче",
          len(helper) * 3 < len(author), f"{len(helper)} vs {len(author)}")


def test_fgos_modes() -> None:
    print("\n[6] Режимы ФГОС влияют на промпт автора")
    common = dict(subject="История России", grade=6, topic="Правление Василия III")
    full = "\n".join(b["text"] for b in build_prompt("author", **common, fgos_mode="full"))
    check_ = "\n".join(b["text"] for b in build_prompt("author", **common, fgos_mode="check"))
    off = "\n".join(b["text"] for b in build_prompt("author", **common, fgos_mode="off"))

    check("full: требования есть", "[СЛОЙ 4" in full)
    check("check: требования не навязываются", "[СЛОЙ 4" not in check_)
    check("off: требований нет", "[СЛОЙ 4" not in off)
    check("off: границы эпохи остаются", "[ДОСТОВЕРНОСТЬ ЭПОХИ]" in off)
    check("off короче full", len(off) < len(full))


def test_age_profile() -> None:
    print("\n[7] Возрастной профиль")
    p2, p6, p9, p11 = (age_profile(g) for g in (2, 6, 9, 11))
    check("2 класс: короткие предложения", "6–10 слов" in p2)
    check("6 класс: средние", "8–14 слов" in p6)
    check("11 класс: длинные", "10–18 слов" in p11)
    check("профили различаются", len({p2, p6, p9, p11}) == 4)
    check("класс указан в тексте", "6 класс" in p6)
    check("запрет канцелярита во всех", all("канцелярит" in p for p in (p2, p6, p9, p11)))


def test_response_contracts() -> None:
    print("\n[8b] Контракт ответа у каждой роли")
    common = dict(subject="История России", grade=6, topic="Правление Василия III")

    def joined(role: str, **kw) -> str:
        return "\n".join(b["text"] for b in build_prompt(role, **common, **kw))

    author, reviewer = joined("author"), joined("reviewer")
    inspector = joined("fgos-inspector")

    # Автор возвращает дек — ему схема как СХЕМА ОТВЕТА
    check("автору схема подана как схема ответа", "[СХЕМА ОТВЕТА]" in author)
    # Проверяющий и инспектор дек НЕ возвращают: подать им ту же схему как
    # «схему ответа» — значит потребовать вернуть дек вместо отчёта
    for name, txt in (("проверяющий", reviewer), ("инспектор", inspector)):
        check(f"{name}: схема подана как справочная", "[СХЕМА ДЕКА]" in txt)
        check(f"{name}: не требуют вернуть дек", "[СХЕМА ОТВЕТА]" not in txt)
        check(f"{name}: сказано, что формат задаёт вызов",
              "задаётся отдельно вызывающей стороной" in txt)

    # Нормы и возрастной профиль не должны противоречить друг другу
    for grade in (2, 6, 9):
        txt = "\n".join(b["text"] for b in build_prompt(
            "author", subject="История России", grade=grade, topic="Тема"))
        check(f"{grade} кл.: коридор норм и цель не спорят",
              "целевую длину бери из возрастного профиля" in txt)

    # Инспектор в справочном режиме без требований бесполезен
    adv = joined("fgos-inspector", fgos_mode="check")
    check("инспектор получает требования и в справочном режиме",
          "[СЛОЙ 4" in adv)
    author_adv = joined("author", fgos_mode="check")
    check("а автору в справочном режиме их по-прежнему не навязывают",
          "[СЛОЙ 4" not in author_adv)


def test_uncovered_subject() -> None:
    print("\n[8] Непокрытый предмет не ломает сборку")
    blocks = build_prompt("author", "Астрономия", 10, "Чёрные дыры")
    joined = "\n".join(b["text"] for b in blocks)
    check("промпт собрался", len(blocks) >= 2)
    check("навык на месте", "Навык: автор презентации" in joined)
    check("слоя ФГОС нет", "[СЛОЙ 4" not in joined)
    check("возрастной профиль есть", "[ВОЗРАСТНОЙ ПРОФИЛЬ" in joined)

    # Без источника — честное указание, а не молчание
    check("без источника сказано прямо", "Не предоставлен" in joined)
    check("велено не выдумывать цитаты", "source_quote" in joined)


def test_estimate() -> None:
    print("\n[9] Оценка размера")
    blocks = build_prompt("author", "История России", 6, "Правление Василия III",
                          source_chunks=["источник"])
    e = estimate(blocks)
    check("считает кэш и горячее", e["cached_chars"] > 0 and e["fresh_chars"] > 0)
    check("сумма сходится", e["cached_chars"] + e["fresh_chars"] == e["total_chars"])
    # Ради этого всё и затевалось
    check("кэшируется больше 90% промпта автора",
          e["cached_chars"] / e["total_chars"] > 0.9,
          f"{100 * e['cached_chars'] // e['total_chars']}%")


def main() -> int:
    test_skills_load()
    test_no_drift_with_code()
    test_prompt_structure()
    test_cache_stability()
    test_per_role_needs()
    test_fgos_modes()
    test_age_profile()
    test_response_contracts()
    test_uncovered_subject()
    test_estimate()
    print(f"\n{'=' * 46}\nПройдено: {_passed}, провалено: {_failed}")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
