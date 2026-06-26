"""Диалог добавления операции вручную (доход/расход → категория → сумма → заметка)."""

from __future__ import annotations

from telegram import Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from ..categories import categories_for
from ..keyboards import (
    categories_keyboard,
    main_menu,
    skip_note_keyboard,
)
from ..utils import fmt_money
from .common import get_config, parse_amount, restricted, save_transaction_and_report

CHOOSING_CATEGORY, ENTERING_AMOUNT, ENTERING_NOTE = range(3)


@restricted
async def start_add(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    kind = q.data.split(":", 1)[1]  # income | expense
    context.user_data.clear()
    context.user_data["kind"] = kind
    word = "дохода" if kind == "income" else "расхода"
    await q.edit_message_text(
        f"Выберите категорию {word}:",
        reply_markup=categories_keyboard(kind, prefix="cat"),
    )
    return CHOOSING_CATEGORY


@restricted
async def choose_category(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    idx = int(q.data.split(":", 1)[1])
    kind = context.user_data["kind"]
    category = categories_for(kind)[idx]
    context.user_data["category"] = category
    await q.edit_message_text(
        f"Категория: {category}\n\n💬 Введите <b>сумму</b> числом "
        "(например, <code>1250</code> или <code>349,90</code>):",
        parse_mode="HTML",
    )
    return ENTERING_AMOUNT


@restricted
async def enter_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    amount = parse_amount(update.effective_message.text)
    if amount is None:
        await update.effective_message.reply_text(
            "Не понял сумму 🤔 Введите положительное число, например <code>500</code>.",
            parse_mode="HTML",
        )
        return ENTERING_AMOUNT
    context.user_data["amount"] = amount
    cfg = get_config(context)
    await update.effective_message.reply_text(
        f"Сумма: <b>{fmt_money(amount, cfg.currency)}</b>\n\n"
        "Добавьте комментарий или пропустите:",
        parse_mode="HTML",
        reply_markup=skip_note_keyboard(),
    )
    return ENTERING_NOTE


@restricted
async def enter_note_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    note = (update.effective_message.text or "").strip() or None
    return await _finish(update, context, note)


@restricted
async def skip_note(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    return await _finish(update, context, None)


async def _finish(update: Update, context: ContextTypes.DEFAULT_TYPE, note):
    user = update.effective_user
    data = context.user_data
    text = await save_transaction_and_report(
        context,
        user_id=user.id,
        user_name=user.full_name,
        kind=data["kind"],
        amount=data["amount"],
        category=data["category"],
        note=note,
        receipt_path=None,
    )
    target = update.callback_query.message if update.callback_query else update.effective_message
    await target.reply_text(text, parse_mode="HTML", reply_markup=main_menu())
    context.user_data.clear()
    return ConversationHandler.END


@restricted
async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    if update.callback_query:
        await update.callback_query.answer("Отменено")
        await update.callback_query.edit_message_text(
            "Действие отменено.", reply_markup=main_menu()
        )
    else:
        await update.effective_message.reply_text(
            "Действие отменено.", reply_markup=main_menu()
        )
    return ConversationHandler.END


def build_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CallbackQueryHandler(start_add, pattern=r"^add:(income|expense)$")],
        states={
            CHOOSING_CATEGORY: [CallbackQueryHandler(choose_category, pattern=r"^cat:\d+$")],
            ENTERING_AMOUNT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, enter_amount)
            ],
            ENTERING_NOTE: [
                CallbackQueryHandler(skip_note, pattern=r"^note:skip$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, enter_note_text),
            ],
        },
        fallbacks=[
            CallbackQueryHandler(cancel, pattern=r"^cancel$"),
            CommandHandler("cancel", cancel),
        ],
        name="add_transaction",
        persistent=False,
    )
