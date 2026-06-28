"""Слой доступа к данным (SQLite через aiosqlite).

Все суммы хранятся как REAL в основной валюте. Время — локальная строка
ISO `YYYY-MM-DD HH:MM:SS` (по часовому поясу из конфигурации), что позволяет
сравнивать периоды обычными строковыми/лексикографическими операциями.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    name       TEXT,
    joined_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    amount       REAL NOT NULL CHECK (amount > 0),
    category     TEXT NOT NULL,
    note         TEXT,
    receipt_path TEXT,
    created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_tx_kind    ON transactions (kind);
CREATE INDEX IF NOT EXISTS idx_tx_cat     ON transactions (category);

CREATE TABLE IF NOT EXISTS budgets (
    category      TEXT PRIMARY KEY,
    monthly_limit REAL NOT NULL CHECK (monthly_limit > 0)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS recurring (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    amount       REAL NOT NULL CHECK (amount > 0),
    category     TEXT NOT NULL,
    note         TEXT,
    day          INTEGER NOT NULL,
    last_applied TEXT,
    user_id      INTEGER,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    target     REAL NOT NULL CHECK (target > 0),
    saved      REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
"""


@dataclass
class Transaction:
    id: int
    user_id: int
    kind: str
    amount: float
    category: str
    note: Optional[str]
    receipt_path: Optional[str]
    created_at: str


class Database:
    def __init__(self, path: Path):
        self._path = str(path)

    async def init(self) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.executescript(SCHEMA)
            await db.commit()

    # ---- пользователи ----

    async def upsert_user(self, user_id: int, name: str, now: str) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                """
                INSERT INTO users (id, name, joined_at) VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name
                """,
                (user_id, name, now),
            )
            await db.commit()

    async def user_name(self, user_id: int) -> Optional[str]:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                "SELECT name FROM users WHERE id = ?", (user_id,)
            ) as cur:
                row = await cur.fetchone()
                return row[0] if row else None

    # ---- транзакции ----

    async def add_transaction(
        self,
        *,
        user_id: int,
        kind: str,
        amount: float,
        category: str,
        note: Optional[str],
        receipt_path: Optional[str],
        created_at: str,
    ) -> int:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute(
                """
                INSERT INTO transactions
                    (user_id, kind, amount, category, note, receipt_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, kind, amount, category, note, receipt_path, created_at),
            )
            await db.commit()
            return cur.lastrowid

    async def delete_transaction(self, tx_id: int) -> Optional[Transaction]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM transactions WHERE id = ?", (tx_id,)
            ) as cur:
                row = await cur.fetchone()
            if row is None:
                return None
            await db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
            await db.commit()
            return _row_to_tx(row)

    async def recent(self, limit: int = 10) -> list[Transaction]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM transactions ORDER BY created_at DESC, id DESC LIMIT ?",
                (limit,),
            ) as cur:
                rows = await cur.fetchall()
        return [_row_to_tx(r) for r in rows]

    # ---- агрегаты ----

    async def totals(self, start: str, end: str) -> tuple[float, float]:
        """Возвращает (доход, расход) за период [start, end)."""
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                """
                SELECT kind, COALESCE(SUM(amount), 0)
                FROM transactions
                WHERE created_at >= ? AND created_at < ?
                GROUP BY kind
                """,
                (start, end),
            ) as cur:
                rows = await cur.fetchall()
        data = {kind: total for kind, total in rows}
        return float(data.get("income", 0.0)), float(data.get("expense", 0.0))

    async def by_category(
        self, kind: str, start: str, end: str
    ) -> list[tuple[str, float]]:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                """
                SELECT category, SUM(amount) AS total
                FROM transactions
                WHERE kind = ? AND created_at >= ? AND created_at < ?
                GROUP BY category
                ORDER BY total DESC
                """,
                (kind, start, end),
            ) as cur:
                rows = await cur.fetchall()
        return [(c, float(t)) for c, t in rows]

    async def category_spent_month(self, category: str, start: str, end: str) -> float:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                """
                SELECT COALESCE(SUM(amount), 0)
                FROM transactions
                WHERE kind = 'expense' AND category = ?
                  AND created_at >= ? AND created_at < ?
                """,
                (category, start, end),
            ) as cur:
                row = await cur.fetchone()
        return float(row[0]) if row else 0.0

    async def count_by_category(
        self, kind: str, start: str, end: str
    ) -> list[tuple[str, int, float]]:
        """Список (категория, количество операций, сумма) за период."""
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                """
                SELECT category, COUNT(*) AS cnt, SUM(amount) AS total
                FROM transactions
                WHERE kind = ? AND created_at >= ? AND created_at < ?
                GROUP BY category
                ORDER BY total DESC
                """,
                (kind, start, end),
            ) as cur:
                rows = await cur.fetchall()
        return [(c, int(n), float(t)) for c, n, t in rows]

    # ---- бюджеты ----

    async def set_budget(self, category: str, limit: float) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                """
                INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)
                ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit
                """,
                (category, limit),
            )
            await db.commit()

    async def delete_budget(self, category: str) -> bool:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute(
                "DELETE FROM budgets WHERE category = ?", (category,)
            )
            await db.commit()
            return cur.rowcount > 0

    async def budgets(self) -> list[tuple[str, float]]:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                "SELECT category, monthly_limit FROM budgets ORDER BY category"
            ) as cur:
                rows = await cur.fetchall()
        return [(c, float(l)) for c, l in rows]

    async def budget_for(self, category: str) -> Optional[float]:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                "SELECT monthly_limit FROM budgets WHERE category = ?", (category,)
            ) as cur:
                row = await cur.fetchone()
        return float(row[0]) if row else None

    # ---- разбивка по людям ----

    async def totals_by_user(self, start: str, end: str) -> list[tuple[int, float, float]]:
        """(user_id, доход, расход) за период по каждому пользователю."""
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                """
                SELECT user_id, kind, COALESCE(SUM(amount), 0)
                FROM transactions
                WHERE created_at >= ? AND created_at < ?
                GROUP BY user_id, kind
                """,
                (start, end),
            ) as cur:
                rows = await cur.fetchall()
        agg: dict[int, list[float]] = {}
        for uid, kind, total in rows:
            agg.setdefault(uid, [0.0, 0.0])
            agg[uid][0 if kind == "income" else 1] = float(total)
        return [(uid, v[0], v[1]) for uid, v in agg.items()]

    async def all_user_names(self) -> dict[int, str]:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute("SELECT id, name FROM users") as cur:
                rows = await cur.fetchall()
        return {int(i): (n or str(i)) for i, n in rows}

    # ---- настройки ----

    async def get_setting(self, key: str, default: str = "") -> str:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ) as cur:
                row = await cur.fetchone()
        return row[0] if row else default

    async def set_setting(self, key: str, value: str) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                """
                INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )
            await db.commit()

    # ---- регулярные операции ----

    async def add_recurring(
        self, *, kind: str, amount: float, category: str, note: Optional[str],
        day: int, user_id: int, created_at: str,
    ) -> int:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute(
                """
                INSERT INTO recurring
                    (kind, amount, category, note, day, last_applied, user_id, created_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (kind, amount, category, note, day, user_id, created_at),
            )
            await db.commit()
            return cur.lastrowid

    async def list_recurring(self) -> list[dict]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM recurring ORDER BY day"
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def delete_recurring(self, rec_id: int) -> bool:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute("DELETE FROM recurring WHERE id = ?", (rec_id,))
            await db.commit()
            return cur.rowcount > 0

    async def due_recurring(self, day: int, ym: str) -> list[dict]:
        """Регулярные операции, которые пора применить: их day <= текущего дня
        и ещё не применялись в этом месяце (last_applied != YYYY-MM)."""
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """
                SELECT * FROM recurring
                WHERE day <= ? AND (last_applied IS NULL OR last_applied != ?)
                """,
                (day, ym),
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def mark_recurring_applied(self, rec_id: int, ym: str) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                "UPDATE recurring SET last_applied = ? WHERE id = ?", (ym, rec_id)
            )
            await db.commit()

    # ---- цели накопления ----

    async def add_goal(self, name: str, target: float, created_at: str) -> int:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute(
                "INSERT INTO goals (name, target, saved, created_at) VALUES (?, ?, 0, ?)",
                (name, target, created_at),
            )
            await db.commit()
            return cur.lastrowid

    async def contribute_goal(self, goal_id: int, amount: float) -> Optional[dict]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                "UPDATE goals SET saved = saved + ? WHERE id = ?", (amount, goal_id)
            )
            await db.commit()
            async with db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)) as cur:
                row = await cur.fetchone()
        return dict(row) if row else None

    async def list_goals(self) -> list[dict]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM goals ORDER BY id") as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def delete_goal(self, goal_id: int) -> bool:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
            await db.commit()
            return cur.rowcount > 0

    # ---- экспорт ----

    async def all_transactions(self, start: str, end: str) -> list[Transaction]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """
                SELECT * FROM transactions
                WHERE created_at >= ? AND created_at < ?
                ORDER BY created_at
                """,
                (start, end),
            ) as cur:
                rows = await cur.fetchall()
        return [_row_to_tx(r) for r in rows]


def _row_to_tx(row: aiosqlite.Row) -> Transaction:
    return Transaction(
        id=row["id"],
        user_id=row["user_id"],
        kind=row["kind"],
        amount=float(row["amount"]),
        category=row["category"],
        note=row["note"],
        receipt_path=row["receipt_path"],
        created_at=row["created_at"],
    )
