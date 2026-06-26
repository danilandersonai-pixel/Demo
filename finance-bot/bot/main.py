"""Точка входа: сборка приложения python-telegram-bot и регистрация обработчиков."""

from __future__ import annotations

import logging

from telegram import BotCommand, Update
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from .config import Config
from .database import Database
from .handlers import add_tx, budget, menu, receipt, stats

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("finance-bot")

BOT_COMMANDS = [
    BotCommand("start", "Главное меню"),
    BotCommand("menu", "Показать меню"),
    BotCommand("help", "Справка"),
    BotCommand("cancel", "Отменить текущее действие"),
]


async def _post_init(app: Application) -> None:
    db: Database = app.bot_data["db"]
    await db.init()
    await app.bot.set_my_commands(BOT_COMMANDS)
    logger.info("Бот запущен. Разрешённые ID: %s", app.bot_data["config"].allowed_user_ids)


async def _on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.exception("Ошибка при обработке обновления", exc_info=context.error)
    if isinstance(update, Update) and update.effective_message:
        try:
            await update.effective_message.reply_text(
                "⚠️ Что-то пошло не так. Попробуйте ещё раз или /menu."
            )
        except Exception:  # pragma: no cover
            pass


def build_application() -> Application:
    cfg = Config.from_env()
    db = Database(cfg.db_path)

    app = ApplicationBuilder().token(cfg.token).post_init(_post_init).build()
    app.bot_data["config"] = cfg
    app.bot_data["db"] = db

    # --- Команды ---
    app.add_handler(CommandHandler("start", menu.cmd_start))
    app.add_handler(CommandHandler("help", menu.cmd_help))
    app.add_handler(CommandHandler("menu", menu.cmd_menu))
    app.add_handler(MessageHandler(filters.Regex(r"^/del_\d+$"), menu.delete_tx))

    # --- Диалоги (должны идти раньше общих обработчиков) ---
    app.add_handler(add_tx.build_handler())
    app.add_handler(receipt.build_handler())
    app.add_handler(budget.build_handler())

    # --- Навигация по меню ---
    app.add_handler(CallbackQueryHandler(menu.go_home, pattern=r"^menu:home$"))
    app.add_handler(CallbackQueryHandler(menu.show_recent, pattern=r"^recent:show$"))
    app.add_handler(CallbackQueryHandler(menu.show_advice, pattern=r"^advice:show$"))

    # --- Статистика ---
    app.add_handler(CallbackQueryHandler(stats.open_menu, pattern=r"^stats:menu$"))
    app.add_handler(
        CallbackQueryHandler(stats.choose_summary_period, pattern=r"^stats:summary$")
    )
    app.add_handler(
        CallbackQueryHandler(stats.choose_chart_period, pattern=r"^stats:chart$")
    )
    app.add_handler(CallbackQueryHandler(stats.show_summary, pattern=r"^ssum:"))
    app.add_handler(CallbackQueryHandler(stats.show_chart, pattern=r"^schart:"))

    # --- Бюджеты (меню; set/del обрабатывает ConversationHandler выше) ---
    app.add_handler(CallbackQueryHandler(budget.open_menu, pattern=r"^budget:menu$"))

    # --- Глобальная отмена вне диалога ---
    app.add_handler(CommandHandler("cancel", menu.cmd_menu))

    app.add_error_handler(_on_error)
    return app


def main() -> None:
    app = build_application()
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
