"""Сборка промпта из навыка роли + схемы + слоя ФГОС + запроса.

Порядок блоков — по убыванию стабильности. Это не эстетика, а условие
работы кэша: он префиксный и побайтовый, поэтому любое изменение
инвалидирует весь хвост после него. Волатильное (тема, пожелания, источник)
идёт последним и не кэшируется.

Экономика: чтение кэша ≈ 0,1× от цены входа. Стабильная часть у нас — это
навык (2–4 КБ) + JSON-схема дека (12 КБ) + слой ФГОС (до 4 КБ), то есть
основной объём входа. Без кэша за него платят полную цену на каждом вызове.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any, Dict, List, Optional, Sequence

from generator import validators as V
from generator.schema import json_schema

SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))

ROLES = ("author", "reviewer", "fgos-inspector", "illustrator", "helper")

# Что каждой роли реально нужно в промпте. Лишний блок — это деньги на
# каждом вызове: подсобной модели незачем знать требования программы, а
# художнику — нормы объёма текста.
#
# fgos: "full" — весь слой требований (роль отвечает за соответствие);
#       "era"  — только границы эпохи и запрет анахронизмов (роль отвечает
#                за достоверность, но не за программу);
#       None   — не нужен вовсе.
_NEEDS: Dict[str, Dict[str, Any]] = {
    "author":         {"norms": True,  "schema": True,  "fgos": "full", "age": True},
    "reviewer":       {"norms": True,  "schema": True,  "fgos": "era",  "age": True},
    "fgos-inspector": {"norms": True,  "schema": True,  "fgos": "full", "age": True},
    "illustrator":    {"norms": False, "schema": False, "fgos": "era",  "age": False},
    "helper":         {"norms": False, "schema": False, "fgos": None,   "age": True},
}

# Минимальная длина кэшируемого префикса у Claude — 1024 токена (Sonnet 5,
# Opus 4.8) и 4096 (Haiku 4.5). Короче — молча не кэшируется, ставить
# breakpoint бессмысленно. Считаем грубо: ~3 символа на токен для русского.
_MIN_CACHEABLE_CHARS = 1024 * 3


@lru_cache(maxsize=16)
def load_skill(role: str) -> str:
    """Текст навыка роли. Кэшируется в процессе — файл читается один раз."""
    if role not in ROLES:
        raise ValueError(f"неизвестная роль: {role}; доступны: {', '.join(ROLES)}")
    path = os.path.join(SKILLS_DIR, f"{role}.md")
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def norms_block() -> str:
    """Нормы объёма — из того же модуля, который потом их проверяет.

    Дублировать числа в тексте навыка нельзя: разойдутся с валидатором, и
    модель будет получать одни требования, а брак ловиться по другим.
    """
    lo, hi = V.SENTENCE_WORDS
    tlo, thi = V.TITLE_WORDS
    dlo, dhi = V.DEFINITION_WORDS
    clo, chi = V.CALLOUT_WORDS
    return (
        "[НОРМЫ ОБЪЁМА]\n"
        f"Содержательный слайд: {V.MIN_WORDS_PER_CONTENT_SLIDE}–"
        f"{V.MAX_WORDS_PER_CONTENT_SLIDE} слов суммарно.\n"
        f"Тезис: одно предложение, {lo}–{hi} слов. До 6 тезисов на слайд.\n"
        f"Заголовок слайда: {tlo}–{thi} слов, обязателен на каждом слайде.\n"
        f"Определение термина: {dlo}–{dhi} слов, формат «Термин — определение».\n"
        f"Вывод-callout: {clo}–{chi} слов.\n"
        f"Выделений bold на слайд: 2–4, каждое дословно есть в тексте.\n"
        f"Слайдов в деке: 8–16."
    )


def age_profile(grade: int) -> str:
    """Возрастной профиль класса — слой 2 пятислойного промпта.

    Стабилен для класса, поэтому идёт в кэшируемую часть вместе со слоем ФГОС.
    """
    if grade <= 4:
        age, sent, lex = "7–10 лет", "6–10 слов", (
            "только бытовая лексика; каждое новое слово объясняется сразу же "
            "простым примером; абстракций избегать, опираться на наблюдение"
        )
    elif grade <= 6:
        age, sent, lex = "11–13 лет", "8–14 слов", (
            "простая лексика; термины вводятся через определение; допустимы "
            "простые причинно-следственные связи"
        )
    elif grade <= 8:
        age, sent, lex = "13–15 лет", "8–16 слов", (
            "учебная лексика предмета; термины уже знакомые можно не "
            "объяснять; уместны сравнения и обобщения"
        )
    else:
        age, sent, lex = "15–17 лет", "10–18 слов", (
            "полноценная терминология предмета; уместны анализ, оценка "
            "разных точек зрения, работа с источником"
        )
    return (
        f"[ВОЗРАСТНОЙ ПРОФИЛЬ: {grade} класс]\n"
        f"Аудитория: {grade} класс ({age}). Предложения по {sent}.\n"
        f"Лексика: {lex}.\n"
        "Не использовать канцелярит и оценочные эпитеты."
    )


def _block(text: str, cache: bool = False, ttl: Optional[str] = None) -> Dict[str, Any]:
    b: Dict[str, Any] = {"type": "text", "text": text}
    if cache and len(text) >= _MIN_CACHEABLE_CHARS:
        cc: Dict[str, str] = {"type": "ephemeral"}
        if ttl:
            cc["ttl"] = ttl
        b["cache_control"] = cc
    return b


def build_prompt(
    role: str,
    subject: str,
    grade: int,
    topic: str,
    *,
    fgos_mode: str = "full",
    wishes: str = "",
    source_chunks: Sequence[str] = (),
    include_schema: bool = True,
    extra: str = "",
    cache_ttl: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Собрать system-блоки для Messages API.

    Возвращает список content-блоков с расставленным `cache_control`.
    Волатильная часть (тема, пожелания, источник) идёт последней и без кэша.

    `cache_ttl="1h"` — для пакетной прегенерации, когда между вызовами
    проходит больше 5 минут. Запись в кэш при этом дороже (2× вместо 1,25×),
    поэтому по умолчанию не включаем.
    """
    needs = _NEEDS[role] if role in _NEEDS else _NEEDS["helper"]
    blocks: List[Dict[str, Any]] = []

    # --- Блок 1: навык + нормы + схема. Меняется только с релизом. ---
    stable: List[str] = [load_skill(role)]
    if needs["norms"]:
        stable.append(norms_block())
    if include_schema and needs["schema"]:
        stable.append(
            "[СХЕМА ОТВЕТА]\nВерни строго JSON по этой схеме:\n"
            # sort_keys — иначе порядок ключей поплывёт между запусками
            # и побайтовый кэш будет промахиваться на ровном месте.
            + json.dumps(json_schema(), ensure_ascii=False, sort_keys=True)
        )
    # --- Блок 2: ФГОС + возрастной профиль. Стабильны для {предмет, класс}. ---
    contextual: List[str] = []
    if needs["fgos"]:
        # Роль, отвечающая только за достоверность, получает лишь границы
        # эпохи. Роль, отвечающая за соответствие, — весь слой, но не строже
        # режима, который выбрал учитель.
        mode = "off" if needs["fgos"] == "era" else fgos_mode
        layer = _fgos_layer(subject, grade, topic, mode)
        if layer:
            contextual.append(layer)
    if needs["age"]:
        contextual.append(age_profile(grade))

    # Короткий блок не кэшируется провайдером (минимум ~1024 токена), поэтому
    # отдельным блоком он лишь усложняет запрос — приклеиваем к первому.
    joined_ctx = "\n\n".join(contextual)
    if joined_ctx and len(joined_ctx) < _MIN_CACHEABLE_CHARS:
        stable.append(joined_ctx)
        joined_ctx = ""
    blocks.append(_block("\n\n".join(stable), cache=True, ttl=cache_ttl))
    if joined_ctx:
        blocks.append(_block(joined_ctx, cache=True, ttl=cache_ttl))

    # --- Блок 3: волатильное. Своё на каждый запрос, не кэшируется. ---
    volatile = [f"[ЗАДАНИЕ]\nПредмет: {subject}. Класс: {grade}. Тема: «{topic}»."]
    if wishes:
        volatile.append(f"Пожелания учителя: {wishes}")
    if extra:
        volatile.append(extra)
    if source_chunks:
        numbered = "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(source_chunks))
        volatile.append(f"[ИСТОЧНИК]\n{numbered}")
    else:
        volatile.append(
            "[ИСТОЧНИК]\nНе предоставлен. Опирайся только на общепризнанные "
            "факты школьного курса; source_quote оставляй пустым."
        )
    blocks.append(_block("\n\n".join(volatile), cache=False))

    return blocks


def _fgos_layer(subject: str, grade: int, topic: str, mode: str) -> str:
    """Слой требований ФГОС. Пустой, если предмет не покрыт или режим check."""
    try:
        from fgos.registry import load_subject, prompt_layer
    except ImportError:
        return ""
    spec = load_subject(subject, grade)
    if not spec:
        return ""
    return prompt_layer(spec, grade, topic, mode)


def estimate(blocks: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    """Грубая оценка размера промпта: сколько символов кэшируется, сколько нет.

    Токены не считаем — точный счёт даёт только count_tokens провайдера,
    и у Sonnet 5 свой токенайзер (тот же текст даёт примерно на 30% больше
    токенов, чем на прежних моделях). Здесь важно соотношение, а не абсолют.
    """
    cached = sum(len(b["text"]) for b in blocks if "cache_control" in b)
    fresh = sum(len(b["text"]) for b in blocks if "cache_control" not in b)
    return {"cached_chars": cached, "fresh_chars": fresh, "total_chars": cached + fresh}
