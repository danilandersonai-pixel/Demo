"""Бюджеты и месячные лимиты по категориям расходов."""

from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from ..categories import EXPENSE_CATEGORIES
from ..keyboards import budget_menu, categories_keyboard, main_menu
from ..utils import fmt_money, month_bounds
from .add_tx import cancel
from .common import get_config, get_db, parse_amount, restricted

BSET_CATEGORY, BSET_AMOUNT, BDEL_CATEGORY = range(20, 23)


@restricted
async def open_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    cfg = get_config(context)
    db = get_db(context)
    budgets = await db.budgets()
    start, end = month_bounds(cfg.timezone, 0)

    lines = ["🎯 <b>Бюджеты на месяц</b>\n"]
    if budgets:
        for cat, limit in budgets:
            spent = await db.category_spent_month(cat, start, end)
            pct = spent / limit * 100 if limit else 0
            bar = _progress_bar(pct)
            mark = "🚨" if spent > limit else ("⚠️" if pct >= 85 else "✅")
            lines.append(
                f"{mark} {cat}\n"
                f"   {bar} {pct:.0f}%\n"
                f"   {fmt_money(spent, cfg.currency)} / {fmt_money(limit, cfg.currency)}"
            )
    else:
        lines.append("<i>Лимиты ещё не заданы.</i>")

    await q.edit_message_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=budget_menu(has_budgets=bool(budgets)),
    )


def _progress_bar(pct: float, width: int = 10) -> str:
    filled = min(width, int(round(pct / 100 * width)))
    return "█" * filled + "░" * (width - filled)


@restricted
async def start_set(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data.clear()
    await q.edit_message_text(
        "Выберите категорию для лимита:",
        reply_markup=categories_keyboard("expense", prefix="bset"),
    )
    return BSET_CATEGORY


@restricted
async def set_category(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    idx = int(q.data.split(":", 1)[1])
    category = EXPENSE_CATEGORIES[idx]
    context.user_data["budget_category"] = category
    await q.edit_message_text(
        f"Категория: {category}\n\n"
        "Введите месячный лимит числом (например, <code>15000</code>):",
        parse_mode="HTML",
    )
    return BSET_AMOUNT


@restricted
async def set_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    limit = parse_amount(update.effective_message.text)
    if limit is None:
        await update.effective_message.reply_text(
            "Не понял сумму. Введите положительное число, например <code>15000</code>.",
            parse_mode="HTML",
        )
        return BSET_AMOUNT
    cfg = get_config(context)
    db = get_db(context)
    category = context.user_data["budget_category"]
    await db.set_budget(category, limit)
    await update.effective_message.reply_text(
        f"✅ Лимит установлен: «{category}» — {fmt_money(limit, cfg.currency)} в месяц.",
        reply_markup=main_menu(),
    )
    context.user_data.clear()
    return ConversationHandler.END


@restricted
async def start_del(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    db = get_db(context)
    budgets = await db.budgets()
    if not budgets:
        await q.edit_message_text("Лимитов нет.", reply_markup=main_menu())
        return ConversationHandler.END

    context.user_data["del_list"] = [c for c, _ in budgets]
    rows = [
        [InlineKeyboardButton(cat, callback_data=f"bdel:{i}")]
        for i, (cat, _) in enumerate(budgets)
    ]
    rows.append([InlineKeyboardButton("✖️ Отмена", callback_data="cancel")])
    await q.edit_message_text(
        "Какой лимит удалить?", reply_markup=InlineKeyboardMarkup(rows)
    )
    return BDEL_CATEGORY


@restricted
async def del_category(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    idx = int(q.data.split(":", 1)[1])
    category = context.user_data.get("del_list", [])[idx]
    db = get_db(context)
    await db.delete_budget(category)
    await q.edit_message_text(
        f"🗑 Лимит по «{category}» удалён.", reply_markup=main_menu()
    )
    context.user_data.clear()
    return ConversationHandler.END


def build_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[
            CallbackQueryHandler(start_set, pattern=r"^budget:set$"),
            CallbackQueryHandler(start_del, pattern=r"^budget:del$"),
        ],
        states={
            BSET_CATEGORY: [CallbackQueryHandler(set_category, pattern=r"^bset:\d+$")],
            BSET_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, set_amount)],
            BDEL_CATEGORY: [CallbackQueryHandler(del_category, pattern=r"^bdel:\d+$")],
        },
        fallbacks=[
            CallbackQueryHandler(cancel, pattern=r"^cancel$"),
            CommandHandler("cancel", cancel),
        ],
        name="budget",
        persistent=False,
    )
