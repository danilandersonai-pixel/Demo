"""Аналитика и советы по экономии.

Сравнивает текущий месяц с предыдущим, ищет рост категорий, превышение
бюджетов, частые мелкие траты и формирует понятные текстовые рекомендации.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

from ..database import Database
from ..utils import fmt_money, month_bounds


async def build_advice(db: Database, tz: ZoneInfo, currency: str) -> str:
    cur_start, cur_end = month_bounds(tz, 0)
    prev_start, prev_end = month_bounds(tz, -1)

    cur = dict(await _expense_map(db, cur_start, cur_end))
    prev = dict(await _expense_map(db, prev_start, prev_end))
    counts = {c: (n, t) for c, n, t in await db.count_by_category("expense", cur_start, cur_end)}
    budgets = dict(await db.budgets())

    income, expense = await db.totals(cur_start, cur_end)

    tips: list[str] = []

    # 1) Общий баланс месяца.
    if expense > 0:
        if income > 0:
            rate = (income - expense) / income * 100
            if rate < 0:
                tips.append(
                    "🔴 В этом месяце расходы превышают доходы. "
                    "Стоит притормозить необязательные покупки."
                )
            elif rate < 10:
                tips.append(
                    f"🟡 Откладывается лишь {rate:.0f}% дохода. "
                    "Цель «10–20%» — хороший ориентир для подушки безопасности."
                )
            else:
                tips.append(
                    f"🟢 Отлично: сохраняется {rate:.0f}% дохода в этом месяце."
                )

    # 2) Категории, заметно выросшие к прошлому месяцу.
    growth = []
    for cat, val in cur.items():
        was = prev.get(cat, 0.0)
        if was >= 500 and val > was * 1.3:
            growth.append((cat, was, val, val - was))
    growth.sort(key=lambda x: x[3], reverse=True)
    for cat, was, val, diff in growth[:3]:
        pct = (val - was) / was * 100
        tips.append(
            f"📈 «{cat}»: рост на {pct:.0f}% "
            f"({fmt_money(was, currency)} → {fmt_money(val, currency)}). "
            f"Это +{fmt_money(diff, currency)} к прошлому месяцу."
        )

    # 3) Превышение/приближение к бюджету.
    for cat, limit in budgets.items():
        spent = cur.get(cat, 0.0)
        if spent > limit:
            tips.append(
                f"🚨 Лимит по «{cat}» превышен: "
                f"{fmt_money(spent, currency)} из {fmt_money(limit, currency)}."
            )
        elif spent >= limit * 0.85:
            tips.append(
                f"⚠️ «{cat}» почти у лимита: "
                f"{fmt_money(spent, currency)} из {fmt_money(limit, currency)}."
            )

    # 4) Частые мелкие траты (много операций — кандидат на оптимизацию).
    frequent = sorted(
        ((c, n, t) for c, (n, t) in counts.items() if n >= 8),
        key=lambda x: x[2],
        reverse=True,
    )
    for cat, n, total in frequent[:2]:
        avg = total / n
        tips.append(
            f"☕ «{cat}»: {n} операций на {fmt_money(total, currency)} "
            f"(в среднем {fmt_money(avg, currency)}). "
            "Частые мелкие траты незаметно складываются в крупную сумму."
        )

    # 5) Самая тяжёлая категория.
    if cur:
        top_cat, top_val = max(cur.items(), key=lambda x: x[1])
        share = top_val / expense * 100 if expense else 0
        if share >= 30:
            tips.append(
                f"🎯 Главная статья расходов — «{top_cat}» "
                f"({share:.0f}% всех трат, {fmt_money(top_val, currency)}). "
                "Даже небольшая экономия здесь даст заметный эффект."
            )

    if not tips:
        return (
            "💡 <b>Советы по экономии</b>\n\n"
            "Пока недостаточно данных для анализа. Добавьте операции за "
            "пару недель — и я подскажу, где можно оптимизировать траты."
        )

    header = "💡 <b>Советы по экономии (этот месяц)</b>\n\n"
    return header + "\n\n".join(tips)


async def _expense_map(db: Database, start: str, end: str) -> list[tuple[str, float]]:
    return await db.by_category("expense", start, end)


async def build_stats_summary(db: Database, tz: ZoneInfo, currency: str) -> str:
    """Компактная фактическая сводка трат для передачи в LLM."""
    cur_start, cur_end = month_bounds(tz, 0)
    prev_start, prev_end = month_bounds(tz, -1)

    income, expense = await db.totals(cur_start, cur_end)
    cur = await db.by_category("expense", cur_start, cur_end)
    prev = dict(await db.by_category("expense", prev_start, prev_end))
    counts = {c: n for c, n, _ in await db.count_by_category("expense", cur_start, cur_end)}
    budgets = dict(await db.budgets())

    lines = [
        "Сводка за текущий месяц (валюта: " + currency + "):",
        f"Доходы: {income:.0f}; Расходы: {expense:.0f}; Баланс: {income - expense:.0f}",
        "Расходы по категориям (этот месяц | прошлый месяц | число операций):",
    ]
    for cat, val in cur:
        was = prev.get(cat, 0.0)
        n = counts.get(cat, 0)
        lines.append(f"- {cat}: {val:.0f} | {was:.0f} | {n} оп.")
    if budgets:
        lines.append("Лимиты (категория: лимит):")
        for cat, lim in budgets.items():
            lines.append(f"- {cat}: {lim:.0f}")
    if not cur:
        lines.append("(расходов пока нет)")
    return "\n".join(lines)
