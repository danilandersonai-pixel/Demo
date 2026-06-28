"""Формирование текстовых отчётов за период (для авто-рассылки и команд)."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from .database import Database
from .utils import fmt_money, period_bounds


async def period_report_text(
    db: Database, currency: str, header: str, start: str, end: str
) -> str:
    income, expense = await db.totals(start, end)
    balance = income - expense
    lines = [header, ""]
    lines.append(f"➕ Доходы: {fmt_money(income, currency)}")
    lines.append(f"➖ Расходы: {fmt_money(expense, currency)}")
    sign = "🟢" if balance >= 0 else "🔴"
    lines.append(f"{sign} Баланс: {fmt_money(balance, currency)}")

    cats = await db.by_category("expense", start, end)
    if cats:
        lines.append("\n📊 Топ расходов:")
        for cat, total in cats[:5]:
            share = total / expense * 100 if expense else 0
            lines.append(f"• {cat}: {fmt_money(total, currency)} ({share:.0f}%)")
    return "\n".join(lines)


async def report_for_period(
    db: Database, tz: ZoneInfo, currency: str, period: str, header: str
) -> str:
    start, end = period_bounds(period, tz)
    return await period_report_text(db, currency, header, start, end)
