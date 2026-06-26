"""Вспомогательные функции: время, периоды, форматирование сумм."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DT_FMT = "%Y-%m-%d %H:%M:%S"

PERIOD_LABELS = {
    "today": "Сегодня",
    "week": "Неделя",
    "month": "Месяц",
    "year": "Год",
    "all": "Всё время",
}


def now_local(tz: ZoneInfo) -> datetime:
    return datetime.now(tz)


def now_str(tz: ZoneInfo) -> datetime:
    """Текущее локальное время как строка для БД."""
    return datetime.now(tz)


def fmt_dt(dt: datetime) -> str:
    return dt.strftime(DT_FMT)


def period_bounds(period: str, tz: ZoneInfo) -> tuple[str, str]:
    """Границы периода [start, end) в формате строк БД.

    `all` отдаёт очень широкие границы, охватывающие любые записи.
    """
    now = datetime.now(tz)
    end = now + timedelta(seconds=1)

    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        monday = now - timedelta(days=now.weekday())
        start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "all":
        return "0000-01-01 00:00:00", "9999-12-31 23:59:59"
    else:
        raise ValueError(f"Неизвестный период: {period}")

    return start.strftime(DT_FMT), end.strftime(DT_FMT)


def month_bounds(tz: ZoneInfo, offset_months: int = 0) -> tuple[str, str]:
    """Границы календарного месяца со смещением (0 — текущий, -1 — прошлый)."""
    now = datetime.now(tz)
    year = now.year
    month = now.month + offset_months
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    start = datetime(year, month, 1, tzinfo=tz)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=tz)
    else:
        end = datetime(year, month + 1, 1, tzinfo=tz)
    return start.strftime(DT_FMT), end.strftime(DT_FMT)


def fmt_money(amount: float, currency: str) -> str:
    """Форматирует сумму с разделителями тысяч: 12 345,67 ₽."""
    sign = "-" if amount < 0 else ""
    value = abs(amount)
    whole = int(value)
    frac = round(value - whole, 2)
    grouped = f"{whole:,}".replace(",", " ")
    if frac > 0:
        cents = f"{round(frac * 100):02d}"
        return f"{sign}{grouped},{cents} {currency}"
    return f"{sign}{grouped} {currency}"
