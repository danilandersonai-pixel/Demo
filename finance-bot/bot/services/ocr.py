"""Распознавание суммы с фотографии чека (Tesseract OCR).

Подход: прогоняем изображение через Tesseract, затем эвристически вытаскиваем
итоговую сумму. Сначала ищем строки с ключевыми словами (ИТОГ/ВСЕГО/К ОПЛАТЕ),
если не нашли — берём наибольшую денежную величину. Результат всегда требует
подтверждения пользователем, поэтому ошибки распознавания не критичны.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Ключевые слова «итоговой» строки чека (в порядке приоритета).
TOTAL_KEYWORDS = [
    "ИТОГ",
    "ИТОГО",
    "К ОПЛАТЕ",
    "К ОПЛ",
    "ВСЕГО",
    "СУММА",
    "TOTAL",
    "ОПЛАТА",
]

# Число вида 1 234,56 / 1234.56 / 1.234,56 / 1234
_NUMBER_RE = re.compile(r"\d[\d\s.,]*\d|\d")


@dataclass
class OcrResult:
    amount: Optional[float]
    raw_text: str
    error: Optional[str] = None


def _normalize_number(token: str) -> Optional[float]:
    """Приводит «1 234,56» / «1.234,56» / «1234.56» к float."""
    s = token.strip().replace(" ", "")
    if not s:
        return None

    has_dot = "." in s
    has_comma = "," in s

    if has_dot and has_comma:
        # Последний разделитель считаем десятичным.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_comma:
        # Запятая как десятичный разделитель (типично для РФ).
        s = s.replace(",", ".")
    # только точка или только цифры — оставляем как есть

    # Уберём всё, кроме цифр и одной точки.
    if s.count(".") > 1:
        head, _, tail = s.rpartition(".")
        s = head.replace(".", "") + "." + tail

    try:
        value = float(s)
    except ValueError:
        return None
    if value <= 0 or value > 10_000_000:
        return None
    return value


def _numbers_in(line: str) -> list[float]:
    out = []
    for m in _NUMBER_RE.finditer(line):
        val = _normalize_number(m.group())
        if val is not None:
            out.append(val)
    return out


def extract_amount(text: str) -> Optional[float]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    upper = [ln.upper() for ln in lines]

    # 1) Строки с ключевыми словами — берём максимальное число в такой строке.
    candidates: list[float] = []
    for kw in TOTAL_KEYWORDS:
        for ln in upper:
            if kw in ln:
                nums = _numbers_in(ln)
                if nums:
                    candidates.append(max(nums))
        if candidates:
            return max(candidates)

    # 2) Фолбэк: наибольшая денежная величина во всём тексте.
    all_nums = []
    for ln in lines:
        all_nums.extend(_numbers_in(ln))
    return max(all_nums) if all_nums else None


def recognize(image_path: str, lang: str = "rus+eng") -> OcrResult:
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except ImportError as exc:  # pragma: no cover
        return OcrResult(None, "", f"Не установлены зависимости OCR: {exc}")

    try:
        img = Image.open(image_path)
        img = ImageOps.exif_transpose(img)
        img = ImageOps.grayscale(img)
        # Лёгкое увеличение контраста для мелкого шрифта чеков.
        img = ImageOps.autocontrast(img)
        text = pytesseract.image_to_string(img, lang=lang)
    except pytesseract.TesseractNotFoundError:
        return OcrResult(
            None,
            "",
            "Tesseract не установлен на сервере. См. README (раздел про OCR).",
        )
    except Exception as exc:  # pragma: no cover
        return OcrResult(None, "", f"Ошибка распознавания: {exc}")

    return OcrResult(amount=extract_amount(text), raw_text=text)
