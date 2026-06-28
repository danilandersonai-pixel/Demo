"""Общие помощники для обработчиков: доступ к конфигу/БД, авторизация, сохранение."""

from __future__ import annotations

import functools
import logging
import re
from typing import Optional

from telegram import Update
from telegram.ext import ContextTypes

from ..config import Config
from ..database import Database
from ..utils import fmt_dt, fmt_money, month_bounds, now_local

logger = logging.getLogger("finance-bot")

_AMOUNT_RE = re.compile(r"-?\d[\d\s.,]*")


def get_config(context: ContextTypes.DEFAULT_TYPE) -> Config:
    return context.bot_data["config"]


def get_db(context: ContextTypes.DEFAULT_TYPE) -> Database:
    return context.bot_data["db"]


def restricted(func):
    """Пропускает только пользователей из ALLOWED_USER_IDS."""

    @functools.wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *a, **kw):
        cfg = get_config(context)
        user = update.effective_user
        if user is None or user.id not in cfg.allowed_user_ids:
            logger.warning(
                "Отказано в доступе: id=%s name=%r username=%s",
                getattr(user, "id", None),
                getattr(user, "full_name", None),
                getattr(user, "username", None),
            )
            if update.callback_query:
                await update.callback_query.answer("Доступ запрещён", show_alert=True)
            elif update.effective_message:
                await update.effective_message.reply_text(
                    "⛔️ Доступ к этому боту ограничен.\n"
                    f"Ваш Telegram ID: <code>{user.id if user else '—'}</code>\n"
                    "Передайте его владельцу бота, чтобы он добавил вас.",
                    parse_mode="HTML",
                )
            return None
        return await func(update, context, *a, **kw)

    return wrapper


def parse_amount(text: str) -> Optional[float]:
    """Разбирает сумму, введённую пользователем вручную."""
    if not text:
        return None
    m = _AMOUNT_RE.search(text)
    if not m:
        return None
    s = m.group().strip().replace(" ", "")
    has_dot, has_comma = "." in s, "," in s
    if has_dot and has_comma:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_comma:
        s = s.replace(",", ".")
    try:
        value = float(s)
    except ValueError:
        return None
    if value <= 0 or value > 100_000_000:
        return None
    return round(value, 2)


async def save_transaction_and_report(
    context: ContextTypes.DEFAULT_TYPE,
    *,
    user_id: int,
    user_name: str,
    kind: str,
    amount: float,
    category: str,
    note: Optional[str],
    receipt_path: Optional[str],
) -> str:
    """Сохраняет операцию и возвращает текст подтверждения (с проверкой бюджета)."""
    cfg = get_config(context)
    db = get_db(context)
    now = now_local(cfg.timezone)

    await db.upsert_user(user_id, user_name, fmt_dt(now))
    await db.add_transaction(
        user_id=user_id,
        kind=kind,
        amount=amount,
        category=category,
        note=note,
        receipt_path=receipt_path,
        created_at=fmt_dt(now),
    )

    sign = "➕" if kind == "income" else "➖"
    word = "Доход" if kind == "income" else "Расход"
    lines = [
        f"{sign} <b>{word} сохранён</b>",
        f"Сумма: <b>{fmt_money(amount, cfg.currency)}</b>",
        f"Категория: {category}",
    ]
    if note:
        lines.append(f"Комментарий: {note}")
    if receipt_path:
        lines.append("🧾 Чек прикреплён")

    # Обновляем закреплённый баланс.
    from ..balance import refresh_pin
    await refresh_pin(context.bot, db, cfg)

    # Проверка лимита для расходов.
    if kind == "expense":
        limit = await db.budget_for(category)
        if limit:
            start, end = month_bounds(cfg.timezone, 0)
            spent = await db.category_spent_month(category, start, end)
            if spent > limit:
                lines.append(
                    f"\n🚨 Лимит по «{category}» превышен: "
                    f"{fmt_money(spent, cfg.currency)} из {fmt_money(limit, cfg.currency)}"
                )
            elif spent >= limit * 0.85:
                lines.append(
                    f"\n⚠️ Почти у лимита «{category}»: "
                    f"{fmt_money(spent, cfg.currency)} из {fmt_money(limit, cfg.currency)}"
                )

    return "\n".join(lines)
