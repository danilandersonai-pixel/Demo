"""Доп. возможности: настройки уведомлений, экспорт CSV, голосовой ввод."""

from __future__ import annotations

import asyncio
import base64
import csv
import io
import subprocess
import tempfile
from pathlib import Path

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatAction
from telegram.ext import ContextTypes

from ..keyboards import back_to_menu
from ..utils import PERIOD_LABELS, fmt_money, month_bounds, period_bounds
from .common import get_config, get_db, restricted


def _bar(pct: float, width: int = 10) -> str:
    filled = min(width, int(round(pct / 100 * width)))
    return "█" * filled + "░" * (width - filled)


# ---------- цели ----------

@restricted
async def show_goals(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    cfg, db = get_config(context), get_db(context)
    goals = await db.list_goals()
    lines = ["🐷 <b>Цели накопления</b>\n"]
    if goals:
        for g in goals:
            pct = g["saved"] / g["target"] * 100 if g["target"] else 0
            done = "✅ " if g["saved"] >= g["target"] else ""
            lines.append(
                f"{done}<b>{g['name']}</b>\n"
                f"{_bar(pct)} {pct:.0f}%\n"
                f"{fmt_money(g['saved'], cfg.currency)} из {fmt_money(g['target'], cfg.currency)}"
            )
    else:
        lines.append("<i>Целей пока нет.</i>")
    lines.append(
        "\n💬 Создать/пополнить — словами:\n"
        "«создай цель отпуск 100000», «отложи 5000 в отпуск»"
    )
    await q.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=back_to_menu()
    )


# ---------- регулярные ----------

@restricted
async def show_recurring(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    cfg, db = get_config(context), get_db(context)
    recs = await db.list_recurring()
    lines = ["🔁 <b>Регулярные операции</b>\n"]
    if recs:
        for r in recs:
            sign = "➕" if r["kind"] == "income" else "➖"
            note = f" — {r['note']}" if r["note"] else ""
            lines.append(
                f"{sign} {fmt_money(r['amount'], cfg.currency)} · {r['category']}{note}\n"
                f"   📅 каждое {r['day']}-е число"
            )
    else:
        lines.append("<i>Регулярных операций пока нет.</i>")
    lines.append(
        "\n💬 Добавить — словами:\n"
        "«добавь регулярную зарплату 60000 пятого числа»"
    )
    await q.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=back_to_menu()
    )


# ---------- кто кому должен ----------

@restricted
async def show_settlement(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    cfg, db = get_config(context), get_db(context)
    start, end = month_bounds(cfg.timezone, 0)
    rows = await db.totals_by_user(start, end)
    names = await db.all_user_names()

    lines = ["👥 <b>Разбивка за месяц</b>\n"]
    payers = []
    for uid, inc, exp in rows:
        name = names.get(uid, str(uid))
        lines.append(f"<b>{name}</b>: расход {fmt_money(exp, cfg.currency)}")
        if exp > 0:
            payers.append((name, exp))

    total = sum(e for _, e in payers)
    if len(payers) == 2 and total > 0:
        fair = total / 2
        (na, ea), (nb, eb) = payers
        diff = round(ea - fair, 2)
        lines.append("")
        if abs(diff) < 0.01:
            lines.append("🤝 Расходы поделены поровну — никто никому не должен.")
        elif diff > 0:
            lines.append(f"➡️ <b>{nb}</b> должен(на) <b>{na}</b>: {fmt_money(abs(diff), cfg.currency)}")
        else:
            lines.append(f"➡️ <b>{na}</b> должен(на) <b>{nb}</b>: {fmt_money(abs(diff), cfg.currency)}")
    elif total > 0:
        lines.append("\n<i>Расчёт долга считается, когда расходы есть у обоих.</i>")
    else:
        lines.append("\n<i>За этот месяц расходов пока нет.</i>")

    await q.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=back_to_menu()
    )

# ---------- настройки уведомлений ----------

_NOTIFY = [
    ("notify_daily", "Ежедневная сводка"),
    ("notify_weekly", "Недельная сводка"),
    ("notify_monthly", "Месячный отчёт"),
]


async def _settings_kb(db) -> InlineKeyboardMarkup:
    rows = []
    for key, label in _NOTIFY:
        on = await db.get_setting(key, "1") == "1"
        mark = "🔔" if on else "🔕"
        rows.append([InlineKeyboardButton(f"{mark} {label}", callback_data=f"set:{key}")])
    rows.append([InlineKeyboardButton("« Меню", callback_data="menu:home")])
    return InlineKeyboardMarkup(rows)


@restricted
async def cmd_settings(update: Update, context: ContextTypes.DEFAULT_TYPE):
    db = get_db(context)
    await update.effective_message.reply_text(
        "⚙️ <b>Настройки уведомлений</b>\nНажмите, чтобы включить/выключить:",
        parse_mode="HTML",
        reply_markup=await _settings_kb(db),
    )


@restricted
async def toggle_setting(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    key = q.data.split(":", 1)[1]
    db = get_db(context)
    cur = await db.get_setting(key, "1")
    await db.set_setting(key, "0" if cur == "1" else "1")
    await q.answer("Сохранено")
    await q.edit_message_reply_markup(reply_markup=await _settings_kb(db))


# ---------- экспорт CSV ----------

@restricted
async def cmd_export(update: Update, context: ContextTypes.DEFAULT_TYPE):
    rows = [
        [InlineKeyboardButton(PERIOD_LABELS[p], callback_data=f"export:{p}")]
        for p in ("month", "year", "all")
    ]
    rows.append([InlineKeyboardButton("« Меню", callback_data="menu:home")])
    await update.effective_message.reply_text(
        "📤 Экспорт операций в CSV (открывается в Excel/Google Sheets).\nВыберите период:",
        reply_markup=InlineKeyboardMarkup(rows),
    )


@restricted
async def do_export(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer("Готовлю файл…")
    cfg, db = get_config(context), get_db(context)
    period = q.data.split(":", 1)[1]
    start, end = period_bounds(period, cfg.timezone)
    txs = await db.all_transactions(start, end)
    names = await db.all_user_names()

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Дата", "Тип", "Сумма", "Категория", "Комментарий", "Кто"])
    for t in txs:
        writer.writerow([
            t.created_at, "доход" if t.kind == "income" else "расход",
            f"{t.amount:.2f}", t.category, t.note or "",
            names.get(t.user_id, str(t.user_id)),
        ])
    data = ("﻿" + buf.getvalue()).encode("utf-8")  # BOM для Excel
    bio = io.BytesIO(data)
    bio.name = f"finance-{period}.csv"
    await q.message.reply_document(
        document=bio, filename=bio.name,
        caption=f"📤 Операции за период «{PERIOD_LABELS.get(period, period)}» — {len(txs)} шт.",
    )


# ---------- голосовой ввод ----------

def _convert_to_mp3(src: str) -> bytes | None:
    """Конвертирует голосовое (ogg/opus) в mp3 через ffmpeg."""
    out = src + ".mp3"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", out],
            check=True, capture_output=True, timeout=60,
        )
        return Path(out).read_bytes()
    except Exception:
        return None
    finally:
        try:
            Path(out).unlink()
        except OSError:
            pass


@restricted
async def on_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    ai = context.bot_data.get("ai")
    agent = context.bot_data.get("agent")
    msg = update.effective_message
    if not (ai and ai.enabled and agent):
        await msg.reply_text("Голосовой ввод недоступен (AI выключен).")
        return

    await context.bot.send_chat_action(chat_id=msg.chat_id, action=ChatAction.TYPING)
    note = await msg.reply_text("🎤 Распознаю голосовое…")

    voice = msg.voice or msg.audio
    tg_file = await voice.get_file()
    with tempfile.NamedTemporaryFile(suffix=".oga", delete=False) as tmp:
        src = tmp.name
    await tg_file.download_to_drive(src)

    mp3 = await asyncio.to_thread(_convert_to_mp3, src)
    try:
        Path(src).unlink()
    except OSError:
        pass
    if mp3 is None:
        await note.edit_text("Не удалось обработать аудио 🤔 Напишите текстом.")
        return

    b64 = base64.b64encode(mp3).decode()
    text = await ai.transcribe(b64, fmt="mp3")
    if not text:
        await note.edit_text("Не разобрал, что сказано 🤔 Попробуйте ещё раз или текстом.")
        return

    await note.edit_text(f"🎤 «{text}»")
    history = context.user_data.get("agent_history", [])
    user = update.effective_user
    result = await agent.run(text, history, user_id=user.id, user_name=user.full_name)
    context.user_data["agent_history"] = result.history
    await msg.reply_text(result.text)
