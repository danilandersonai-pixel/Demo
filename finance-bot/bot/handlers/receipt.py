"""Диалог обработки фото чека: OCR суммы → выбор категории → сохранение расхода."""

from __future__ import annotations

import asyncio

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
from ..keyboards import main_menu, receipt_keyboard
from ..services.ocr import recognize
from ..utils import fmt_money
from .add_tx import cancel
from .common import get_config, parse_amount, restricted, save_transaction_and_report

RECEIPT_CATEGORY, RECEIPT_AMOUNT = range(10, 12)


@restricted
async def on_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = get_config(context)
    msg = update.effective_message
    context.user_data.clear()
    context.user_data["kind"] = "expense"

    notice = await msg.reply_text("🧾 Получил чек, распознаю сумму…")

    # Скачиваем фото максимального качества.
    photo = msg.photo[-1]
    tg_file = await photo.get_file()
    path = cfg.receipts_dir / f"{msg.chat_id}_{tg_file.file_unique_id}.jpg"
    await tg_file.download_to_drive(str(path))
    context.user_data["receipt_path"] = str(path)

    # OCR в отдельном потоке, чтобы не блокировать event loop.
    result = await asyncio.to_thread(recognize, str(path), cfg.ocr_lang)
    context.user_data["amount"] = result.amount

    if result.error:
        body = (
            f"⚠️ {result.error}\n\n"
            "Введите сумму чека вручную числом:"
        )
        await notice.edit_text(body)
        return RECEIPT_AMOUNT

    if result.amount is None:
        await notice.edit_text(
            "Не удалось распознать сумму на чеке 🤔\n"
            "Введите её вручную числом:"
        )
        return RECEIPT_AMOUNT

    await notice.edit_text(
        f"🧾 Распознанная сумма: <b>{fmt_money(result.amount, cfg.currency)}</b>\n\n"
        "Выберите категорию расхода (или исправьте сумму):",
        parse_mode="HTML",
        reply_markup=receipt_keyboard("expense"),
    )
    return RECEIPT_CATEGORY


@restricted
async def receipt_correct(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await q.edit_message_text("✏️ Введите верную сумму чека числом:")
    return RECEIPT_AMOUNT


@restricted
async def receipt_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    amount = parse_amount(update.effective_message.text)
    if amount is None:
        await update.effective_message.reply_text(
            "Не понял сумму. Введите положительное число, например <code>749,90</code>.",
            parse_mode="HTML",
        )
        return RECEIPT_AMOUNT
    context.user_data["amount"] = amount

    # Если категория уже выбрана — сохраняем; иначе предлагаем выбрать.
    if context.user_data.get("category"):
        return await _save(update, context)

    cfg = get_config(context)
    await update.effective_message.reply_text(
        f"Сумма: <b>{fmt_money(amount, cfg.currency)}</b>\n\n"
        "Выберите категорию расхода:",
        parse_mode="HTML",
        reply_markup=receipt_keyboard("expense"),
    )
    return RECEIPT_CATEGORY


@restricted
async def receipt_category(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    idx = int(q.data.split(":", 1)[1])
    context.user_data["category"] = categories_for("expense")[idx]

    if context.user_data.get("amount") is None:
        await q.edit_message_text("Введите сумму чека числом:")
        return RECEIPT_AMOUNT

    return await _save(update, context)


async def _save(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    data = context.user_data
    text = await save_transaction_and_report(
        context,
        user_id=user.id,
        user_name=user.full_name,
        kind="expense",
        amount=data["amount"],
        category=data["category"],
        note=None,
        receipt_path=data.get("receipt_path"),
    )
    target = update.callback_query.message if update.callback_query else update.effective_message
    await target.reply_text(text, parse_mode="HTML", reply_markup=main_menu())
    context.user_data.clear()
    return ConversationHandler.END


def build_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[MessageHandler(filters.PHOTO, on_photo)],
        states={
            RECEIPT_CATEGORY: [
                CallbackQueryHandler(receipt_category, pattern=r"^rcat:\d+$"),
                CallbackQueryHandler(receipt_correct, pattern=r"^rcorrect$"),
            ],
            RECEIPT_AMOUNT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, receipt_amount)
            ],
        },
        fallbacks=[
            CallbackQueryHandler(cancel, pattern=r"^cancel$"),
            CommandHandler("cancel", cancel),
        ],
        name="receipt",
        persistent=False,
    )
