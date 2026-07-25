"""Реестр ФГОС: детерминированная выборка требований по {предмет, класс, тема}.

Это «слой 4» пятислойного промпта (см. presentation-generation-analysis.md,
§4.2) и одновременно источник истины для проверки готового дека.

Почему детерминированный реестр, а не «спроси у LLM про ФГОС»: требования
стандарта — нормативный текст, его нельзя галлюцинировать. Модель получает
выдержку как данность и обязана на неё опираться.

Источник данных — федеральные рабочие программы (ФРП) с edsoo.ru. С 2023 г.
именно ФРП, а не примерные программы, являются нормативной основой; ФРП
регулярно правятся приказами Минпросвещения, поэтому у каждого файла данных
есть блок `source` с датой извлечения и напоминанием о сверке редакции.
"""

from __future__ import annotations

import datetime
import json
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# Файл данных на предмет. Расширяется по мере добавления предметов.
_SUBJECT_FILES = {
    "история": "istoriya-5-9.json",
    "история россии": "istoriya-5-9.json",
    "всеобщая история": "istoriya-5-9.json",
}


@dataclass
class Section:
    """Раздел содержания ФРП — «дидактическая единица» темы."""

    code: str
    title: str
    keywords: List[str]
    units: List[str]
    required_terms: List[str] = field(default_factory=list)
    required_dates: List[str] = field(default_factory=list)
    anachronism_guard: Optional[dict] = None
    grade: int = 0


@dataclass
class GradeSpec:
    grade: int
    period: str
    boundary_note: str
    subject_results: List[dict]
    sections: List[Section]


@dataclass
class SubjectSpec:
    subject: str
    source: dict
    metasubject: dict
    grades: Dict[int, GradeSpec]

    def grade_spec(self, grade: int) -> Optional[GradeSpec]:
        return self.grades.get(grade)

    def all_sections(self) -> List[Section]:
        out: List[Section] = []
        for g in self.grades.values():
            out.extend(g.sections)
        return out

    def revision_stale(self, today: Optional[datetime.date] = None) -> bool:
        """Пора ли сверить редакцию ФРП с действующей."""
        due = self.source.get("revision_check_due")
        if not due:
            return False
        today = today or datetime.date.today()
        try:
            return today >= datetime.date.fromisoformat(due)
        except ValueError:
            return False


def _normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    return re.sub(r"\s+", " ", text).strip()


@lru_cache(maxsize=8)
def load_subject(subject: str) -> Optional[SubjectSpec]:
    """Загрузить реестр по названию предмета. None — предмет не покрыт."""
    fname = _SUBJECT_FILES.get(_normalize(subject).replace("е", "е"))
    if not fname:
        fname = _SUBJECT_FILES.get(_normalize(subject))
    if not fname:
        return None
    path = os.path.join(DATA_DIR, fname)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    grades: Dict[int, GradeSpec] = {}
    for g_str, g in raw.get("grades", {}).items():
        grade = int(g_str)
        sections = [
            Section(
                code=s["code"],
                title=s["title"],
                keywords=s.get("keywords", []),
                units=s.get("units", []),
                required_terms=s.get("required_terms", []),
                required_dates=s.get("required_dates", []),
                anachronism_guard=s.get("anachronism_guard"),
                grade=grade,
            )
            for s in g.get("sections", [])
        ]
        grades[grade] = GradeSpec(
            grade=grade,
            period=g.get("period", ""),
            boundary_note=g.get("boundary_note", ""),
            subject_results=g.get("subject_results", []),
            sections=sections,
        )

    return SubjectSpec(
        subject=raw.get("subject", subject),
        source=raw.get("source", {}),
        metasubject=raw.get("metasubject", {}),
        grades=grades,
    )


def match_sections(spec: SubjectSpec, topic: str, limit: int = 3) -> List[Tuple[Section, int]]:
    """Найти разделы ФРП, к которым относится тема. Возвращает (раздел, вес).

    Матчинг по ключевым словам раздела: нормализуем регистр и «ё», считаем
    попадания. Это намеренно простой и предсказуемый механизм — реестр
    нормативный, «догадки» здесь неуместны.
    """
    t = _normalize(topic)
    scored: List[Tuple[Section, int]] = []
    for section in spec.all_sections():
        score = sum(1 for kw in section.keywords if _normalize(kw) in t)
        if score:
            scored.append((section, score))
    scored.sort(key=lambda x: (-x[1], x[0].grade))
    return scored[:limit]


def grade_for_topic(spec: SubjectSpec, topic: str) -> Optional[int]:
    """Класс, к которому ФРП относит тему (по лучшему совпадению)."""
    matches = match_sections(spec, topic, limit=1)
    return matches[0][0].grade if matches else None


def prompt_layer(spec: SubjectSpec, grade: int, topic: str) -> str:
    """Собрать «СЛОЙ 4 — ТРЕБОВАНИЯ ФГОС» для промпта генерации.

    Возвращает готовый текстовый блок: период курса, планируемые результаты,
    дидактические единицы темы, обязательные термины и даты, запрет
    анахронизмов. Этот блок стабилен для пары {предмет, класс} и потому
    отлично ложится в кэшируемый префикс промпта.
    """
    gs = spec.grade_spec(grade)
    if not gs:
        return ""

    lines: List[str] = ["[СЛОЙ 4 — ТРЕБОВАНИЯ ФГОС]"]
    lines.append(f"Источник: {spec.source.get('document', '')}.")
    lines.append(f"Курс {grade} класса: {gs.period}")
    if gs.boundary_note:
        lines.append(f"Границы курса: {gs.boundary_note}")

    lines.append("\nПланируемые предметные результаты (на них работает материал):")
    for group in gs.subject_results:
        items = "; ".join(group.get("items", []))
        lines.append(f"  • {group.get('title')}: {items}")

    matches = match_sections(spec, topic)
    relevant = [s for s, _ in matches if s.grade == grade] or [s for s, _ in matches]
    if relevant:
        lines.append("\nДидактические единицы темы по ФРП (раскрыть обязательно):")
        for section in relevant:
            lines.append(f"  Раздел «{section.title}»:")
            for unit in section.units:
                lines.append(f"    − {unit}")
            if section.required_terms:
                lines.append(f"    Обязательные понятия: {', '.join(section.required_terms)}")
            if section.required_dates:
                lines.append(f"    Обязательные даты: {', '.join(section.required_dates)}")
            guard = section.anachronism_guard
            if guard:
                lines.append(f"    ВНИМАНИЕ: {guard.get('comment', '')}")
                if guard.get("forbidden_terms"):
                    lines.append(
                        f"    Не употреблять: {', '.join(guard['forbidden_terms'])}"
                    )

    meta_groups = spec.metasubject.get("groups", [])
    if meta_groups:
        lines.append("\nМетапредметные результаты (УУД), которые формирует урок:")
        for group in meta_groups:
            items = "; ".join(i["text"] for i in group.get("items", []))
            lines.append(f"  • {group.get('title')}: {items}")

    lines.append(
        "\nСтруктура дека: титул → контекст/определение → 3–6 контентных слайдов "
        "по логике раздела → сравнение или схема → итоги → проверка понимания "
        "(вопросы разных уровней) → домашнее задание."
    )
    return "\n".join(lines)


def available_subjects() -> List[str]:
    return sorted({v for v in _SUBJECT_FILES.values()})
