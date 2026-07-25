"""Проверка дека на соответствие ФГОС + отчёт учителю.

Разделение труда, принципиальное для продукта:

  1) РЕЕСТР (registry.py) — детерминированный. Текст стандарта нормативный,
     его нельзя «вспоминать» моделью: спросишь у LLM «что требует ФГОС по
     истории в 7 классе» — получишь правдоподобную выдумку. Реестр даёт
     чек-лист как данность.

  2) МЕХАНИЧЕСКИЕ ПРОВЕРКИ (этот модуль) — бесплатные и точные: соответствие
     темы классу, наличие обязательных терминов и дат, запрет анахронизмов,
     охват планируемых результатов по типам слайдов, уровни вопросов.

  3) ФГОС-ИНСПЕКТОР (отдельная модель, подключается с ключами) — судит то,
     что регэкспом не проверить: раскрыта ли дидактическая единица по смыслу,
     педагогически ли выстроен урок, нет ли анахронизмов НА КАРТИНКАХ
     (нужна модель со зрением). Для него здесь готовится задание — `brief()`.

Пункты 1 и 2 работают без ключей и уже дают проверяемое «соответствие ФГОС»,
а не декларацию. Пункт 3 добавляет семантику поверх.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from generator.schema import Deck, Role

from .registry import (
    Section,
    SubjectSpec,
    load_subject,
    match_sections,
    term_present,
)

# Глаголы уровней познавательной деятельности (упрощённая таксономия Блума).
_BLOOM_RECALL = ["когда", "в каком году", "кто", "как назывался", "назови", "перечисли"]
_BLOOM_HIGHER = ["почему", "зачем", "как повлия", "сравни", "объясни", "докажи",
                 "чем отлич", "к чему привел", "какое значение", "в чём смысл",
                 "в чем смысл", "что изменилось"]


@dataclass
class FgosFinding:
    level: str  # error | warn | info
    code: str
    message: str
    slide: Optional[int] = None

    def __str__(self) -> str:
        where = f"слайд {self.slide + 1}" if self.slide is not None else "дек"
        return f"[{self.level}] {where}: {self.code} — {self.message}"


@dataclass
class FgosReport:
    """Отчёт о соответствии — то, что видит учитель и может приложить к уроку."""

    subject: str
    grade: int
    topic: str
    source_document: str = ""
    matched_sections: List[Section] = field(default_factory=list)
    findings: List[FgosFinding] = field(default_factory=list)
    covered_units: List[str] = field(default_factory=list)
    missing_units: List[str] = field(default_factory=list)
    covered_results: Dict[str, str] = field(default_factory=dict)
    missing_results: Dict[str, str] = field(default_factory=dict)
    covered_terms: List[str] = field(default_factory=list)
    missing_terms: List[str] = field(default_factory=list)
    missing_dates: List[str] = field(default_factory=list)

    @property
    def errors(self) -> List[FgosFinding]:
        return [f for f in self.findings if f.level == "error"]

    @property
    def coverage_pct(self) -> int:
        total = len(self.covered_units) + len(self.missing_units)
        return round(100 * len(self.covered_units) / total) if total else 0

    def to_text(self) -> str:
        out: List[str] = []
        out.append("ОТЧЁТ О СООТВЕТСТВИИ ФГОС")
        out.append("=" * 46)
        out.append(f"Предмет: {self.subject}, {self.grade} класс")
        out.append(f"Тема: {self.topic}")
        if self.source_document:
            out.append(f"Основание: {self.source_document}")
        if self.matched_sections:
            out.append("\nРазделы ФРП:")
            for s in self.matched_sections:
                out.append(f"  • {s.title} ({s.grade} класс)")

        out.append(f"\nОхват дидактических единиц: {self.coverage_pct}%")
        for u in self.covered_units:
            out.append(f"  [+] {u}")
        for u in self.missing_units:
            out.append(f"  [ ] {u}")

        if self.covered_results or self.missing_results:
            out.append("\nПланируемые результаты:")
            for title in self.covered_results.values():
                out.append(f"  [+] {title}")
            for title in self.missing_results.values():
                out.append(f"  [ ] {title}")

        if self.covered_terms or self.missing_terms:
            out.append("\nОбязательные понятия:")
            for t in self.covered_terms:
                out.append(f"  [+] {t}")
            for t in self.missing_terms:
                out.append(f"  [ ] {t}")
        if self.missing_dates:
            out.append(f"\nОтсутствуют обязательные даты: {', '.join(self.missing_dates)}")

        if self.findings:
            out.append("\nЗамечания:")
            for f in self.findings:
                out.append(f"  {f}")
        else:
            out.append("\nЗамечаний нет.")
        return "\n".join(out)


def _deck_text(deck: Deck) -> str:
    parts: List[str] = [deck.meta.topic]
    for s in deck.slides:
        parts.append(s.title)
        if s.subtitle:
            parts.append(s.subtitle)
        parts.extend(p.text for p in s.paragraphs)
        parts.extend(s.bullets)
        if s.definition:
            parts.append(f"{s.definition.term} {s.definition.text}")
        if s.compare:
            parts.extend(s.compare.left.points + s.compare.right.points)
            parts.append(s.compare.left.label)
            parts.append(s.compare.right.label)
            if s.compare.verdict:
                parts.append(s.compare.verdict)
        parts.extend(f"{i.date} {i.event}" for i in s.timeline_items)
        parts.extend(q.q for q in s.quiz)
        if s.callout:
            parts.append(s.callout)
    return " ".join(p for p in parts if p)


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", t.lower().replace("ё", "е")).strip()


# Поиск по основам слов — общий с реестром (см. registry.stem/term_present).
_term_present = term_present


def _unit_covered(unit: str, text_norm: str) -> bool:
    """Единица считается раскрытой, если в деке есть её значимые слова.

    Механическая эвристика: берём слова длиннее 4 символов, требуем >=60%
    попаданий. Смысловую оценку («раскрыта ли по существу») делает
    ФГОС-инспектор — см. brief().
    """
    words = [w for w in re.findall(r"[а-яa-z0-9]+", _norm(unit)) if len(w) > 4]
    if not words:
        return False
    hits = sum(1 for w in words if w[:6] in text_norm)
    return hits / len(words) >= 0.6


def check_deck(deck: Deck) -> Optional[FgosReport]:
    """Проверить дек. None — предмет не покрыт реестром."""
    spec: Optional[SubjectSpec] = load_subject(deck.meta.subject)
    if not spec:
        return None

    report = FgosReport(
        subject=deck.meta.subject,
        grade=deck.meta.grade,
        topic=deck.meta.topic,
        source_document=spec.source.get("document", ""),
    )

    if spec.revision_stale():
        report.findings.append(
            FgosFinding("warn", "frp-revision",
                        "пора сверить редакцию ФРП с действующей на edsoo.ru "
                        f"({spec.source.get('edition_note', '')})")
        )

    text_norm = _norm(_deck_text(deck))
    matches = match_sections(spec, deck.meta.topic)

    if not matches:
        report.findings.append(
            FgosFinding("warn", "topic-unmatched",
                        "тема не сопоставлена ни с одним разделом ФРП — "
                        "проверить формулировку темы")
        )
        return report

    report.matched_sections = [s for s, _ in matches]

    # 1. Тема ↔ класс. Главная формальная проверка.
    best = matches[0][0]
    if best.grade != deck.meta.grade:
        gs = spec.grade_spec(best.grade)
        note = gs.boundary_note if gs else ""
        report.findings.append(
            FgosFinding(
                "error",
                "grade-mismatch",
                f"тема «{deck.meta.topic}» отнесена ФРП к {best.grade} классу "
                f"(раздел «{best.title}»), а дек заявлен как {deck.meta.grade} класс. {note}",
            )
        )

    # 2. Охват дидактических единиц раздела.
    for section in report.matched_sections:
        for unit in section.units:
            if _unit_covered(unit, text_norm):
                report.covered_units.append(unit)
            else:
                report.missing_units.append(unit)

    # 3. Обязательные понятия и даты.
    for section in report.matched_sections:
        for term in section.required_terms:
            (report.covered_terms if _term_present(term, text_norm)
             else report.missing_terms).append(term)
        for date in section.required_dates:
            if date not in text_norm:
                report.missing_dates.append(date)
    if report.missing_terms:
        report.findings.append(
            FgosFinding("warn", "missing-terms",
                        f"не раскрыты обязательные понятия: {', '.join(report.missing_terms)}")
        )
    if report.missing_dates:
        report.findings.append(
            FgosFinding("warn", "missing-dates",
                        f"нет обязательных дат: {', '.join(report.missing_dates)}")
        )

    # 4. Анахронизмы — запрещённая для периода терминология.
    for section in report.matched_sections:
        guard = section.anachronism_guard
        if not guard:
            continue
        for bad in guard.get("forbidden_terms", []):
            if _term_present(bad, text_norm):
                report.findings.append(
                    FgosFinding("error", "anachronism",
                                f"анахронизм «{bad}»: {guard.get('comment', '')}")
                )

    # 5. Покрытие планируемых результатов типами слайдов.
    gs = spec.grade_spec(deck.meta.grade) or spec.grade_spec(best.grade)
    roles_present = {s.role for s in deck.slides}
    has_source_quotes = any(p.source_quote for s in deck.slides for p in s.paragraphs)
    if gs:
        role_values = {r.value for r in roles_present}
        for group in gs.subject_results:
            code = group.get("code", "")
            rg = spec.result_groups.get(code)
            if not rg:
                continue
            covered = bool(role_values & set(rg.evidence_roles))
            if rg.evidence_source_quote and has_source_quotes:
                covered = True
            if covered:
                report.covered_results[code] = rg.title
            else:
                report.missing_results[code] = f"{rg.title} — нет: {rg.evidence_hint}"

    # 6. Уровни вопросов: не только «вспомнить».
    quizzes = [q.q for s in deck.slides for q in s.quiz]
    if not quizzes:
        report.findings.append(
            FgosFinding("warn", "no-quiz",
                        "нет слайда проверки понимания — планируемые результаты "
                        "не проверяются на уроке")
        )
    else:
        higher = [q for q in quizzes if any(m in _norm(q) for m in _BLOOM_HIGHER)]
        if not higher:
            report.findings.append(
                FgosFinding("warn", "bloom-recall-only",
                            "все вопросы — на воспроизведение; нужен минимум один "
                            "на понимание/применение (почему, сравни, объясни)")
            )

    # 7. Домашнее задание — обязательный элемент методической полноты.
    if Role.HOMEWORK not in roles_present:
        report.findings.append(
            FgosFinding("info", "no-homework", "нет слайда с домашним заданием")
        )

    return report


def brief(deck: Deck, report: FgosReport) -> dict:
    """Задание для ФГОС-инспектора (отдельной модели).

    Механика уже отработала; модели остаётся то, что требует суждения:
      • раскрыта ли дидактическая единица ПО СМЫСЛУ, а не по совпадению слов;
      • методическая логика урока (от общего к частному, вывод на месте);
      • соответствие лексики возрасту;
      • анахронизмы и достоверность НА ИЗОБРАЖЕНИЯХ — требует модели со
        зрением; проверяются и промпты, и результат генерации.

    Возвращает структуру, которую пайплайн отдаст модели вместе с деком.
    """
    return {
        "task": "Проверить соответствие презентации требованиям ФГОС",
        "subject": deck.meta.subject,
        "grade": deck.meta.grade,
        "topic": deck.meta.topic,
        "normative_source": report.source_document,
        "checklist": {
            "sections": [
                {"title": s.title, "grade": s.grade, "units": s.units}
                for s in report.matched_sections
            ],
            "units_mechanically_covered": report.covered_units,
            "units_to_verify_semantically": report.missing_units,
            "planned_results_not_evidenced": list(report.missing_results.values()),
            "anachronism_guards": [
                s.anachronism_guard for s in report.matched_sections if s.anachronism_guard
            ],
        },
        "mechanical_findings": [str(f) for f in report.findings],
        "questions_for_model": [
            "Раскрыта ли каждая дидактическая единица по существу (не по совпадению слов)?",
            "Соответствует ли лексика и длина предложений заявленному классу?",
            "Выстроен ли урок методически: общее перед частным, вывод в конце блока?",
            "Есть ли фактические ошибки или анахронизмы в тексте?",
            "Есть ли анахронизмы или недостоверность на изображениях "
            "(предметы, одежда, архитектура, символика позже периода темы)?",
            "Проверяют ли вопросы планируемые результаты, а не только память?",
        ],
        "images_to_inspect": [
            {
                "slide": i,
                "title": s.title,
                "prompt": s.image.prompt,
                "alt": s.image.alt,
                "path": s.image.path,
                "sensitive": s.image.sensitive,
            }
            for i, s in enumerate(deck.slides)
            if s.image and s.image.kind.value != "none"
        ],
        "period_bounds": {
            "note": "Изображения и терминология не должны содержать реалий позже указанного года",
            "period_end_year": next(
                (s.anachronism_guard.get("period_end_year")
                 for s in report.matched_sections
                 if s.anachronism_guard and s.anachronism_guard.get("period_end_year")),
                None,
            ),
        },
    }
