"""Статистика: текстовая сводка и круговой график по категориям."""

from __future__ import annotations

from telegram import Update
from telegram.ext import ContextTypes

from ..keyboards import back_to_menu, period_keyboard, stats_menu
from ..services.charts import category_pie
from ..utils import PERIOD_LABELS, fmt_money, period_bounds
from .common import get_config, get_db, restricted


@restricted
async def open_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await q.edit_message_text(
        "📊 <b>Статистика</b>\nВыберите вид отчёта:",
        parse_mode="HTML",
        reply_markup=stats_menu(),
    )


@restricted
async def choose_summary_period(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await q.edit_message_text(
        "📈 Сводка за период — выберите период:",
        reply_markup=period_keyboard("ssum"),
    )


@restricted
async def choose_chart_period(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await q.edit_message_text(
        "🥧 График по категориям — выберите период:",
        reply_markup=period_keyboard("schart"),
    )


@restricted
async def show_summary(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    cfg = get_config(context)
    db = get_db(context)
    period = q.data.split(":", 1)[1]
    start, end = period_bounds(period, cfg.timezone)

    income, expense = await db.totals(start, end)
    balance = income - expense
    label = PERIOD_LABELS.get(period, period)

    lines = [f"📈 <b>Сводка · {label}</b>\n"]
    lines.append(f"➕ Доходы: <b>{fmt_money(income, cfg.currency)}</b>")
    lines.append(f"➖ Расходы: <b>{fmt_money(expense, cfg.currency)}</b>")
    sign = "🟢" if balance >= 0 else "🔴"
    lines.append(f"{sign} Баланс: <b>{fmt_money(balance, cfg.currency)}</b>\n")

    expenses = await db.by_category("expense", start, end)
    if expenses:
        lines.append("<b>Топ расходов по категориям:</b>")
        for cat, total in expenses[:7]:
            share = total / expense * 100 if expense else 0
            lines.append(f"• {cat}: {fmt_money(total, cfg.currency)} ({share:.0f}%)")
    else:
        lines.append("<i>Расходов за период нет.</i>")

    await q.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=period_keyboard("ssum")
    )


@restricted
async def show_chart(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer("Рисую график…")
    cfg = get_config(context)
    db = get_db(context)
    period = q.data.split(":", 1)[1]
    start, end = period_bounds(period, cfg.timezone)
    label = PERIOD_LABELS.get(period, period)

    pairs = await db.by_category("expense", start, end)
    png = category_pie(pairs, f"Расходы · {label}", cfg.currency)
    if png is None:
        await q.edit_message_text(
            f"За период «{label}» расходов нет — график строить не из чего.",
            reply_markup=period_keyboard("schart"),
        )
        return

    await q.message.reply_photo(
        photo=png,
        caption=f"🥧 Расходы по категориям · {label}",
        reply_markup=back_to_menu(),
    )
