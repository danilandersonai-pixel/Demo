"""Дизайн-система: темы оформления и шрифтовые пары.

Палитры сняты с ручной работы Дарьи Прониной (анализ, §5.1) — её вёрстка
служит дизайн-спекой. Системные дефекты оригинала здесь исправлены по
умолчанию: настоящий bold (не faux), холст 16:9, единая капитализация.

Шрифты — только кириллические free (OFL): PT Serif (заголовки) + PT Sans
(тело). У обоих есть настоящие bold-начертания, поэтому «фейковый жирный»
Bahnschrift Light из оригинала не воспроизводится.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from pptx.dml.color import RGBColor

# --- Поиск файлов шрифтов -------------------------------------------------
# python-pptx шрифты НЕ встраивает: имя задаётся строкой, а рендер зависит от
# того, что установлено на машине просмотра/конвертации. Поэтому тот же набор
# TTF обязан стоять в Docker-образе конвертации PPTX→PDF.

_FONT_DIRS = [
    "/usr/share/fonts/truetype/paratype",
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation",
]

# (семейство, bold, italic) -> имя файла
_FONT_FILES = {
    ("PT Sans", False, False): "PTS55F.ttf",
    ("PT Sans", True, False): "PTS75F.ttf",
    ("PT Sans", False, True): "PTS56F.ttf",
    ("PT Sans", True, True): "PTS76F.ttf",
    ("PT Serif", False, False): "PTF55F.ttf",
    ("PT Serif", True, False): "PTF75F.ttf",
    ("PT Serif", False, True): "PTF56F.ttf",
    ("PT Serif", True, True): "PTF76F.ttf",
}

_FALLBACK = "DejaVuSans.ttf"


def resolve_font(
    family: str, bold: bool = False, italic: bool = False
) -> Tuple[Optional[str], bool]:
    """Путь к TTF для замера текста + признак точного совпадения.

    Возвращает `(путь, точный)`. `точный=False` означает, что запрошенного
    начертания на машине нет и подставлен запасной шрифт.

    Почему это важно различать: замер идёт по метрикам ФАЙЛА, а в PPTX
    записывается ИМЯ семейства. Если PT Sans не установлен, мы посчитаем
    вёрстку по метрикам DejaVu, объявим в файле «PT Sans», а LibreOffice при
    конвертации подставит что-то третье — и расчёт разъедется с рендером
    молча. На машине разработчика, где шрифты стоят, этого не видно.

    Поэтому подмену не запрещаем (иначе сборка падала бы на любой чужой
    машине), но делаем её заметной: `check_theme_fonts()` собирает список
    недостающих начертаний, а рендерер выносит его в отчёт.
    """
    name = _FONT_FILES.get((family, bold, italic))
    if name:
        for d in _FONT_DIRS:
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p, True
    for d in _FONT_DIRS:
        p = os.path.join(d, _FALLBACK)
        if os.path.exists(p):
            return p, False
    return None, False


def font_path(family: str, bold: bool = False, italic: bool = False) -> Optional[str]:
    """Путь к TTF без признака подмены — для мест, где он не нужен."""
    return resolve_font(family, bold, italic)[0]


def check_theme_fonts(theme: "ThemeConfig") -> List[str]:
    """Каких начертаний темы не хватает на этой машине.

    Пустой список — всё на месте, замер и рендер сойдутся. Непустой — вёрстка
    посчитана по чужим метрикам; в Docker-образ конвертации нужно доложить
    шрифты (см. `requirements.txt`, пакет fonts-paratype).
    """
    missing: List[str] = []
    for fam in (theme.display_font, theme.body_font):
        for bold in (False, True):
            _, exact = resolve_font(fam, bold=bold)
            if not exact:
                missing.append(f"{fam} {'Bold' if bold else 'Regular'}")
    # Один и тот же шрифт может быть и дисплейным, и текстовым
    return sorted(set(missing))


def rgb(hex_str: str) -> RGBColor:
    return RGBColor.from_string(hex_str.lstrip("#").upper())


@dataclass
class ThemeConfig:
    """Конфигурация темы: палитра, шрифты, кегли."""

    name: str
    # Палитра
    bg: str  # фон слайда
    ink: str  # основной текст
    accent: str  # акцент (рамки определений, заголовки)
    accent2: str  # второй акцент (даты, номера)
    gold: str  # декоративная линия/рамка
    card_bg: str  # подложка карточки
    card_alpha: int  # прозрачность карточки, %
    # Шрифты
    display_font: str  # заголовки
    body_font: str  # тело
    # Кегли, pt
    size_title_hero: int = 40
    size_slide_title: int = 28
    size_body: int = 17
    size_body_min: int = 13  # ниже не опускаемся при автоподборе
    size_summary_bonus: int = 2  # итоговый слайд крупнее (приём из оригинала)
    size_caption: int = 12
    # Декор
    border_pt: float = 2.0
    double_frame: bool = False  # двойная рамка по краю слайда (манускрипт)


THEMES: Dict[str, ThemeConfig] = {
    "manuscript": ThemeConfig(
        name="manuscript",
        bg="#E8E0CD",  # пергамент
        ink="#2A2118",
        accent="#7A1F2B",  # винно-бордовый
        accent2="#2F4156",  # тёмно-синий
        gold="#C9A04E",
        card_bg="#F5F0E1",
        card_alpha=88,
        display_font="PT Serif",
        body_font="PT Sans",
        double_frame=True,
    ),
    "edu_flat": ThemeConfig(
        name="edu_flat",
        bg="#FFFFFF",
        ink="#1F2933",
        accent="#2E7D5B",  # зелёный
        accent2="#3B7EA1",  # голубой
        gold="#E0A32E",  # янтарь
        card_bg="#F3F7F5",
        card_alpha=100,
        display_font="PT Sans",
        body_font="PT Sans",
        size_title_hero=40,
    ),
    "clay": ThemeConfig(
        name="clay",
        bg="#FFFFFF",
        ink="#2B2B33",
        accent="#C2553D",
        accent2="#4A6FA5",
        gold="#E8B04B",
        card_bg="#F6F4F1",
        card_alpha=100,
        display_font="PT Sans",
        body_font="PT Sans",
    ),
    "board_game": ThemeConfig(
        name="board_game",
        bg="#F2EFE3",  # кремовая бумага
        ink="#2A2620",
        accent="#8C3A2B",
        accent2="#3C5A46",
        gold="#C9A04E",
        card_bg="#FBF9F1",
        card_alpha=95,
        display_font="PT Serif",
        body_font="PT Sans",
    ),
    "neutral": ThemeConfig(
        name="neutral",
        bg="#FFFFFF",
        ink="#222222",
        accent="#34495E",
        accent2="#7F8C8D",
        gold="#B0B0B0",
        card_bg="#F5F5F5",
        card_alpha=100,
        display_font="PT Sans",
        body_font="PT Sans",
    ),
}


def get_theme(name: str) -> ThemeConfig:
    return THEMES.get(name, THEMES["manuscript"])
