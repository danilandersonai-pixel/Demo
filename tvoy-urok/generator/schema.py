"""Контракт «LLM → рендерер»: схема дека презентации.

Роли и лимиты — из анализа 5 реальных презентаций (docs/tvoy-urok/
presentation-generation-analysis.md, §2.1–2.2, §4.1).

Схема намеренно ПЛОСКАЯ: единый объект слайда с полем-дискриминатором `role`
и опциональными блоками, без anyOf/oneOf. Причина — GigaChat и часть
провайдеров structured output не поддерживают union-конструкции, а схема
должна одинаково работать у всех моделей роутера.

Строковые лимиты (max_length) провайдеры не гарантируют — они здесь как
подсказка модели и как первый эшелон клиентской валидации. Реальный контроль
объёма делают validators.py (пословный линтер) и textfit.py (замер по шрифту).
"""

from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Role(str, Enum):
    """Роль слайда в драматургии урока (типология из анализа, §2.1)."""

    TITLE = "title"
    DEFINITION = "definition"
    OVERVIEW = "overview"
    CONTENT = "content"
    DEEPDIVE = "deepdive"
    PROCESS = "process"
    COMPARE = "compare"
    TIMELINE = "timeline"
    ARTIFACT = "artifact"
    QUIZ = "quiz"
    SUMMARY = "summary"
    HOMEWORK = "homework"
    SOURCES = "sources"


class Layout(str, Enum):
    """Раскладка слайда — маппится на функцию-рендерер в render.py."""

    TITLE_HERO = "title_hero"
    CARD_LEFT_IMAGE_RIGHT = "card_left_image_right"
    CARD_RIGHT_IMAGE_LEFT = "card_right_image_left"
    WIDE_DIAGRAM_BULLETS = "wide_diagram_bullets"
    SPLIT_40_60 = "split_40_60"
    COMPARE_TWO_COLS = "compare_two_cols"
    DEFINITION_TOP = "definition_top"
    BULLETS_SUMMARY = "bullets_summary"
    TIMELINE_ROWS = "timeline_rows"
    QUIZ_LIST = "quiz_list"


class Theme(str, Enum):
    """Тема оформления. Соответствует «домашним стилям» из анализа (§5.1)."""

    MANUSCRIPT = "manuscript"
    EDU_FLAT = "edu_flat"
    CLAY = "clay"
    BOARD_GAME = "board_game"
    NEUTRAL = "neutral"


class ImageKind(str, Enum):
    ILLUSTRATION = "illustration"
    DIAGRAM_BG = "diagram_bg"
    HERO = "hero"
    ARTIFACT_PHOTO = "artifact_photo"  # реальное фото (public domain), не t2i
    NONE = "none"


class Paragraph(BaseModel):
    """Один тезис: ровно одно предложение, 8–16 слов (норма из анализа)."""

    text: str = Field(max_length=140)
    bold_terms: List[str] = Field(
        default_factory=list,
        max_length=4,
        description="Термины/даты внутри text, выделяемые настоящим bold",
    )
    source_quote: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Дословный фрагмент источника-основания (grounding)",
    )


class Definition(BaseModel):
    term: str = Field(max_length=40)
    text: str = Field(max_length=220, description="8–35 слов, «Термин — определение»")


class CompareSide(BaseModel):
    label: str = Field(max_length=40)
    points: List[str] = Field(default_factory=list, max_length=4)


class Compare(BaseModel):
    left: CompareSide
    right: CompareSide
    verdict: Optional[str] = Field(default=None, max_length=120)


class TimelineItem(BaseModel):
    date: str = Field(max_length=20)
    event: str = Field(max_length=90)


class QuizItem(BaseModel):
    q: str = Field(max_length=140)
    a: Optional[str] = Field(default=None, max_length=90)


class Image(BaseModel):
    """Иллюстративный слот.

    Правило №1 архитектуры: внутри генерируемой картинки НЕТ текста — все
    подписи и ярлыки рендерим нативными текстбоксами поверх.
    """

    prompt: str = Field(default="", max_length=300, description="Сцена БЕЗ текста")
    kind: ImageKind = ImageKind.ILLUSTRATION
    alt: str = Field(default="", max_length=120)
    path: Optional[str] = Field(
        default=None, description="Локальный файл; если None — рисуем плейсхолдер"
    )
    sensitive: bool = Field(
        default=False,
        description="Тема требует архивного фото/стилизации вместо t2i (война и т.п.)",
    )


class Slide(BaseModel):
    role: Role
    layout: Layout
    title: str = Field(
        max_length=60,
        description="2–6 слов. ОБЯЗАТЕЛЕН на каждом слайде (фикс дефекта NotebookLM)",
    )
    subtitle: Optional[str] = Field(default=None, max_length=90)
    paragraphs: List[Paragraph] = Field(default_factory=list, max_length=6)
    bullets: List[str] = Field(default_factory=list, max_length=6)
    definition: Optional[Definition] = None
    compare: Optional[Compare] = None
    timeline_items: List[TimelineItem] = Field(default_factory=list, max_length=5)
    quiz: List[QuizItem] = Field(default_factory=list, max_length=4)
    callout: Optional[str] = Field(
        default=None, max_length=120, description="Вывод слайда, 10–18 слов"
    )
    image: Optional[Image] = None


class Meta(BaseModel):
    topic: str = Field(max_length=80)
    subject: str
    grade: int = Field(ge=1, le=11)
    theme: Theme = Theme.MANUSCRIPT
    source_ref: str = Field(
        default="", description="Учебник и §, напр. «В.Р. Мединский, § 38–39»"
    )
    author: str = Field(default="", description="Учитель из профиля — в метаданные файла")
    image_style_prompt: str = Field(
        default="", max_length=300, description="Единый стиль-промпт на весь дек"
    )


class Deck(BaseModel):
    meta: Meta
    slides: List[Slide] = Field(min_length=1, max_length=16)


def json_schema() -> dict:
    """JSON Schema для structured output провайдеров."""
    return Deck.model_json_schema()
