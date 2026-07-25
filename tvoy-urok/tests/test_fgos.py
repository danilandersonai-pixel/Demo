"""Тесты модуля ФГОС-соответствия (без ключей и сети).

Главное, что проверяем: соответствие ФГОС у нас ПРОВЕРЯЕМОЕ, а не
декларируемое — реестр детерминированный, находки воспроизводимые.

Запуск:  python -m tests.test_fgos
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fgos.check import brief, check_deck  # noqa: E402
from fgos.registry import (  # noqa: E402
    grade_for_topic,
    load_subject,
    match_sections,
    prompt_layer,
)
from generator.schema import (  # noqa: E402
    Deck,
    Image,
    Layout,
    Meta,
    Paragraph,
    QuizItem,
    Role,
    Slide,
)

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "fixtures", "vasiliy-iii.json")

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


def load_fixture() -> Deck:
    with open(FIXTURE, encoding="utf-8") as f:
        return Deck.model_validate(json.load(f))


def test_registry() -> None:
    print("\n[1] Реестр ФРП")
    spec = load_subject("История России")
    check("предмет найден", spec is not None)
    check("есть 6 и 7 класс", {6, 7} <= set(spec.grades.keys()))
    check("источник указан", "edsoo.ru" in spec.source.get("url", ""))
    check("есть напоминание о редакции", bool(spec.source.get("edition_note")))

    # Регистр и «ё» не должны мешать поиску
    check("предмет ищется без регистра", load_subject("история") is not None)
    check("непокрытый предмет — None", load_subject("Астрономия") is None)

    # Редакция 2025: курс 6 класса доведён до первой трети XVI в., поэтому
    # Василий III — 6 класс (в редакции 2023 был 7-м). Иван IV — 7 класс.
    check("Василий III → 6 класс (ред. 2025)",
          grade_for_topic(spec, "Правление Василия III") == 6,
          str(grade_for_topic(spec, "Правление Василия III")))
    check("Иван III → 6 класс", grade_for_topic(spec, "Иван III и присоединение Новгорода") == 6,
          str(grade_for_topic(spec, "Иван III и присоединение Новгорода")))
    check("Иван IV → 7 класс",
          grade_for_topic(spec, "Иван Грозный и Избранная рада") == 7,
          str(grade_for_topic(spec, "Иван Грозный и Избранная рада")))
    check("неизвестная тема не матчится",
          grade_for_topic(spec, "Квантовая механика") is None)
    check("в источнике отмечен перенос темы между редакциями",
          "2023" in spec.source.get("edition_note", ""))

    matches = match_sections(spec, "Правление Василия III")
    check("раздел найден", matches and "Василий III" in matches[0][0].title, str(matches))


def test_all_subjects() -> None:
    print("\n[1b] Все предметы реестра")
    cases = [
        ("История России", "Правление Василия III", 6),
        ("История", "Древний Египет", 5),
        ("История", "Отечественная война 1812 года", 9),
        ("Биология", "Природные сообщества", 5),
        ("Биология", "Фотосинтез и питание растений", 6),
        ("Окружающий мир", "Природные зоны России", 4),
        ("Окружающий мир", "Символы России", 1),
        ("Обществознание", "Семейный бюджет", 6),
        ("Обществознание", "Права и свободы гражданина", 7),
        ("География", "Великие географические открытия", 5),
        ("География", "Мировой океан и его части", 6),
        ("Физика", "Закон Архимеда и плавание тел", 7),
        ("Физика", "Радиоактивность и строение атома", 9),
        ("Химия", "Периодический закон Менделеева", 8),
        ("Химия", "Металлы и их соединения", 9),
        ("Информатика", "Системы счисления", 8),
        ("Информатика", "Электронные таблицы и базы данных", 9),
        ("Русский язык", "Однокоренные слова", 2),
        ("Русский язык", "Причастный оборот", 7),
        ("Русский язык", "Бессоюзное сложное предложение", 9),
        ("Литература", "Горе от ума Грибоедова", 9),
        ("Литературное чтение", "Былины о богатырях", 3),
        ("Математика", "Доли и площадь прямоугольника", 3),
        ("Математика", "Квадратные уравнения", 8),
        ("Алгебра", "Арифметическая прогрессия", 9),
        ("Геометрия", "Теорема Пифагора", 8),
    ]
    for subject, topic, expected in cases:
        spec = load_subject(subject, expected)
        got = grade_for_topic(spec, topic) if spec else None
        check(f"{subject} {expected} кл.: «{topic}»", got == expected, f"получено {got}")

    # У каждого предмета должны быть источник, УУД и группы результатов
    subjects = ("История", "Биология", "Окружающий мир", "Обществознание", "География",
                "Физика", "Химия", "Информатика", "Русский язык", "Литература",
                "Литературное чтение", "Математика")
    for subject in subjects:
        spec = load_subject(subject)
        ok = (spec is not None
              and spec.source.get("url", "").startswith("https://edsoo.ru")
              and spec.metasubject.get("groups")
              and spec.result_groups)
        check(f"{subject}: справочник заполнен", ok)

    # Предметы с двумя программами: файл выбирается по классу
    prim = load_subject("Русский язык", 2)
    main = load_subject("Русский язык", 7)
    check("русский язык: 2 кл. → программа 1–4", prim is not None and 2 in prim.grades)
    check("русский язык: 7 кл. → программа 5–9", main is not None and 7 in main.grades)
    check("русский язык: это разные программы", prim is not main)
    m3, m8 = load_subject("Математика", 3), load_subject("Математика", 8)
    check("математика: 3 кл. → программа 1–4", m3 is not None and 3 in m3.grades)
    check("математика: 8 кл. → программа 5–9", m8 is not None and 8 in m8.grades)
    check("математика: это разные программы", m3 is not m8)


def test_prompt_layer() -> None:
    print("\n[2] Слой ФГОС для промпта")
    spec = load_subject("История России")
    layer = prompt_layer(spec, 6, "Правление Василия III")
    check("слой не пуст", len(layer) > 500)
    check("есть заголовок слоя", "[СЛОЙ 4" in layer)
    check("есть дидактические единицы", "Отмирание удельной системы" in layer)
    check("есть обязательные даты", "1510" in layer)
    check("есть защита от анахронизма", "Титул царя принят Иваном IV" in layer)
    check("есть запрет терминов", "царская семья" in layer)
    check("есть УУД", "Познавательные УУД" in layer)
    check("есть планируемые результаты", "Работа с исторической картой" in layer)
    # Слой стабилен для пары {предмет, класс} — важно для кэша промпта
    check("слой детерминирован",
          prompt_layer(spec, 6, "Правление Василия III") == layer)


def test_grade_mismatch() -> None:
    print("\n[3] Соответствие темы классу — главная формальная проверка")
    # Фикстура заявлена как 6 класс и по редакции 2025 это верно.
    deck = load_fixture()
    check("фикстура заявлена как 6 класс", deck.meta.grade == 6)
    report = check_deck(deck)
    check("отчёт построен", report is not None)
    check("несоответствия класса нет",
          "grade-mismatch" not in {f.code for f in report.findings},
          str([str(f) for f in report.findings]))

    # А вот тема 7 класса, заявленная как 6-й, должна ловиться.
    wrong = load_fixture()
    wrong.meta.topic = "Иван Грозный и Избранная рада"
    wrong.meta.grade = 6
    rep = check_deck(wrong)
    codes = {f.code for f in rep.findings}
    check("ловит несоответствие класса", "grade-mismatch" in codes, str(codes))
    check("это ошибка, а не предупреждение",
          any(f.code == "grade-mismatch" and f.level == "error" for f in rep.findings))
    check("в тексте указан правильный класс",
          any("7 класс" in f.message for f in rep.findings if f.code == "grade-mismatch"))

    # Тот же дек как 7 класс — несоответствия нет
    wrong.meta.grade = 7
    check("для 7 класса несоответствия нет",
          "grade-mismatch" not in {f.code for f in check_deck(wrong).findings})


def test_coverage() -> None:
    print("\n[4] Охват дидактических единиц и понятий")
    deck = load_fixture()
    report = check_deck(deck)
    check("охват посчитан", 0 < report.coverage_pct <= 100, f"{report.coverage_pct}%")
    check("Псков засчитан", any("Псков" in u for u in report.covered_units))
    check("удельная система засчитана",
          any("удельной системы" in u for u in report.covered_units))
    check("пробел найден: ханства",
          any("ханствами" in u for u in report.missing_units), str(report.missing_units))
    check("обязательные понятия проверены",
          "Псков" in report.covered_terms and "Смоленск" in report.covered_terms)
    check("отчёт печатается", "ОТЧЁТ О СООТВЕТСТВИИ ФГОС" in report.to_text())
    check("в отчёте есть основание",
          "Федеральная рабочая программа" in report.to_text())


def test_anachronism_and_bloom() -> None:
    print("\n[5] Анахронизмы и уровни вопросов")

    base_slides = [
        Slide(role=Role.TITLE, layout=Layout.TITLE_HERO, title="Правление Василия III"),
        Slide(role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT,
              title="Двор государя",
              paragraphs=[Paragraph(
                  text="В царской семье Василия III долго не появлялись наследники.")]),
        Slide(role=Role.SUMMARY, layout=Layout.BULLETS_SUMMARY, title="Итоги",
              bullets=["Псков и Смоленск вошли в состав государства."]),
    ]
    bad = Deck(
        meta=Meta(topic="Правление Василия III", subject="История России", grade=6),
        slides=base_slides,
    )
    report = check_deck(bad)
    codes = {f.code for f in report.findings}
    check("ловит анахронизм «царская семья»", "anachronism" in codes, str(codes))
    check("анахронизм — это ошибка",
          any(f.code == "anachronism" and f.level == "error" for f in report.findings))
    check("ловит отсутствие проверки понимания", "no-quiz" in codes, str(codes))

    # Вопросы только на воспроизведение
    recall_only = Deck(
        meta=Meta(topic="Правление Василия III", subject="История России", grade=6),
        slides=base_slides[:1] + [
            Slide(role=Role.QUIZ, layout=Layout.QUIZ_LIST, title="Проверь себя",
                  quiz=[QuizItem(q="В каком году присоединили Псков?"),
                        QuizItem(q="Кто был отцом Василия III?")]),
        ],
    )
    codes = {f.code for f in check_deck(recall_only).findings}
    check("ловит вопросы только на память", "bloom-recall-only" in codes, str(codes))

    # У фикстуры есть вопрос «почему» — предупреждения быть не должно
    deck = load_fixture()
    codes = {f.code for f in check_deck(deck).findings}
    check("фикстура проходит по уровням вопросов", "bloom-recall-only" not in codes)


def test_brief_for_inspector() -> None:
    print("\n[6] Задание для ФГОС-инспектора (отдельной модели)")
    deck = load_fixture()
    report = check_deck(deck)
    b = brief(deck, report)

    check("есть нормативное основание", bool(b["normative_source"]))
    check("передан чек-лист единиц", bool(b["checklist"]["sections"]))
    check("переданы механические находки", bool(b["mechanical_findings"]))
    check("есть вопросы к модели", len(b["questions_for_model"]) >= 5)
    check("есть вопрос про изображения",
          any("изображени" in q for q in b["questions_for_model"]))
    check("изображения перечислены для осмотра", len(b["images_to_inspect"]) > 5,
          str(len(b["images_to_inspect"])))
    check("у изображения есть промпт и alt",
          all("prompt" in i and "alt" in i for i in b["images_to_inspect"]))
    check("передана верхняя граница периода",
          b["period_bounds"]["period_end_year"] == 1533,
          str(b["period_bounds"]))
    check("brief сериализуется в JSON", bool(json.dumps(b, ensure_ascii=False)))

    # Чувствительные картинки помечены — для маршрутизации мимо OpenAI
    sensitive = [i for i in b["images_to_inspect"] if i["sensitive"]]
    check("чувствительные изображения помечены", len(sensitive) >= 1, str(sensitive))


def test_modes() -> None:
    print("\n[6b] Режимы ФГОС: full / check / off")
    from generator.schema import FgosMode

    check("дефолт — full", load_fixture().meta.fgos_mode == FgosMode.FULL)

    # Дек с анахронизмом: «царская семья» при Василии III
    raw = json.load(open(FIXTURE, encoding="utf-8"))
    raw["slides"][2]["paragraphs"][0]["text"] = (
        "В царской семье Василия III не было наследника долго."
    )
    bad = Deck.model_validate(raw)

    rep_full = check_deck(bad, FgosMode.FULL)
    rep_check = check_deck(bad, FgosMode.CHECK)
    rep_off = check_deck(bad, FgosMode.OFF)

    # Достоверность проверяется во ВСЕХ режимах — это не требование стандарта
    for name, rep in (("full", rep_full), ("check", rep_check), ("off", rep_off)):
        codes = {f.code for f in rep.findings}
        check(f"{name}: анахронизм пойман", "anachronism" in codes, str(codes))
        check(f"{name}: анахронизм остаётся ошибкой",
              any(f.code == "anachronism" and f.level == "error" for f in rep.findings))

    # А проверки программы в OFF отключены
    off_codes = {f.code for f in rep_off.findings}
    check("off: охват не считается", not rep_off.covered_units and not rep_off.missing_units)
    check("off: понятия не проверяются", not rep_off.missing_terms)
    check("off: результаты не проверяются", not rep_off.missing_results)
    check("off: нет программных замечаний", off_codes <= {"anachronism"}, str(off_codes))
    check("off: в отчёте сказано, что программа не проверялась",
          "не проверялось" in rep_off.to_text())

    # В справочном режиме несоответствие класса — предупреждение, не ошибка
    wrong = load_fixture()
    wrong.meta.topic = "Иван Грозный и Избранная рада"
    adv = check_deck(wrong, FgosMode.CHECK)
    check("check: несоответствие класса — предупреждение",
          any(f.code == "grade-mismatch" and f.level == "warn" for f in adv.findings),
          str([str(f) for f in adv.findings]))
    check("check: отчёт помечен справочным", adv.advisory)
    check("check: в тексте отчёта видно, что он не блокирует",
          "ничего не блокирует" in adv.to_text())
    strict = check_deck(wrong, FgosMode.FULL)
    check("full: то же самое — ошибка",
          any(f.code == "grade-mismatch" and f.level == "error" for f in strict.findings))
    check("full: отчёт не справочный", not strict.advisory)

    # Слой промпта: полный / пустой / только достоверность
    spec = load_subject("История России")
    full_layer = prompt_layer(spec, 6, "Правление Василия III", "full")
    check_layer = prompt_layer(spec, 6, "Правление Василия III", "check")
    off_layer = prompt_layer(spec, 6, "Правление Василия III", "off")
    check("слой full — полный", "[СЛОЙ 4" in full_layer and len(full_layer) > 1000)
    check("слой check — пустой (генерацию не ограничиваем)", check_layer == "")
    check("слой off — только достоверность эпохи",
          "[ДОСТОВЕРНОСТЬ ЭПОХИ]" in off_layer and "СЛОЙ 4" not in off_layer)
    check("слой off содержит запрет терминов", "царская семья" in off_layer)
    check("слой off содержит границу периода", "1533" in off_layer)

    # Задание инспектору отражает режим
    b_off = brief(bad, rep_off)
    check("brief(off): режим передан", b_off["fgos_mode"] == "off")
    check("brief(off): нет нормативного основания", b_off["normative_source"] == "")
    check("brief(off): вопросы только про достоверность и возраст",
          not any("дидактическая единица" in q for q in b_off["questions_for_model"]),
          str(b_off["questions_for_model"]))
    check("brief(off): изображения всё равно осматриваются",
          len(b_off["images_to_inspect"]) > 5)
    b_full = brief(bad, rep_full)
    check("brief(full): вопрос про дидактические единицы есть",
          any("дидактическая единица" in q for q in b_full["questions_for_model"]))


def test_uncovered_subject() -> None:
    print("\n[7] Непокрытый предмет не ломает пайплайн")
    deck = Deck(
        meta=Meta(topic="Тема", subject="Астрономия", grade=10),
        slides=[Slide(role=Role.TITLE, layout=Layout.TITLE_HERO, title="Тема")],
    )
    check("возвращает None без исключения", check_deck(deck) is None)


def main() -> int:
    test_registry()
    test_all_subjects()
    test_prompt_layer()
    test_grade_mismatch()
    test_coverage()
    test_anachronism_and_bloom()
    test_brief_for_inspector()
    test_modes()
    test_uncovered_subject()
    print(f"\n{'=' * 46}\nПройдено: {_passed}, провалено: {_failed}")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
