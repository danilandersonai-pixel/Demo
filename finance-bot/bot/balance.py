"""Закреплённое сообщение с текущим балансом (всегда на виду в чате).

Баланс общий (на двоих). При каждой операции бот обновляет закреплённое
сообщение в чате каждого разрешённого пользователя. id сообщения хранится
в settings (`balance_msg_<chat_id>`).
"""

from __future__ import annotations

import logging

from telegram.error import BadRequest

from .config import Config
from .database import Database
from .utils import fmt_money, period_bounds

logger = logging.getLogger("finance-bot")


async def current_balance(db: Database, tz) -> tuple[float, float, float]:
    start, end = period_bounds("all", tz)
    income, expense = await db.totals(start, end)
    return income, expense, income - expense


def balance_text(income: float, expense: float, currency: str) -> str:
    bal = income - expense
    sign = "🟢" if bal >= 0 else "🔴"
    return (
        f"{sign} <b>Баланс: {fmt_money(bal, currency)}</b>\n"
        f"➕ {fmt_money(income, currency)}   ➖ {fmt_money(expense, currency)}"
    )


async def _update_one(bot, db: Database, uid: int, text: str) -> None:
    key = f"balance_msg_{uid}"
    mid = await db.get_setting(key, "")
    if mid:
        try:
            await bot.edit_message_text(
                text, chat_id=uid, message_id=int(mid), parse_mode="HTML"
            )
            return
        except BadRequest as exc:
            if "not modified" in str(exc).lower():
                return  # баланс не изменился
            # сообщение удалено/недоступно — пересоздадим ниже
        except Exception as exc:  # pragma: no cover
            logger.warning("Не удалось обновить баланс для %s: %s", uid, exc)
            return
    # Создаём и закрепляем новое сообщение.
    try:
        m = await bot.send_message(chat_id=uid, text=text, parse_mode="HTML")
        await bot.pin_chat_message(
            chat_id=uid, message_id=m.message_id, disable_notification=True
        )
        await db.set_setting(key, str(m.message_id))
    except Exception as exc:  # пользователь мог не открыть чат / запретить
        logger.warning("Не удалось закрепить баланс для %s: %s", uid, exc)


async def refresh_pin(bot, db: Database, cfg: Config) -> None:
    """Обновляет закреплённый баланс во всех разрешённых чатах."""
    income, expense, _ = await current_balance(db, cfg.timezone)
    text = balance_text(income, expense, cfg.currency)
    for uid in cfg.allowed_user_ids:
        await _update_one(bot, db, uid, text)
