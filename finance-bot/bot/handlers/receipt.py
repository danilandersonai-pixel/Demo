"""Диалог обработки фото чека.

Если подключён OpenRouter — сумму, магазин и категорию распознаёт vision-модель;
иначе откат на Tesseract OCR. В обоих случаях пользователь подтверждает результат.
"""

from __future__ import annotations

import asyncio

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from ..categories import EXPENSE_CATEGORIES, categories_for
from ..keyboards import main_menu, receipt_keyboard
from ..services.ocr import recognize
from ..utils import fmt_money
from .add_tx import cancel
from .common import get_config, parse_amount, restricted, save_transaction_and_report

RECEIPT_CATEGORY, RECEIPT_AMOUNT = range(10, 12)


def _keyboard_with_suggestion(suggested: str | None) -> InlineKeyboardMarkup:
    """Клавиатура категорий чека; если есть предложенная — кнопка быстрого выбора."""
    base = receipt_keyboard("expense")
    if not suggested or suggested not in EXPENSE_CATEGORIES:
        return base
    idx = EXPENSE_CATEGORIES.index(suggested)
    confirm = [InlineKeyboardButton(f"✅ {suggested}", callback_data=f"rcat:{idx}")]
    return InlineKeyboardMarkup([confirm] + list(base.inline_keyboard))


@restricted
async def on_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = get_config(context)
    ai = context.bot_data.get("ai")
    msg = update.effective_message
    context.user_data.clear()
    context.user_data["kind"] = "expense"

    notice = await msg.reply_text("🧾 Получил чек, распознаю…")

    # Скачиваем фото максимального качества.
    photo = msg.photo[-1]
    tg_file = await photo.get_file()
    path = cfg.receipts_dir / f"{msg.chat_id}_{tg_file.file_unique_id}.jpg"
    await tg_file.download_to_drive(str(path))
    context.user_data["receipt_path"] = str(path)

    amount = None
    suggested = None
    note = None

    # 1) Пытаемся распознать vision-моделью (точнее и сразу с категорией).
    if ai and ai.enabled:
        try:
            with open(path, "rb") as fh:
                img_bytes = fh.read()
            data = await ai.read_receipt(img_bytes, EXPENSE_CATEGORIES)
        except Exception:
            data = None
        if data:
            amount = data.amount
            suggested = data.category
            parts = [p for p in (data.merchant, data.note) if p]
            note = " · ".join(parts) if parts else None

    # 2) Фолбэк на Tesseract, если AI недоступен/не справился с суммой.
    if amount is None:
        result = await asyncio.to_thread(recognize, str(path), cfg.ocr_lang)
        if result.amount is not None:
            amount = result.amount

    context.user_data["amount"] = amount
    context.user_data["category"] = suggested
    context.user_data["note"] = note

    if amount is None:
        await notice.edit_text(
            "Не удалось распознать сумму на чеке 🤔\nВведите её вручную числом:"
        )
        return RECEIPT_AMOUNT

    head = "🧾 "
    if note:
        head += f"<i>{note}</i>\n"
    body = (
        f"{head}Сумма: <b>{fmt_money(amount, cfg.currency)}</b>\n\n"
        "Подтвердите категорию (или исправьте сумму):"
    )
    await notice.edit_text(
        body, parse_mode="HTML", reply_markup=_keyboard_with_suggestion(suggested)
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
        note=data.get("note"),
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
