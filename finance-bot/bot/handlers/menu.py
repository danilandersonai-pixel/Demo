"""Главное меню, помощь, последние операции, советы, отмена."""

from __future__ import annotations

from telegram import Update
from telegram.ext import ContextTypes

from ..keyboards import back_to_menu, main_menu
from ..services.advice import build_advice
from ..utils import fmt_money
from .common import get_config, get_db, restricted

WELCOME = (
    "👋 <b>Привет! Я — ваш финансовый помощник.</b>\n\n"
    "Веду общий учёт доходов и расходов на двоих:\n"
    "• ➕➖ записываю приход и уход\n"
    "• 🧾 распознаю сумму с фото чека\n"
    "• 📊 показываю статистику и графики\n"
    "• 🎯 слежу за бюджетами и лимитами\n"
    "• 💡 подсказываю, где можно сэкономить\n\n"
    "Просто пришлите <b>фото чека</b> или выберите действие 👇"
)

HELP = (
    "<b>Как пользоваться</b>\n\n"
    "<b>Добавить операцию:</b> кнопки ➕ Доход / ➖ Расход, затем категория и сумма.\n"
    "<b>Чек:</b> пришлите фото — я распознаю сумму, останется выбрать категорию.\n"
    "<b>Статистика:</b> сводка приход/расход и круговой график по категориям.\n"
    "<b>Бюджеты:</b> задайте месячный лимит на категорию — предупрежу о превышении.\n"
    "<b>Советы:</b> анализ трат и рекомендации по экономии.\n\n"
    "<b>Команды:</b>\n"
    "/start — главное меню\n"
    "/menu — показать меню\n"
    "/help — эта справка\n"
    "/cancel — отменить текущее действие"
)


@restricted
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = get_config(context)
    db = get_db(context)
    user = update.effective_user
    from ..utils import fmt_dt, now_local

    await db.upsert_user(user.id, user.full_name, fmt_dt(now_local(cfg.timezone)))
    await update.effective_message.reply_text(
        WELCOME, parse_mode="HTML", reply_markup=main_menu()
    )


@restricted
async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(HELP, parse_mode="HTML")


@restricted
async def cmd_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "Главное меню:", reply_markup=main_menu()
    )


@restricted
async def go_home(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await q.edit_message_text("Главное меню:", reply_markup=main_menu())


@restricted
async def show_recent(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    cfg = get_config(context)
    db = get_db(context)
    txs = await db.recent(10)
    if not txs:
        await q.edit_message_text(
            "Пока нет ни одной операции.", reply_markup=back_to_menu()
        )
        return

    lines = ["🧾 <b>Последние операции</b>\n"]
    for tx in txs:
        sign = "➕" if tx.kind == "income" else "➖"
        date = tx.created_at[5:16]  # MM-DD HH:MM
        receipt = " 🧾" if tx.receipt_path else ""
        note = f" — {tx.note}" if tx.note else ""
        lines.append(
            f"{sign} {fmt_money(tx.amount, cfg.currency)} · {tx.category}{receipt}\n"
            f"   <i>{date}</i>{note}  <code>/del_{tx.id}</code>"
        )
    lines.append("\n<i>Чтобы удалить операцию — нажмите её команду /del_…</i>")
    await q.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=back_to_menu()
    )


@restricted
async def delete_tx(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    text = msg.text or ""
    try:
        tx_id = int(text.split("_", 1)[1])
    except (IndexError, ValueError):
        await msg.reply_text("Не понял ID операции.")
        return
    cfg = get_config(context)
    db = get_db(context)
    removed = await db.delete_transaction(tx_id)
    if removed is None:
        await msg.reply_text("Операция не найдена (возможно, уже удалена).")
        return
    await msg.reply_text(
        f"🗑 Удалено: {fmt_money(removed.amount, cfg.currency)} · {removed.category}",
        reply_markup=main_menu(),
    )


@restricted
async def show_advice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer("Анализирую траты…")
    cfg = get_config(context)
    db = get_db(context)
    text = await build_advice(db, cfg.timezone, cfg.currency)
    await q.edit_message_text(text, parse_mode="HTML", reply_markup=back_to_menu())
