"""Замер текста — замена несуществующему autofit в python-pptx.

Почему это отдельный модуль: `MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE` в python-pptx
не работает (issues #973/#715) — это лишь XML-флаг, а фактический пересчёт
кегля делает сам PowerPoint при открытии файла. Наш конвейер отдаёт PPTX
сразу в LibreOffice → PDF, файл никто не «открывает», поэтому переполнение
осталось бы как есть. Значит, считаем текст сами.

Метод: Pillow ImageFont.getlength() по реальному TTF кириллического шрифта
(advance width с кернингом). Для кириллических гротесков этого достаточно —
сложного шейпинга/лигатур, ради которых нужен HarfBuzz, здесь нет.

Единицы: работаем в пунктах (pt). Шрифт грузится с размером size_pt*SCALE
пикселей и результат делится на SCALE — TrueType-скейлинг линейный, поэтому
это даёт точность лучше целого пикселя.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List, Optional, Sequence, Tuple

from PIL import ImageFont

SCALE = 8  # супер-сэмплинг для точности замера
LINE_SPACING = 1.20  # одинарный интерлиньяж PowerPoint ≈ 1.2 × кегля
PARA_GAP = 0.45  # пустая строка между абзацами, в долях кегля


@lru_cache(maxsize=256)
def _load(path: str, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, px)


def text_width_pt(text: str, font_file: Optional[str], size_pt: float) -> float:
    """Ширина строки в пунктах. Без шрифта — консервативная оценка."""
    if not text:
        return 0.0
    if not font_file:
        # ~0.5 em на символ — грубо, но с запасом в большую сторону
        return len(text) * size_pt * 0.5
    font = _load(font_file, max(1, int(round(size_pt * SCALE))))
    return font.getlength(text) / SCALE


def wrap_text(
    text: str, font_file: Optional[str], size_pt: float, max_width_pt: float
) -> List[str]:
    """Жадный перенос по словам с замером каждой строки."""
    words = text.split()
    if not words:
        return []
    lines: List[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if text_width_pt(candidate, font_file, size_pt) <= max_width_pt:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def line_height_pt(size_pt: float) -> float:
    return size_pt * LINE_SPACING


def block_height_pt(
    texts: Sequence[str],
    font_file: Optional[str],
    size_pt: float,
    max_width_pt: float,
    para_gap: bool = True,
) -> float:
    """Высота блока абзацев при заданном кегле и ширине."""
    total = 0.0
    for i, t in enumerate(texts):
        lines = wrap_text(t, font_file, size_pt, max_width_pt)
        total += len(lines) * line_height_pt(size_pt)
        if para_gap and i < len(texts) - 1:
            total += size_pt * PARA_GAP
    return total


def fit_size(
    texts: Sequence[str],
    font_file: Optional[str],
    box_w_pt: float,
    box_h_pt: float,
    start_pt: float,
    min_pt: float,
    para_gap: bool = True,
) -> Tuple[float, bool]:
    """Подобрать кегль, при котором блок влезает в слот.

    Ступенчато снижает размер от start_pt до min_pt (шаг 0.5 pt).

    Возвращает (кегль, overflow): overflow=True означает, что даже на
    минимальном кегле текст не помещается — это сигнал вызывающему коду
    (ретрай слайда с инструкцией «сократи» или перенос хвоста на
    слайд-продолжение).
    """
    size = start_pt
    while size >= min_pt:
        if block_height_pt(texts, font_file, size, box_w_pt, para_gap) <= box_h_pt:
            return size, False
        size -= 0.5
    return min_pt, True
