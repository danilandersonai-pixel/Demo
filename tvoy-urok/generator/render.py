"""Рендерер: JSON-дек → нативный PPTX по мастер-шаблону темы.

Принципы (анализ, §4.4):
  • холст ВСЕГДА 16:9 (13.333×7.5″) — фикс разнобоя оригинала (720×405 / A4);
  • текст ВСЕГДА живой (текстовые фреймы), картинки — только иллюстративный
    слот без текста внутри; все подписи рендерим сами;
  • кегль подбирается замером (textfit), а не «автофитом», которого нет;
  • настоящий bold-ран по bold_terms, без faux-bold;
  • чистые метаданные файла, alt-тексты на картинках.

Пока нет ключей к t2i-моделям, слот картинки рисуется как оформленный
плейсхолдер в палитре темы — геометрия слайда при подключении генерации
не изменится.
"""

from __future__ import annotations

import os
from typing import List, Optional, Sequence, Tuple

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Pt

from . import textfit
from .schema import Deck, Layout, Role, Slide
from .themes import ThemeConfig, font_path, get_theme, rgb

# --- Геометрия ------------------------------------------------------------
SLIDE_W_PT = 960.0  # 13.333″ × 72
SLIDE_H_PT = 540.0  # 7.5″ × 72
MARGIN_PT = 48.0


def _pt(v: float) -> Emu:
    return Pt(v)


def _pct_w(p: float) -> float:
    return SLIDE_W_PT * p


def _pct_h(p: float) -> float:
    return SLIDE_H_PT * p


# --- Примитивы ------------------------------------------------------------

def _bold_runs(text: str, bold_terms: Sequence[str]) -> List[Tuple[str, bool]]:
    """Разбить текст на сегменты (фрагмент, жирный?) по списку терминов."""
    terms = [t for t in bold_terms if t and t in text]
    if not terms:
        return [(text, False)]
    # Сначала длинные — чтобы вложенные термины не рвали длинные
    terms.sort(key=len, reverse=True)
    segments: List[Tuple[str, bool]] = [(text, False)]
    for term in terms:
        out: List[Tuple[str, bool]] = []
        for seg, is_bold in segments:
            if is_bold or term not in seg:
                out.append((seg, is_bold))
                continue
            head, _, tail = seg.partition(term)
            if head:
                out.append((head, False))
            out.append((term, True))
            if tail:
                out.append((tail, False))
        segments = out
    return [(s, b) for s, b in segments if s]


def _textbox(
    slide,
    x_pt: float,
    y_pt: float,
    w_pt: float,
    h_pt: float,
    anchor=MSO_ANCHOR.TOP,
):
    box = slide.shapes.add_textbox(_pt(x_pt), _pt(y_pt), _pt(w_pt), _pt(h_pt))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = _pt(0)
    tf.margin_top = tf.margin_bottom = _pt(0)
    tf.vertical_anchor = anchor
    return box, tf


def _style_run(run, font_name: str, size_pt: float, color: str, bold: bool = False):
    run.font.name = font_name
    run.font.size = _pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = rgb(color)


def _write_paragraphs(
    tf,
    items: Sequence[Tuple[str, Sequence[str]]],
    font_name: str,
    size_pt: float,
    color: str,
    align=PP_ALIGN.LEFT,
    space_after_pt: float = 0.0,
    bullet_char: Optional[str] = None,
):
    """Залить абзацы в текстфрейм с настоящими bold-ранами."""
    first = True
    for text, bold_terms in items:
        para = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        para.alignment = align
        para.space_after = _pt(space_after_pt)
        prefix = f"{bullet_char} " if bullet_char else ""
        segments = _bold_runs(text, bold_terms)
        if prefix:
            run = para.add_run()
            run.text = prefix
            _style_run(run, font_name, size_pt, color, bold=False)
        for seg, is_bold in segments:
            run = para.add_run()
            run.text = seg
            _style_run(run, font_name, size_pt, color, bold=is_bold)


def _rect(
    slide,
    x_pt: float,
    y_pt: float,
    w_pt: float,
    h_pt: float,
    fill: Optional[str] = None,
    line: Optional[str] = None,
    line_pt: float = 1.0,
    shape=MSO_SHAPE.ROUNDED_RECTANGLE,
    adjust: Optional[float] = 0.04,
):
    sh = slide.shapes.add_shape(shape, _pt(x_pt), _pt(y_pt), _pt(w_pt), _pt(h_pt))
    if adjust is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            sh.adjustments[0] = adjust
        except (IndexError, ValueError):
            pass
    if fill:
        sh.fill.solid()
        sh.fill.fore_color.rgb = rgb(fill)
    else:
        sh.fill.background()
    if line:
        sh.line.color.rgb = rgb(line)
        sh.line.width = _pt(line_pt)
    else:
        sh.line.fill.background()
    sh.shadow.inherit = False
    if sh.has_text_frame:
        sh.text_frame.word_wrap = True
    return sh


def _image_slot(
    slide,
    theme: ThemeConfig,
    x_pt: float,
    y_pt: float,
    w_pt: float,
    h_pt: float,
    img,
):
    """Слот иллюстрации: реальный файл или оформленный плейсхолдер.

    Плейсхолдер намеренно в палитре темы — при подключении t2i-модели
    геометрия слайда не поменяется, поменяется только содержимое слота.
    """
    if img is not None and img.path and os.path.exists(img.path):
        pic = slide.shapes.add_picture(
            img.path, _pt(x_pt), _pt(y_pt), _pt(w_pt), _pt(h_pt)
        )
        if img.alt:
            pic._element._nvXxPr.cNvPr.set("descr", img.alt)
        return pic

    box = _rect(slide, x_pt, y_pt, w_pt, h_pt, fill=theme.card_bg, line=theme.gold, line_pt=1.0)
    if img is not None and img.alt:
        box._element._nvXxPr.cNvPr.set("descr", img.alt)
    # Диагональная «рамка-заглушка» + подпись alt
    label = (img.alt if img and img.alt else "иллюстрация")
    _, tf = _textbox(slide, x_pt + 12, y_pt + h_pt / 2 - 18, w_pt - 24, 36, MSO_ANCHOR.MIDDLE)
    _write_paragraphs(
        tf,
        [(f"[{label}]", [])],
        theme.body_font,
        theme.size_caption,
        theme.gold,
        align=PP_ALIGN.CENTER,
    )
    return box


def _fit_box(avail_h: float, needed_h: float, min_ratio: float = 0.62) -> Tuple[float, float]:
    """Высота блока «по содержимому» + вертикальное центрирование.

    Блок не растягивается на всю доступную высоту (иначе текст висит вверху
    в пустой карточке), но и не схлопывается слишком сильно — держим
    минимальную визуальную массу min_ratio от доступной высоты.

    Возвращает (смещение сверху, высота блока).
    """
    h = min(avail_h, max(needed_h, avail_h * min_ratio))
    offset = max(0.0, (avail_h - h) / 2)
    return offset, h


def _slide_bg(slide, theme: ThemeConfig):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb(theme.bg)
    if theme.double_frame:
        _rect(slide, 18, 18, SLIDE_W_PT - 36, SLIDE_H_PT - 36,
              fill=None, line=theme.gold, line_pt=1.5, shape=MSO_SHAPE.RECTANGLE, adjust=None)
        _rect(slide, 24, 24, SLIDE_W_PT - 48, SLIDE_H_PT - 48,
              fill=None, line=theme.accent, line_pt=0.75, shape=MSO_SHAPE.RECTANGLE, adjust=None)


def _slide_title(slide, theme: ThemeConfig, text: str, subtitle: Optional[str] = None) -> float:
    """Заголовок слайда. Возвращает Y, с которого начинается контент."""
    y = MARGIN_PT + 8
    font = font_path(theme.display_font, bold=True)
    size, _ = textfit.fit_size(
        [text], font, SLIDE_W_PT - 2 * MARGIN_PT, 64,
        theme.size_slide_title, theme.size_slide_title - 8, para_gap=False,
    )
    lines = textfit.wrap_text(text, font, size, SLIDE_W_PT - 2 * MARGIN_PT)
    h = len(lines) * textfit.line_height_pt(size)
    _, tf = _textbox(slide, MARGIN_PT, y, SLIDE_W_PT - 2 * MARGIN_PT, h + 4)
    _write_paragraphs(tf, [(text, [])], theme.display_font, size, theme.accent)
    y += h + 6

    # Золотая линия-разделитель под заголовком
    _rect(slide, MARGIN_PT, y, 120, 2, fill=theme.gold, line=None,
          shape=MSO_SHAPE.RECTANGLE, adjust=None)
    y += 12

    if subtitle:
        sfont = font_path(theme.body_font)
        ssize = theme.size_caption + 2
        slines = textfit.wrap_text(subtitle, sfont, ssize, SLIDE_W_PT - 2 * MARGIN_PT)
        sh = len(slines) * textfit.line_height_pt(ssize)
        _, stf = _textbox(slide, MARGIN_PT, y, SLIDE_W_PT - 2 * MARGIN_PT, sh + 2)
        _write_paragraphs(stf, [(subtitle, [])], theme.body_font, ssize, theme.accent2)
        y += sh + 8

    return y


def _callout(slide, theme: ThemeConfig, text: str, y_pt: float, w_pt: float, x_pt: float = MARGIN_PT):
    """Вывод-мораль слайда в акцентной плашке."""
    font = font_path(theme.body_font, bold=True)
    size = theme.size_body - 1
    inner_w = w_pt - 28
    lines = textfit.wrap_text(text, font, size, inner_w)
    h = len(lines) * textfit.line_height_pt(size) + 16
    _rect(slide, x_pt, y_pt, w_pt, h, fill=theme.card_bg, line=theme.accent, line_pt=1.25)
    _, tf = _textbox(slide, x_pt + 14, y_pt + 8, inner_w, h - 16, MSO_ANCHOR.MIDDLE)
    _write_paragraphs(tf, [(text, [])], theme.body_font, size, theme.accent)
    return h


# --- Лейауты --------------------------------------------------------------

def _render_title_hero(slide, theme: ThemeConfig, s: Slide, meta):
    font = font_path(theme.display_font, bold=True)
    box_w = SLIDE_W_PT * 0.62
    size, _ = textfit.fit_size(
        [s.title], font, box_w, 150, theme.size_title_hero,
        theme.size_title_hero - 12, para_gap=False,
    )
    lines = textfit.wrap_text(s.title, font, size, box_w)
    h = len(lines) * textfit.line_height_pt(size)
    y = _pct_h(0.30)
    _, tf = _textbox(slide, MARGIN_PT + 12, y, box_w, h + 6)
    _write_paragraphs(tf, [(s.title, [])], theme.display_font, size, theme.accent)
    y += h + 14

    _rect(slide, MARGIN_PT + 12, y, 160, 2.5, fill=theme.gold, line=None,
          shape=MSO_SHAPE.RECTANGLE, adjust=None)
    y += 18

    if s.subtitle:
        ssize = theme.size_body + 1
        sfont = font_path(theme.body_font)
        slines = textfit.wrap_text(s.subtitle, sfont, ssize, box_w)
        sh = len(slines) * textfit.line_height_pt(ssize)
        _, stf = _textbox(slide, MARGIN_PT + 12, y, box_w, sh + 4)
        _write_paragraphs(stf, [(s.subtitle, [])], theme.body_font, ssize, theme.ink)
        y += sh + 10

    ref = meta.source_ref
    if ref:
        _, rtf = _textbox(slide, MARGIN_PT + 12, y, box_w, 22)
        _write_paragraphs(rtf, [(ref, [])], theme.body_font, theme.size_caption, theme.accent2)

    _image_slot(slide, theme, _pct_w(0.66), _pct_h(0.18), _pct_w(0.26), _pct_h(0.60), s.image)


def _render_card_image(slide, theme: ThemeConfig, s: Slide, image_right: bool = True):
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    avail_h = SLIDE_H_PT - y0 - MARGIN_PT

    card_w = _pct_w(0.52)
    img_w = _pct_w(0.32)
    gap = _pct_w(0.03)
    if image_right:
        card_x = MARGIN_PT
        img_x = MARGIN_PT + card_w + gap
    else:
        img_x = MARGIN_PT
        card_x = MARGIN_PT + img_w + gap

    items = [(p.text, p.bold_terms) for p in s.paragraphs]
    callout_h = 0.0
    if s.callout:
        callout_h = 52.0

    pad = 16.0
    inner_w = card_w - 2 * pad
    box_h_max = avail_h - callout_h - (10 if callout_h else 0)
    font = font_path(theme.body_font)
    texts = [t for t, _ in items]
    size, overflow = textfit.fit_size(
        texts, font, inner_w, box_h_max - 2 * pad,
        theme.size_body, theme.size_body_min,
    )

    needed = textfit.block_height_pt(texts, font, size, inner_w) + 2 * pad
    dy, box_h = _fit_box(box_h_max, needed)
    y = y0 + dy

    if items:
        _rect(slide, card_x, y, card_w, box_h, fill=theme.card_bg, line=theme.gold, line_pt=1.0)
        _, tf = _textbox(slide, card_x + pad, y + pad, inner_w, box_h - 2 * pad,
                         MSO_ANCHOR.MIDDLE)
        _write_paragraphs(tf, items, theme.body_font, size, theme.ink,
                          space_after_pt=size * textfit.PARA_GAP)

    _image_slot(slide, theme, img_x, y, img_w, box_h, s.image)

    if s.callout:
        _callout(slide, theme, s.callout, y + box_h + 10, card_w, card_x)

    return overflow


def _render_definition_top(slide, theme: ThemeConfig, s: Slide):
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    d = s.definition
    if d:
        font = font_path(theme.body_font, bold=True)
        full = f"{d.term} — {d.text}"
        w = SLIDE_W_PT - 2 * MARGIN_PT
        inner = w - 32
        size, _ = textfit.fit_size([full], font, inner, 120, theme.size_body + 2,
                                   theme.size_body_min, para_gap=False)
        lines = textfit.wrap_text(full, font, size, inner)
        h = len(lines) * textfit.line_height_pt(size) + 24
        _rect(slide, MARGIN_PT, y0, w, h, fill=theme.card_bg, line=theme.accent, line_pt=theme.border_pt)
        _, tf = _textbox(slide, MARGIN_PT + 16, y0 + 12, inner, h - 24, MSO_ANCHOR.MIDDLE)
        _write_paragraphs(tf, [(full, [d.term])], theme.body_font, size, theme.ink)
        y0 += h + 16

    avail_h = SLIDE_H_PT - y0 - MARGIN_PT
    items = [(p.text, p.bold_terms) for p in s.paragraphs]
    if items:
        card_w = _pct_w(0.56) if s.image else SLIDE_W_PT - 2 * MARGIN_PT
        pad = 14.0
        inner_w = card_w - 2 * pad
        font = font_path(theme.body_font)
        texts = [t for t, _ in items]
        size, _ = textfit.fit_size(texts, font, inner_w,
                                   avail_h - 2 * pad, theme.size_body, theme.size_body_min)
        needed = textfit.block_height_pt(texts, font, size, inner_w) + 2 * pad
        dy, box_h = _fit_box(avail_h, needed, min_ratio=0.7)
        y = y0 + dy
        _, tf = _textbox(slide, MARGIN_PT + pad, y + pad, inner_w, box_h - 2 * pad,
                         MSO_ANCHOR.MIDDLE)
        _write_paragraphs(tf, items, theme.body_font, size, theme.ink,
                          space_after_pt=size * textfit.PARA_GAP)
        if s.image:
            _image_slot(slide, theme, MARGIN_PT + card_w + _pct_w(0.02), y,
                        _pct_w(0.30), box_h, s.image)


def _render_compare(slide, theme: ThemeConfig, s: Slide):
    """Сравнение — всегда слотами, никогда сплошным текстом (фикс дефекта)."""
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    c = s.compare
    if not c:
        return
    avail_h = SLIDE_H_PT - y0 - MARGIN_PT
    verdict_h = 52.0 if c.verdict else 0.0
    col_h_max = avail_h - verdict_h - (12 if verdict_h else 0)
    gap = _pct_w(0.035)
    col_w = (SLIDE_W_PT - 2 * MARGIN_PT - gap) / 2

    hsize = theme.size_body + 3
    head_h = 12 + textfit.line_height_pt(hsize) + 16
    pad = 14.0
    inner_w = col_w - 2 * pad - 12
    font = font_path(theme.body_font)

    # Общий кегль на обе колонки — чтобы не было визуального разнобоя
    sides = (c.left, c.right)
    size = min(
        textfit.fit_size(sd.points, font, inner_w, col_h_max - head_h - pad,
                         theme.size_body - 1, theme.size_body_min)[0]
        for sd in sides
    )
    needed = head_h + pad + max(
        textfit.block_height_pt(sd.points, font, size, inner_w) for sd in sides
    )
    dy, col_h = _fit_box(col_h_max, needed, min_ratio=0.55)
    y = y0 + dy

    for i, (side, color) in enumerate(((c.left, theme.accent), (c.right, theme.accent2))):
        x = MARGIN_PT + i * (col_w + gap)
        _rect(slide, x, y, col_w, col_h, fill=theme.card_bg, line=color, line_pt=1.5)
        # Шапка колонки
        _, htf = _textbox(slide, x + 14, y + 12, col_w - 28, 30)
        _write_paragraphs(htf, [(side.label, [])], theme.display_font, hsize, color,
                          align=PP_ALIGN.CENTER)
        _rect(slide, x + 14, y + 12 + textfit.line_height_pt(hsize) + 4, col_w - 28, 1.2,
              fill=color, line=None, shape=MSO_SHAPE.RECTANGLE, adjust=None)
        # Пункты
        _, ptf = _textbox(slide, x + pad + 12, y + head_h, inner_w, col_h - head_h - pad)
        _write_paragraphs(ptf, [(p, []) for p in side.points], theme.body_font, size,
                          theme.ink, space_after_pt=size * 0.4, bullet_char="•")

    if c.verdict:
        _callout(slide, theme, c.verdict, y + col_h + 12, SLIDE_W_PT - 2 * MARGIN_PT)


def _render_bullets_summary(slide, theme: ThemeConfig, s: Slide):
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    avail_h = SLIDE_H_PT - y0 - MARGIN_PT
    bullets = s.bullets or [p.text for p in s.paragraphs]
    if not bullets:
        return
    w = SLIDE_W_PT - 2 * MARGIN_PT
    if s.image:
        w = _pct_w(0.60)
    pad = 18.0
    inner_w = w - 2 * pad - 14
    font = font_path(theme.body_font)
    # Итоговый слайд крупнее на +2 pt — приём из оригинала
    start = theme.size_body + theme.size_summary_bonus
    size, _ = textfit.fit_size(bullets, font, inner_w, avail_h - 2 * pad, start,
                               theme.size_body_min)
    gap_pt = size * 0.5
    needed = (
        textfit.block_height_pt(bullets, font, size, inner_w, para_gap=False)
        + gap_pt * max(0, len(bullets) - 1)
        + 2 * pad
    )
    dy, box_h = _fit_box(avail_h, needed, min_ratio=0.6)
    y = y0 + dy

    _rect(slide, MARGIN_PT, y, w, box_h, fill=theme.card_bg, line=theme.gold, line_pt=1.0)
    _, tf = _textbox(slide, MARGIN_PT + pad + 14, y + pad, inner_w, box_h - 2 * pad,
                     MSO_ANCHOR.MIDDLE)
    _write_paragraphs(tf, [(b, []) for b in bullets], theme.body_font, size, theme.ink,
                      space_after_pt=gap_pt, bullet_char="—")
    if s.image:
        _image_slot(slide, theme, MARGIN_PT + w + _pct_w(0.02), y, _pct_w(0.28), box_h, s.image)


def _render_timeline(slide, theme: ThemeConfig, s: Slide):
    """Таймлайн нативными фигурами: текст остаётся текстом, не растр."""
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    items = s.timeline_items
    if not items:
        return
    avail_h = SLIDE_H_PT - y0 - MARGIN_PT
    w = SLIDE_W_PT - 2 * MARGIN_PT
    if s.image:
        w = _pct_w(0.62)

    row_h = min(avail_h / max(len(items), 1), 74)
    content_h = row_h * len(items)
    y_top = y0 + max(0.0, (avail_h - content_h) / 2)

    if s.image:
        _image_slot(slide, theme, MARGIN_PT + w + _pct_w(0.02), y_top,
                    _pct_w(0.26), content_h, s.image)

    date_w = 118.0
    # Вертикальная ось
    _rect(slide, MARGIN_PT + date_w + 14, y_top + 6, 2, content_h - 12,
          fill=theme.gold, line=None, shape=MSO_SHAPE.RECTANGLE, adjust=None)

    font = font_path(theme.body_font)
    size = theme.size_body - 1
    for i, item in enumerate(items):
        ry = y_top + i * row_h
        # Дата
        _, dtf = _textbox(slide, MARGIN_PT, ry + 4, date_w, row_h - 8, MSO_ANCHOR.TOP)
        _write_paragraphs(dtf, [(item.date, [])], theme.display_font, size + 1,
                          theme.accent, align=PP_ALIGN.RIGHT)
        # Маркер
        _rect(slide, MARGIN_PT + date_w + 9, ry + 8, 10, 10, fill=theme.accent,
              line=theme.bg, line_pt=1.0, shape=MSO_SHAPE.OVAL, adjust=None)
        # Событие
        ev_x = MARGIN_PT + date_w + 32
        ev_w = w - date_w - 32
        _, etf = _textbox(slide, ev_x, ry + 4, ev_w, row_h - 8)
        _write_paragraphs(etf, [(item.event, [])], theme.body_font, size, theme.ink)


def _render_quiz(slide, theme: ThemeConfig, s: Slide):
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    avail_h = SLIDE_H_PT - y0 - MARGIN_PT
    if not s.quiz:
        return
    w = SLIDE_W_PT - 2 * MARGIN_PT
    if s.image:
        w = _pct_w(0.62)
    row_h = min(avail_h / max(len(s.quiz), 1), 92)
    content_h = row_h * len(s.quiz)
    y_top = y0 + max(0.0, (avail_h - content_h) / 2)
    if s.image:
        _image_slot(slide, theme, MARGIN_PT + w + _pct_w(0.02), y_top,
                    _pct_w(0.26), content_h, s.image)
    font = font_path(theme.body_font)
    size = theme.size_body
    for i, q in enumerate(s.quiz):
        ry = y_top + i * row_h
        _rect(slide, MARGIN_PT, ry, 30, 30, fill=theme.accent, line=None,
              shape=MSO_SHAPE.OVAL, adjust=None)
        _, ntf = _textbox(slide, MARGIN_PT, ry + 6, 30, 22, MSO_ANCHOR.MIDDLE)
        _write_paragraphs(ntf, [(str(i + 1), [])], theme.display_font, size - 1,
                          theme.bg, align=PP_ALIGN.CENTER)
        _, qtf = _textbox(slide, MARGIN_PT + 44, ry + 2, w - 44, row_h - 8)
        _write_paragraphs(qtf, [(q.q, [])], theme.body_font, size, theme.ink)


def _render_wide_diagram(slide, theme: ThemeConfig, s: Slide):
    y0 = _slide_title(slide, theme, s.title, s.subtitle)
    avail_h = SLIDE_H_PT - y0 - MARGIN_PT
    w = SLIDE_W_PT - 2 * MARGIN_PT
    img_h = avail_h * 0.52
    _image_slot(slide, theme, MARGIN_PT, y0, w, img_h, s.image)
    rest_y = y0 + img_h + 14
    rest_h = SLIDE_H_PT - rest_y - MARGIN_PT
    items = [(b, []) for b in s.bullets] or [(p.text, p.bold_terms) for p in s.paragraphs]
    if not items:
        return
    font = font_path(theme.body_font)
    size, _ = textfit.fit_size([t for t, _ in items], font, w - 20, rest_h,
                               theme.size_body - 1, theme.size_body_min)
    _, tf = _textbox(slide, MARGIN_PT + 14, rest_y, w - 20, rest_h)
    _write_paragraphs(tf, items, theme.body_font, size, theme.ink,
                      space_after_pt=size * 0.35, bullet_char="•")


# --- Сборка ---------------------------------------------------------------

_DISPATCH = {
    Layout.TITLE_HERO: None,  # обрабатывается отдельно (нужен meta)
    Layout.CARD_LEFT_IMAGE_RIGHT: lambda sl, th, s: _render_card_image(sl, th, s, True),
    Layout.CARD_RIGHT_IMAGE_LEFT: lambda sl, th, s: _render_card_image(sl, th, s, False),
    Layout.SPLIT_40_60: lambda sl, th, s: _render_card_image(sl, th, s, True),
    Layout.DEFINITION_TOP: _render_definition_top,
    Layout.COMPARE_TWO_COLS: _render_compare,
    Layout.BULLETS_SUMMARY: _render_bullets_summary,
    Layout.TIMELINE_ROWS: _render_timeline,
    Layout.QUIZ_LIST: _render_quiz,
    Layout.WIDE_DIAGRAM_BULLETS: _render_wide_diagram,
}


def render_deck(deck: Deck, out_path: str) -> str:
    """Собрать PPTX. Возвращает путь к файлу."""
    theme = get_theme(deck.meta.theme.value)
    prs = Presentation()
    # Холст всегда 16:9
    prs.slide_width = _pt(SLIDE_W_PT)
    prs.slide_height = _pt(SLIDE_H_PT)
    blank = prs.slide_layouts[6]  # пустой лейаут

    for s in deck.slides:
        slide = prs.slides.add_slide(blank)
        _slide_bg(slide, theme)
        if s.layout == Layout.TITLE_HERO or s.role == Role.TITLE:
            _render_title_hero(slide, theme, s, deck.meta)
        else:
            fn = _DISPATCH.get(s.layout)
            if fn is None:
                _render_card_image(slide, theme, s, True)
            else:
                fn(slide, theme, s)

    # Гигиена метаданных: чистый title/author, без чужого наследия
    cp = prs.core_properties
    cp.title = deck.meta.topic
    cp.author = deck.meta.author or "Твой урок"
    cp.comments = f"{deck.meta.subject}, {deck.meta.grade} класс. {deck.meta.source_ref}".strip()
    cp.category = "Твой урок"
    cp.keywords = f"{deck.meta.subject}; {deck.meta.grade} класс"

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    prs.save(out_path)
    return out_path
