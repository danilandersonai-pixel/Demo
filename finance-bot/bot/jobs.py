"""Запланированные задачи: авто-отчёты, регулярные операции, бэкапы базы."""

from __future__ import annotations

import datetime as dt
import logging
import shutil
from pathlib import Path

from telegram.ext import Application, ContextTypes

from .config import Config
from .database import Database
from .reports import period_report_text, report_for_period
from .services.charts import category_pie
from .utils import fmt_dt, fmt_money, month_bounds, now_local, period_bounds

logger = logging.getLogger("finance-bot")

BACKUP_KEEP = 14


def _cfg(context) -> Config:
    return context.bot_data["config"]


def _db(context) -> Database:
    return context.bot_data["db"]


async def _broadcast(context, text: str, photo: bytes | None = None) -> None:
    cfg = _cfg(context)
    for uid in cfg.allowed_user_ids:
        try:
            if photo:
                await context.bot.send_photo(chat_id=uid, photo=photo, caption=text)
            else:
                await context.bot.send_message(chat_id=uid, text=text)
        except Exception as exc:  # пользователь мог не нажать /start
            logger.warning("Не удалось отправить отчёт пользователю %s: %s", uid, exc)


async def daily_summary_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    db, cfg = _db(context), _cfg(context)
    if await db.get_setting("notify_daily", "1") != "1":
        return
    income, expense = await db.totals(*period_bounds("today", cfg.timezone))
    if income == 0 and expense == 0:
        return  # нечего сообщать
    text = await report_for_period(
        db, cfg.timezone, cfg.currency, "today", "🌙 Итоги дня"
    )
    await _broadcast(context, text)


async def weekly_summary_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    db, cfg = _db(context), _cfg(context)
    if await db.get_setting("notify_weekly", "1") != "1":
        return
    text = await report_for_period(
        db, cfg.timezone, cfg.currency, "week", "📅 Итоги недели"
    )
    await _broadcast(context, text)


async def monthly_report_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    db, cfg = _db(context), _cfg(context)
    if await db.get_setting("notify_monthly", "1") != "1":
        return
    # Отчёт за ПРОШЛЫЙ месяц (задача запускается 1-го числа).
    start, end = month_bounds(cfg.timezone, -1)
    text = await period_report_text(
        db, cfg.currency, "🗓 Отчёт за прошлый месяц", start, end
    )
    pairs = await db.by_category("expense", start, end)
    png = category_pie(pairs, "Расходы за прошлый месяц", cfg.currency)
    await _broadcast(context, text, photo=png)


async def recurring_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Применяет регулярные операции, наступившие в этом месяце."""
    db, cfg = _db(context), _cfg(context)
    now = now_local(cfg.timezone)
    ym = now.strftime("%Y-%m")
    due = await db.due_recurring(now.day, ym)
    applied = []
    for r in due:
        await db.add_transaction(
            user_id=r.get("user_id") or 0,
            kind=r["kind"], amount=r["amount"], category=r["category"],
            note=(r["note"] or "регулярная операция"),
            receipt_path=None, created_at=fmt_dt(now),
        )
        await db.mark_recurring_applied(r["id"], ym)
        applied.append(r)
    if applied:
        from .balance import refresh_pin
        await refresh_pin(context.bot, db, cfg)
        lines = ["🔁 Применены регулярные операции:"]
        for r in applied:
            sign = "➕" if r["kind"] == "income" else "➖"
            lines.append(f"{sign} {fmt_money(r['amount'], cfg.currency)} · {r['category']}")
        await _broadcast(context, "\n".join(lines))


async def backup_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Ежедневный бэкап файла базы; хранит последние BACKUP_KEEP копий."""
    cfg = _cfg(context)
    db_path = Path(cfg.db_path)
    if not db_path.exists():
        return
    backups = db_path.parent / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = now_local(cfg.timezone).strftime("%Y-%m-%d")
    dest = backups / f"finance-{stamp}.db"
    try:
        shutil.copy2(db_path, dest)
    except Exception as exc:  # pragma: no cover
        logger.warning("Бэкап не удался: %s", exc)
        return
    # Чистим старые копии.
    files = sorted(backups.glob("finance-*.db"))
    for old in files[:-BACKUP_KEEP]:
        try:
            old.unlink()
        except OSError:
            pass
    logger.info("Бэкап базы создан: %s", dest.name)


def setup(app: Application) -> None:
    """Регистрирует все периодические задачи."""
    jq = app.job_queue
    if jq is None:
        logger.warning("JobQueue недоступен — авто-отчёты и бэкапы выключены.")
        return
    tz = app.bot_data["config"].timezone

    jq.run_daily(recurring_job, time=dt.time(0, 30, tzinfo=tz), name="recurring")
    jq.run_daily(daily_summary_job, time=dt.time(21, 0, tzinfo=tz), name="daily")
    jq.run_daily(
        weekly_summary_job, time=dt.time(21, 0, tzinfo=tz), days=(0,), name="weekly"
    )
    jq.run_daily(backup_job, time=dt.time(4, 0, tzinfo=tz), name="backup")
    try:
        jq.run_monthly(monthly_report_job, when=dt.time(10, 0, tzinfo=tz), day=1)
    except Exception as exc:  # совместимость версий PTB
        logger.warning("Не удалось запланировать месячный отчёт: %s", exc)
    logger.info("Запланированные задачи зарегистрированы (отчёты, регулярные, бэкап).")
