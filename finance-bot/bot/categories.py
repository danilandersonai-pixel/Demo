"""Предопределённые категории доходов и расходов (с эмодзи)."""

from __future__ import annotations

EXPENSE_CATEGORIES: list[str] = [
    "🛒 Продукты",
    "🍽 Кафе и рестораны",
    "🚌 Транспорт",
    "🏠 Жильё и ЖКХ",
    "💊 Здоровье",
    "👕 Одежда",
    "🎁 Подарки",
    "🎬 Развлечения",
    "📱 Связь и интернет",
    "✈️ Путешествия",
    "🐾 Питомцы",
    "📚 Образование",
    "🔧 Прочее",
]

INCOME_CATEGORIES: list[str] = [
    "💼 Зарплата",
    "💰 Премия",
    "🎁 Подарок",
    "📈 Инвестиции",
    "🔁 Возврат",
    "🧾 Прочее",
]


def categories_for(kind: str) -> list[str]:
    return INCOME_CATEGORIES if kind == "income" else EXPENSE_CATEGORIES


def is_valid_category(kind: str, category: str) -> bool:
    return category in categories_for(kind)
