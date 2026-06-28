"""Инлайн-клавиатуры бота."""

from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from .categories import categories_for
from .utils import PERIOD_LABELS


def main_menu() -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton("➕ Доход", callback_data="add:income"),
            InlineKeyboardButton("➖ Расход", callback_data="add:expense"),
        ],
        [
            InlineKeyboardButton("📊 Статистика", callback_data="stats:menu"),
            InlineKeyboardButton("🧾 Последние", callback_data="recent:show"),
        ],
        [
            InlineKeyboardButton("🐷 Цели", callback_data="goals:show"),
            InlineKeyboardButton("🔁 Регулярные", callback_data="recurring:show"),
        ],
        [InlineKeyboardButton("👥 Кто кому должен", callback_data="people:show")],
        [
            InlineKeyboardButton("🎯 Бюджеты", callback_data="budget:menu"),
            InlineKeyboardButton("💡 Советы", callback_data="advice:show"),
        ],
    ]
    return InlineKeyboardMarkup(rows)


def categories_keyboard(kind: str, prefix: str) -> InlineKeyboardMarkup:
    """Клавиатура категорий. callback_data: `{prefix}:{index}`."""
    cats = categories_for(kind)
    rows = []
    row: list[InlineKeyboardButton] = []
    for idx, cat in enumerate(cats):
        row.append(InlineKeyboardButton(cat, callback_data=f"{prefix}:{idx}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton("✖️ Отмена", callback_data="cancel")])
    return InlineKeyboardMarkup(rows)


def period_keyboard(prefix: str) -> InlineKeyboardMarkup:
    rows, row = [], []
    for key, label in PERIOD_LABELS.items():
        row.append(InlineKeyboardButton(label, callback_data=f"{prefix}:{key}"))
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton("« Меню", callback_data="menu:home")])
    return InlineKeyboardMarkup(rows)


def stats_menu() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton("📈 Сводка за период", callback_data="stats:summary")],
        [InlineKeyboardButton("🥧 График по категориям", callback_data="stats:chart")],
        [InlineKeyboardButton("« Меню", callback_data="menu:home")],
    ]
    return InlineKeyboardMarkup(rows)


def skip_note_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("⏭ Без комментария", callback_data="note:skip")],
            [InlineKeyboardButton("✖️ Отмена", callback_data="cancel")],
        ]
    )


def receipt_keyboard(kind: str) -> InlineKeyboardMarkup:
    """Категории для чека + кнопка ручного ввода суммы."""
    kb = categories_keyboard(kind, prefix="rcat")
    extra = [InlineKeyboardButton("✏️ Исправить сумму", callback_data="rcorrect")]
    return InlineKeyboardMarkup(list(kb.inline_keyboard[:-1]) + [extra] + [kb.inline_keyboard[-1]])


def budget_menu(has_budgets: bool) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton("➕ Установить лимит", callback_data="budget:set")]]
    if has_budgets:
        rows.append(
            [InlineKeyboardButton("🗑 Удалить лимит", callback_data="budget:del")]
        )
    rows.append([InlineKeyboardButton("« Меню", callback_data="menu:home")])
    return InlineKeyboardMarkup(rows)


def back_to_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("« Меню", callback_data="menu:home")]]
    )
