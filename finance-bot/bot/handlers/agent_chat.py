"""Разговорный режим: всё текстовое сообщение обрабатывает LLM-агент."""

from __future__ import annotations

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import ContextTypes, MessageHandler, filters

from ..keyboards import main_menu
from .common import get_config, restricted


@restricted
async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    ai = context.bot_data.get("ai")
    agent = context.bot_data.get("agent")
    msg = update.effective_message
    text = (msg.text or "").strip()
    if not text:
        return

    # Без AI — разговорный режим недоступен, направляем в меню.
    if not (agent and ai and ai.enabled):
        await msg.reply_text(
            "Использую кнопки меню для работы 👇", reply_markup=main_menu()
        )
        return

    await context.bot.send_chat_action(chat_id=msg.chat_id, action=ChatAction.TYPING)

    history = context.user_data.get("agent_history", [])
    user = update.effective_user
    result = await agent.run(
        text, history, user_id=user.id, user_name=user.full_name
    )
    context.user_data["agent_history"] = result.history
    await msg.reply_text(result.text)

    # Баланс мог измениться (агент мог добавить/удалить операцию) — обновим.
    from ..balance import refresh_pin
    await refresh_pin(context.bot, context.bot_data["db"], context.bot_data["config"])


@restricted
async def reset_chat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("agent_history", None)
    await update.effective_message.reply_text(
        "🧹 Контекст разговора очищен. Начнём заново."
    )


def text_handler() -> MessageHandler:
    return MessageHandler(filters.TEXT & ~filters.COMMAND, on_text)
