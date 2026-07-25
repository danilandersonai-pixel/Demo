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

# Файл данных на предмет; ключи — нормализованные названия и их синонимы,
# как учитель может назвать предмет в форме генерации.
_SUBJECT_FILES = {
    "история": "istoriya-5-9.json",
    "история россии": "istoriya-5-9.json",
    "всеобщая история": "istoriya-5-9.json",
    "окружающий мир": "okruzhayushchiy-mir-1-4.json",
    "окружающиий мир": "okruzhayushchiy-mir-1-4.json",
    "биология": "biologiya-5-9.json",
    "обществознание": "obshchestvoznanie-6-9.json",
    "общество": "obshchestvoznanie-6-9.json",
    "география": "geografiya-5-9.json",
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
class ResultGroup:
    """Группа планируемых результатов + признаки её покрытия в деке.

    `evidence_roles` — роли слайдов, наличие которых свидетельствует, что дек
    работает на этот результат. Хранится в данных, а не в коде: у каждого
    предмета свои группы результатов (у истории — работа с картой и
    источниками, у биологии — процессы и классификация).
    """

    code: str
    title: str
    evidence_roles: List[str] = field(default_factory=list)
    evidence_hint: str = ""
    evidence_source_quote: bool = False


@dataclass
class SubjectSpec:
    subject: str
    source: dict
    metasubject: dict
    grades: Dict[int, GradeSpec]
    result_groups: Dict[str, ResultGroup] = field(default_factory=dict)

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


def stem(word: str) -> str:
    """Грубая основа слова: отбрасываем окончание, но не короче 4 символов.

    Русский язык склоняется, поэтому буквальное сравнение не работает:
    тема «Природные сообщества» не совпадёт с ключевым словом «природное
    сообщество», а «великокняжеская власть» — с «великокняжеской власти».
    Полноценная морфология (pymorphy) избыточна: спорные случаи всё равно
    смотрит ФГОС-инспектор или человек.
    """
    return word[: max(4, len(word) - 2)] if len(word) > 4 else word


def term_present(term: str, text_norm: str) -> bool:
    """Есть ли термин в тексте в любой словоформе. text_norm — нормализованный."""
    words = re.findall(r"[а-яa-z0-9]+", _normalize(term))
    if not words:
        return False
    pattern = r"\w*\s+".join(re.escape(stem(w)) for w in words) + r"\w*"
    return re.search(pattern, text_norm) is not None


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

    result_groups = {
        rg["code"]: ResultGroup(
            code=rg["code"],
            title=rg.get("title", rg["code"]),
            evidence_roles=rg.get("evidence_roles", []),
            evidence_hint=rg.get("evidence_hint", ""),
            evidence_source_quote=rg.get("evidence_source_quote", False),
        )
        for rg in raw.get("result_groups", [])
    }

    return SubjectSpec(
        subject=raw.get("subject", subject),
        source=raw.get("source", {}),
        metasubject=raw.get("metasubject", {}),
        grades=grades,
        result_groups=result_groups,
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
        # Вес совпадения зависит от специфичности ключа: многословный
        # «природные зоны» должен побеждать общее «природа», иначе тема
        # уедет не в тот класс.
        score = sum(
            10 * len(kw.split()) + len(kw)
            for kw in section.keywords
            if term_present(kw, t)
        )
        if score:
            scored.append((section, score))
    scored.sort(key=lambda x: (-x[1], x[0].grade))
    return scored[:limit]


def grade_for_topic(spec: SubjectSpec, topic: str) -> Optional[int]:
    """Класс, к которому ФРП относит тему (по лучшему совпадению)."""
    matches = match_sections(spec, topic, limit=1)
    return matches[0][0].grade if matches else None


def prompt_layer(
    spec: SubjectSpec, grade: int, topic: str, mode: str = "full"
) -> str:
    """Собрать «СЛОЙ 4 — ТРЕБОВАНИЯ ФГОС» для промпта генерации.

    Возвращает готовый текстовый блок: период курса, планируемые результаты,
    дидактические единицы темы, обязательные термины и даты, запрет
    анахронизмов. Этот блок стабилен для пары {предмет, класс} и потому
    отлично ложится в кэшируемый префикс промпта.

    Режимы (см. schema.FgosMode):
      full  — полный слой;
      check — генерацию не ограничиваем, слой не подмешиваем (отчёт всё равно
              будет, но справочный);
      off   — только защита от анахронизмов, если она есть для темы: это
              достоверность, а не требование стандарта.
    """
    if mode == "check":
        return ""

    gs = spec.grade_spec(grade)
    if not gs:
        return ""

    if mode == "off":
        guards = [
            s.anachronism_guard
            for s, _ in match_sections(spec, topic)
            if s.anachronism_guard
        ]
        if not guards:
            return ""
        lines = ["[ДОСТОВЕРНОСТЬ ЭПОХИ]"]
        for guard in guards:
            lines.append(guard.get("comment", ""))
            if guard.get("forbidden_terms"):
                lines.append(f"Не употреблять: {', '.join(guard['forbidden_terms'])}")
            if guard.get("period_end_year"):
                lines.append(
                    "В тексте и на иллюстрациях не должно быть реалий позже "
                    f"{guard['period_end_year']} года."
                )
        return "\n".join(lines)

    lines: List[str] = ["[СЛОЙ 4 — ТРЕБОВАНИЯ ФГОС]"]
    lines.append(f"Источник: {spec.source.get('document', '')}.")
    lines.append(f"Курс {grade} класса: {gs.period}")
    if gs.boundary_note:
        lines.append(f"Границы курса: {gs.boundary_note}")

    lines.append("\nПланируемые предметные результаты (на них работает материал):")
    for group in gs.subject_results:
        rg = spec.result_groups.get(group.get("code", ""))
        title = rg.title if rg else group.get("code", "")
        items = "; ".join(group.get("items", []))
        lines.append(f"  • {title}: {items}")

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
