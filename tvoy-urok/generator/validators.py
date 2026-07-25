"""Программные валидаторы — бесплатный эшелон контроля качества до LLM-судьи.

Ловят ровно те дефекты, которые нашлись в реальных деках (анализ, §2.4):
структурные (слайд без заголовка), объёмные (перебор слов), типографские
(двойные пробелы, дефис вместо тире, «Заглавная После Двоеточия», пропуск
«ё»), содержательные (дубли тезисов, потерянные сущности из overview).

Всё, что ловится регэкспом и счётчиком, не должно доходить до платной модели.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Sequence

from .schema import Deck, Role, Slide

# --- Нормы объёма (из анализа, §2.2) --------------------------------------
MAX_WORDS_PER_CONTENT_SLIDE = 80
MIN_WORDS_PER_CONTENT_SLIDE = 35
SENTENCE_WORDS = (8, 16)
TITLE_WORDS = (1, 6)
DEFINITION_WORDS = (8, 35)
CALLOUT_WORDS = (8, 20)

CONTENT_ROLES = {
    Role.CONTENT,
    Role.DEEPDIVE,
    Role.PROCESS,
    Role.OVERVIEW,
    Role.ARTIFACT,
}

# Слова, где «ё» обязательно и «е»-написание однозначно ошибочно.
# Намеренно без пар вроде все/всё — там «е» может быть корректным.
YO_STEMS = [
    "ещё", "её", "счёт", "объём", "приём", "полёт", "чёрн", "тёмн",
    "лёгк", "надёжн", "серьёзн", "актёр", "партнёр", "жёстк", "твёрд",
    "свёкл", "берёз", "остриё", "чётк", "щёк", "сёстр", "звёзд",
]


@dataclass
class Issue:
    """Замечание валидатора."""

    level: str  # "error" — блокирует, "warn" — к сведению
    code: str
    message: str
    slide: Optional[int] = None  # индекс слайда, 0-based

    def __str__(self) -> str:
        where = f"слайд {self.slide + 1}" if self.slide is not None else "дек"
        return f"[{self.level}] {where}: {self.code} — {self.message}"


def _words(text: str) -> List[str]:
    return [w for w in re.split(r"\s+", text.strip()) if w]


def _slide_texts(slide: Slide) -> List[str]:
    """Весь видимый текст слайда — для подсчёта объёма и дедупликации."""
    out: List[str] = [slide.title]
    if slide.subtitle:
        out.append(slide.subtitle)
    out.extend(p.text for p in slide.paragraphs)
    out.extend(slide.bullets)
    if slide.definition:
        out.append(f"{slide.definition.term} — {slide.definition.text}")
    if slide.compare:
        out.extend(slide.compare.left.points)
        out.extend(slide.compare.right.points)
        if slide.compare.verdict:
            out.append(slide.compare.verdict)
    out.extend(f"{i.date} — {i.event}" for i in slide.timeline_items)
    out.extend(q.q for q in slide.quiz)
    if slide.callout:
        out.append(slide.callout)
    return [t for t in out if t]


# --- Типографика ----------------------------------------------------------

def check_typography(text: str, idx: int, where: str) -> List[Issue]:
    issues: List[Issue] = []

    if "  " in text:
        issues.append(Issue("warn", "double-space", f"двойной пробел в {where}", idx))

    # Дефис вместо тире в конструкции «Термин - определение»
    if re.search(r"\S\s-\s\S", text):
        issues.append(
            Issue("warn", "hyphen-as-dash", f"дефис вместо тире в {where}", idx)
        )

    # «Заглавная После Двоеточия» — калька Title Case
    if re.search(r":\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+", text):
        issues.append(
            Issue("warn", "title-case", f"Title Case после двоеточия в {where}", idx)
        )

    # Случайная заглавная в середине предложения
    if re.search(r"(?<=[а-яё]\s)[А-ЯЁ][а-яё]{3,}", text):
        # частые легитимные случаи — имена собственные; поэтому warn, не error
        pass

    for stem in YO_STEMS:
        yeless = stem.replace("ё", "е")
        if re.search(rf"\b{yeless}", text, flags=re.IGNORECASE) and not re.search(
            rf"\b{stem}", text, flags=re.IGNORECASE
        ):
            issues.append(
                Issue("warn", "missing-yo", f"«е» вместо «ё» ({yeless}) в {where}", idx)
            )
            break

    return issues


# --- Слайд ----------------------------------------------------------------

def validate_slide(slide: Slide, idx: int) -> List[Issue]:
    issues: List[Issue] = []

    # Заголовок обязателен на каждом слайде — фикс дефекта оригинала,
    # где 9 из 12 слайдов были без заголовков.
    if not slide.title or not slide.title.strip():
        issues.append(Issue("error", "no-title", "нет заголовка", idx))
    else:
        n = len(_words(slide.title))
        limit = TITLE_WORDS[1] + 4 if slide.role == Role.TITLE else TITLE_WORDS[1]
        if n > limit:
            issues.append(
                Issue("warn", "title-long", f"заголовок {n} слов (норма ≤{limit})", idx)
            )
        # Единая капитализация: Sentence case, не ВСЁ КАПСОМ
        letters = [c for c in slide.title if c.isalpha()]
        if letters and all(c.isupper() for c in letters) and len(letters) > 3:
            issues.append(Issue("warn", "title-caps", "заголовок капсом", idx))

    # Объём контентного слайда
    if slide.role in CONTENT_ROLES:
        total = sum(len(_words(t)) for t in _slide_texts(slide))
        if total > MAX_WORDS_PER_CONTENT_SLIDE:
            issues.append(
                Issue(
                    "error",
                    "slide-too-long",
                    f"{total} слов (норма ≤{MAX_WORDS_PER_CONTENT_SLIDE}) — ретрай слайда",
                    idx,
                )
            )

    # Тезис = одно предложение, 8–16 слов
    for p in slide.paragraphs:
        n = len(_words(p.text))
        if not (SENTENCE_WORDS[0] <= n <= SENTENCE_WORDS[1]):
            issues.append(
                Issue(
                    "warn",
                    "sentence-len",
                    f"тезис {n} слов (норма {SENTENCE_WORDS[0]}–{SENTENCE_WORDS[1]}): «{p.text[:40]}…»",
                    idx,
                )
            )
        if p.text.count(".") > 1:
            issues.append(
                Issue("warn", "multi-sentence", "в тезисе больше одного предложения", idx)
            )
        # bold_terms должны реально встречаться в тексте
        for term in p.bold_terms:
            if term not in p.text:
                issues.append(
                    Issue("warn", "bold-missing", f"bold-термин «{term}» не найден в тезисе", idx)
                )

    if slide.definition:
        n = len(_words(slide.definition.text))
        if not (DEFINITION_WORDS[0] <= n <= DEFINITION_WORDS[1]):
            issues.append(
                Issue(
                    "warn",
                    "definition-len",
                    f"определение {n} слов (норма {DEFINITION_WORDS[0]}–{DEFINITION_WORDS[1]})",
                    idx,
                )
            )

    if slide.callout:
        n = len(_words(slide.callout))
        if not (CALLOUT_WORDS[0] <= n <= CALLOUT_WORDS[1]):
            issues.append(
                Issue("warn", "callout-len", f"callout {n} слов (норма 8–20)", idx)
            )

    # Картинка: текста внутри изображения быть не должно
    if slide.image and slide.image.prompt:
        low = slide.image.prompt.lower()
        for bad in ("надпись", "текст", "подпис", "caption", "text", "label"):
            if bad in low and "без" not in low:
                issues.append(
                    Issue(
                        "warn",
                        "image-text",
                        "промпт картинки просит текст внутри изображения",
                        idx,
                    )
                )
                break
        if slide.image.kind.value != "none" and not slide.image.alt:
            issues.append(Issue("warn", "no-alt", "нет alt-текста у картинки", idx))

    for text in _slide_texts(slide):
        issues.extend(check_typography(text, idx, "тексте"))

    return issues


# --- Дек ------------------------------------------------------------------

def _ngrams(text: str, n: int = 4) -> set:
    w = [x.lower().strip(".,;:!?—–-") for x in _words(text)]
    return {tuple(w[i : i + n]) for i in range(max(0, len(w) - n + 1))}


def validate_deck(deck: Deck) -> List[Issue]:
    issues: List[Issue] = []

    roles = [s.role for s in deck.slides]
    if roles.count(Role.TITLE) != 1:
        issues.append(
            Issue("error", "title-count", f"слайдов-титулов {roles.count(Role.TITLE)}, нужен ровно 1")
        )
    if roles.count(Role.SUMMARY) > 1:
        issues.append(Issue("warn", "summary-count", "больше одного итогового слайда"))
    if Role.SUMMARY not in roles:
        issues.append(Issue("warn", "no-summary", "нет итогового слайда"))
    if deck.slides and deck.slides[0].role != Role.TITLE:
        issues.append(Issue("warn", "title-not-first", "титул не первый слайд"))

    if not (8 <= len(deck.slides) <= 16):
        issues.append(
            Issue("warn", "deck-size", f"{len(deck.slides)} слайдов (норма 8–16)")
        )

    for i, slide in enumerate(deck.slides):
        issues.extend(validate_slide(slide, i))

    # Дедупликация: пересечение 4-грамм между слайдами (анти-дубль факта)
    grams = [
        (i, _ngrams(" ".join(_slide_texts(s)))) for i, s in enumerate(deck.slides)
    ]
    for a in range(len(grams)):
        for b in range(a + 1, len(grams)):
            common = grams[a][1] & grams[b][1]
            if len(common) >= 2:
                sample = " ".join(next(iter(common)))
                issues.append(
                    Issue(
                        "warn",
                        "duplicate-text",
                        f"повтор со слайдом {grams[b][0] + 1}: «{sample}…»",
                        grams[a][0],
                    )
                )

    return issues


def summarize(issues: Sequence[Issue]) -> str:
    errors = [i for i in issues if i.level == "error"]
    warns = [i for i in issues if i.level == "warn"]
    lines = [f"Проверка: {len(errors)} ошибок, {len(warns)} предупреждений"]
    lines.extend(str(i) for i in errors)
    lines.extend(str(i) for i in warns)
    return "\n".join(lines)
