"""Ввод операции произвольным текстом через LLM («кофе 250», «зарплата 50к»)."""

from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CallbackQueryHandler, ContextTypes, MessageHandler, filters

from ..categories import EXPENSE_CATEGORIES, INCOME_CATEGORIES, categories_for
from ..keyboards import categories_keyboard, main_menu
from ..utils import fmt_money
from .common import get_config, restricted, save_transaction_and_report


def _card(context: ContextTypes.DEFAULT_TYPE) -> tuple[str, InlineKeyboardMarkup]:
    cfg = get_config(context)
    nl = context.user_data["nl"]
    word = "Доход" if nl["kind"] == "income" else "Расход"
    sign = "➕" if nl["kind"] == "income" else "➖"
    lines = [
        "🤖 <b>Распознал операцию</b>",
        f"{sign} {word}: <b>{fmt_money(nl['amount'], cfg.currency)}</b>",
        f"🏷 Категория: {nl['category']}",
    ]
    if nl.get("note"):
        lines.append(f"💬 {nl['note']}")
    lines.append("\nВсё верно?")
    toggle_word = "→ Расход" if nl["kind"] == "income" else "→ Доход"
    kb = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("✅ Сохранить", callback_data="nl:save")],
            [
                InlineKeyboardButton("🏷 Категория", callback_data="nl:cat"),
                InlineKeyboardButton(toggle_word, callback_data="nl:toggle"),
            ],
            [InlineKeyboardButton("✖️ Отмена", callback_data="nl:cancel")],
        ]
    )
    return "\n".join(lines), kb


@restricted
async def on_free_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = get_config(context)
    ai = context.bot_data.get("ai")
    msg = update.effective_message
    text = (msg.text or "").strip()
    if not text:
        return

    if not (ai and ai.enabled):
        await msg.reply_text(
            "Не понял 🤔 Используйте кнопки меню для добавления операции.",
            reply_markup=main_menu(),
        )
        return

    thinking = await msg.reply_text("🤖 Распознаю…")
    parsed = await ai.parse_transaction(text, EXPENSE_CATEGORIES, INCOME_CATEGORIES)
    if parsed is None or parsed.confidence < 0.4:
        await thinking.edit_text(
            "Не понял операцию 🤔 Напишите, например, «кофе 250» или "
            "«зарплата 50000», либо воспользуйтесь меню.",
            reply_markup=main_menu(),
        )
        return

    context.user_data["nl"] = {
        "kind": parsed.kind,
        "amount": parsed.amount,
        "category": parsed.category,
        "note": parsed.note,
    }
    text_card, kb = _card(context)
    await thinking.edit_text(text_card, parse_mode="HTML", reply_markup=kb)


@restricted
async def nl_toggle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    nl = context.user_data.get("nl")
    if not nl:
        await q.edit_message_text("Сессия истекла. Повторите ввод.", reply_markup=main_menu())
        return
    nl["kind"] = "expense" if nl["kind"] == "income" else "income"
    nl["category"] = categories_for(nl["kind"])[-1]  # сброс на «Прочее»
    text_card, kb = _card(context)
    await q.edit_message_text(text_card, parse_mode="HTML", reply_markup=kb)


@restricted
async def nl_choose_cat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    nl = context.user_data.get("nl")
    if not nl:
        await q.edit_message_text("Сессия истекла. Повторите ввод.", reply_markup=main_menu())
        return
    await q.edit_message_text(
        "Выберите категорию:",
        reply_markup=categories_keyboard(nl["kind"], prefix="nlcat"),
    )


@restricted
async def nl_set_cat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    nl = context.user_data.get("nl")
    if not nl:
        await q.edit_message_text("Сессия истекла. Повторите ввод.", reply_markup=main_menu())
        return
    idx = int(q.data.split(":", 1)[1])
    nl["category"] = categories_for(nl["kind"])[idx]
    text_card, kb = _card(context)
    await q.edit_message_text(text_card, parse_mode="HTML", reply_markup=kb)


@restricted
async def nl_save(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    nl = context.user_data.get("nl")
    if not nl:
        await q.edit_message_text("Сессия истекла. Повторите ввод.", reply_markup=main_menu())
        return
    user = update.effective_user
    report = await save_transaction_and_report(
        context,
        user_id=user.id,
        user_name=user.full_name,
        kind=nl["kind"],
        amount=nl["amount"],
        category=nl["category"],
        note=nl.get("note"),
        receipt_path=None,
    )
    await q.edit_message_text(report, parse_mode="HTML", reply_markup=main_menu())
    context.user_data.pop("nl", None)


@restricted
async def nl_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer("Отменено")
    context.user_data.pop("nl", None)
    await q.edit_message_text("Отменено.", reply_markup=main_menu())


def register(app) -> None:
    app.add_handler(CallbackQueryHandler(nl_save, pattern=r"^nl:save$"))
    app.add_handler(CallbackQueryHandler(nl_toggle, pattern=r"^nl:toggle$"))
    app.add_handler(CallbackQueryHandler(nl_choose_cat, pattern=r"^nl:cat$"))
    app.add_handler(CallbackQueryHandler(nl_cancel, pattern=r"^nl:cancel$"))
    app.add_handler(CallbackQueryHandler(nl_set_cat, pattern=r"^nlcat:\d+$"))


def text_handler() -> MessageHandler:
    return MessageHandler(filters.TEXT & ~filters.COMMAND, on_free_text)
