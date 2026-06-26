"""Разговорный финансовый агент: LLM с инструментами (function-calling).

Любое текстовое сообщение пользователя попадает сюда. Модель сама решает,
какой инструмент вызвать (добавить операцию, статистика, лимиты, удаление),
агент выполняет его в БД и возвращает результат модели, пока та не сформирует
финальный человеческий ответ.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from ..categories import EXPENSE_CATEGORIES, INCOME_CATEGORIES, categories_for
from ..database import Database
from ..utils import DT_FMT, fmt_money, month_bounds, now_local, period_bounds
from .ai import AIClient

logger = logging.getLogger("finance-bot")

MAX_TOOL_ITERATIONS = 6
# Храним полную ветку диалога (вкл. вызовы инструментов и их результаты),
# иначе модель «забывает», что записи делаются через tool-call, и начинает
# отвечать «Записал!» без реального вызова инструмента.
HISTORY_LIMIT = 30  # сообщений всех ролей (user/assistant/tool)

PERIOD_ENUM = ["today", "week", "month", "year", "all"]


def _tools_spec() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "add_transaction",
                "description": "Добавить операцию (доход или расход) в общий бюджет.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["income", "expense"],
                            "description": "income — доход, expense — расход",
                        },
                        "amount": {
                            "type": "number",
                            "description": "Сумма в рублях, положительное число",
                        },
                        "category": {
                            "type": "string",
                            "description": "Точная строка категории из переданного списка",
                        },
                        "note": {
                            "type": "string",
                            "description": "Краткий комментарий (магазин/назначение), необязательно",
                        },
                        "days_ago": {
                            "type": "integer",
                            "description": "Сколько дней назад была операция (0=сегодня, 1=вчера)",
                        },
                    },
                    "required": ["kind", "amount", "category"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_summary",
                "description": "Сводка доходов/расходов/баланса и топ категорий за период.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "period": {"type": "string", "enum": PERIOD_ENUM},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_category_spending",
                "description": "Сколько потрачено (или получено) по конкретной категории за период.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string"},
                        "period": {"type": "string", "enum": PERIOD_ENUM},
                        "kind": {"type": "string", "enum": ["income", "expense"]},
                    },
                    "required": ["category"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_recent",
                "description": "Список последних операций (для просмотра или чтобы узнать id для удаления).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "limit": {"type": "integer", "description": "Сколько операций, по умолчанию 10"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delete_transaction",
                "description": "Удалить операцию по её id.",
                "parameters": {
                    "type": "object",
                    "properties": {"id": {"type": "integer"}},
                    "required": ["id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "set_budget",
                "description": "Установить месячный лимит на категорию расходов.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string"},
                        "monthly_limit": {"type": "number"},
                    },
                    "required": ["category", "monthly_limit"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_budgets",
                "description": "Показать все лимиты и сколько по ним уже потрачено в этом месяце.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


@dataclass
class AgentResult:
    text: str
    history: list = field(default_factory=list)


class FinanceAgent:
    def __init__(self, ai: AIClient, db: Database, currency: str, tz: ZoneInfo):
        self.ai = ai
        self.db = db
        self.currency = currency
        self.tz = tz

    # ---------- системный промпт ----------

    def _system_prompt(self) -> str:
        today = now_local(self.tz).strftime("%Y-%m-%d (%A)")
        return (
            "Ты — дружелюбный финансовый помощник в Telegram для семьи из двух "
            "человек с общим бюджетом. Отвечай на русском, кратко и по делу, "
            f"суммы — в рублях ({self.currency}). Сегодня: {today}.\n\n"
            "Твоя задача — вести учёт через ИНСТРУМЕНТЫ. Никогда не выдумывай "
            "числа: чтобы ответить про траты/баланс — вызывай get_summary или "
            "get_category_spending. Чтобы записать операцию — add_transaction. "
            "Если в сообщении есть сумма и что куплено — САМ подбери подходящую "
            "категорию из списка и сразу вызови add_transaction. НИКОГДА не "
            "переспрашивай категорию (кофе→Кафе, метро→Транспорт и т.п.). "
            "Категорию выбирай ТОЧНО из списков ниже. Каждое сообщение разбирай "
            "самостоятельно: НЕ переноси предметы и комментарии из прошлых "
            "сообщений в новые операции.\n\n"
            f"Категории расходов: {EXPENSE_CATEGORIES}\n"
            f"Категории доходов: {INCOME_CATEGORIES}\n\n"
            "После выполнения действия коротко подтверди результат живым языком "
            "с эмодзи. Если просят совет по экономии — сначала возьми данные "
            "через get_summary, потом дай 2-4 конкретных совета.\n"
            "Когда пользователь просит удалить операцию, описывая её словами "
            "(например «удали кофе» или «убери последнюю трату»), НЕ переспрашивай "
            "и НЕ проси id — СНАЧАЛА вызови list_recent, сам найди подходящую "
            "операцию по сумме/категории/комментарию и вызови delete_transaction "
            "с её id. Уточняй только если подходящих операций несколько и выбор "
            "неоднозначен.\n\n"
            "ВАЖНО: не используй markdown-разметку (никаких **, ##, ```), пиши "
            "обычным текстом с эмодзи и переносами строк — Telegram markdown не "
            "показывает."
        )

    # ---------- выполнение инструментов ----------

    async def _exec(self, name: str, args: dict, *, user_id: int, user_name: str) -> dict:
        try:
            if name == "add_transaction":
                return await self._t_add(args, user_id, user_name)
            if name == "get_summary":
                return await self._t_summary(args)
            if name == "get_category_spending":
                return await self._t_cat_spending(args)
            if name == "list_recent":
                return await self._t_recent(args)
            if name == "delete_transaction":
                return await self._t_delete(args)
            if name == "set_budget":
                return await self._t_set_budget(args)
            if name == "list_budgets":
                return await self._t_list_budgets()
        except Exception as exc:  # pragma: no cover
            logger.warning("Ошибка инструмента %s: %s", name, exc)
            return {"error": f"Не удалось выполнить {name}: {exc}"}
        return {"error": f"Неизвестный инструмент: {name}"}

    def _match_category(self, kind: str, value: str) -> str:
        options = categories_for(kind)
        matched = AIClient._match_category(value, options)
        return matched or options[-1]  # «Прочее»

    async def _t_add(self, args: dict, user_id: int, user_name: str) -> dict:
        kind = "income" if args.get("kind") == "income" else "expense"
        try:
            amount = round(float(args.get("amount")), 2)
        except (TypeError, ValueError):
            return {"error": "Не указана корректная сумма"}
        if amount <= 0:
            return {"error": "Сумма должна быть положительной"}
        category = self._match_category(kind, str(args.get("category", "")))
        note = (args.get("note") or None)
        if note:
            note = str(note).strip() or None
        days_ago = int(args.get("days_ago") or 0)
        when = now_local(self.tz) - timedelta(days=max(0, days_ago))
        created_at = when.strftime(DT_FMT)

        await self.db.upsert_user(user_id, user_name, now_local(self.tz).strftime(DT_FMT))
        tx_id = await self.db.add_transaction(
            user_id=user_id, kind=kind, amount=amount, category=category,
            note=note, receipt_path=None, created_at=created_at,
        )
        result = {
            "ok": True, "id": tx_id, "kind": kind, "amount": amount,
            "category": category, "note": note,
        }
        # Контроль лимита.
        if kind == "expense":
            limit = await self.db.budget_for(category)
            if limit:
                m_start, m_end = month_bounds(self.tz, 0)
                spent = await self.db.category_spent_month(category, m_start, m_end)
                result["budget_limit"] = limit
                result["budget_spent"] = round(spent, 2)
                result["budget_exceeded"] = spent > limit
        return result

    async def _t_summary(self, args: dict) -> dict:
        period = args.get("period") if args.get("period") in PERIOD_ENUM else "month"
        start, end = period_bounds(period, self.tz)
        income, expense = await self.db.totals(start, end)
        cats = await self.db.by_category("expense", start, end)
        return {
            "period": period,
            "income": round(income, 2),
            "expense": round(expense, 2),
            "balance": round(income - expense, 2),
            "expense_by_category": [
                {"category": c, "amount": round(v, 2)} for c, v in cats[:12]
            ],
        }

    async def _t_cat_spending(self, args: dict) -> dict:
        kind = "income" if args.get("kind") == "income" else "expense"
        period = args.get("period") if args.get("period") in PERIOD_ENUM else "month"
        category = self._match_category(kind, str(args.get("category", "")))
        start, end = period_bounds(period, self.tz)
        rows = await self.db.by_category(kind, start, end)
        amount = next((v for c, v in rows if c == category), 0.0)
        return {
            "category": category, "kind": kind, "period": period,
            "amount": round(amount, 2),
        }

    async def _t_recent(self, args: dict) -> dict:
        limit = int(args.get("limit") or 10)
        limit = max(1, min(limit, 30))
        txs = await self.db.recent(limit)
        return {
            "transactions": [
                {
                    "id": t.id, "kind": t.kind, "amount": round(t.amount, 2),
                    "category": t.category, "note": t.note,
                    "date": t.created_at[:16],
                }
                for t in txs
            ]
        }

    async def _t_delete(self, args: dict) -> dict:
        try:
            tx_id = int(args.get("id"))
        except (TypeError, ValueError):
            return {"error": "Нужен числовой id операции"}
        removed = await self.db.delete_transaction(tx_id)
        if removed is None:
            return {"ok": False, "error": "Операция с таким id не найдена"}
        return {
            "ok": True, "deleted": {
                "id": removed.id, "kind": removed.kind,
                "amount": round(removed.amount, 2), "category": removed.category,
            },
        }

    async def _t_set_budget(self, args: dict) -> dict:
        category = self._match_category("expense", str(args.get("category", "")))
        try:
            limit = round(float(args.get("monthly_limit")), 2)
        except (TypeError, ValueError):
            return {"error": "Не указан корректный лимит"}
        if limit <= 0:
            return {"error": "Лимит должен быть положительным"}
        await self.db.set_budget(category, limit)
        return {"ok": True, "category": category, "monthly_limit": limit}

    async def _t_list_budgets(self) -> dict:
        budgets = await self.db.budgets()
        m_start, m_end = month_bounds(self.tz, 0)
        out = []
        for cat, limit in budgets:
            spent = await self.db.category_spent_month(cat, m_start, m_end)
            out.append({
                "category": cat, "monthly_limit": round(limit, 2),
                "spent": round(spent, 2),
            })
        return {"budgets": out}

    # ---------- основной цикл ----------

    async def run(
        self, user_text: str, history: list, *, user_id: int, user_name: str
    ) -> AgentResult:
        history = list(history or [])
        messages = [{"role": "system", "content": self._system_prompt()}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_text})

        tools = _tools_spec()
        final_text = None
        errored = False

        for _ in range(MAX_TOOL_ITERATIONS):
            msg = await self.ai.complete(
                messages, tools=tools, max_tokens=900, temperature=0.1
            )
            if msg is None:
                final_text = (
                    "⚠️ Не получилось связаться с моделью. Попробуйте ещё раз "
                    "или воспользуйтесь кнопками меню (/menu)."
                )
                errored = True
                break

            tool_calls = msg.get("tool_calls")
            # Сообщение ассистента кладём в контекст (нужно для tool-ответов).
            messages.append({
                "role": "assistant",
                "content": msg.get("content") or "",
                **({"tool_calls": tool_calls} if tool_calls else {}),
            })

            if not tool_calls:
                final_text = (msg.get("content") or "").strip()
                break

            for call in tool_calls:
                fn = call.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await self._exec(name, args, user_id=user_id, user_name=user_name)
                messages.append({
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": json.dumps(result, ensure_ascii=False),
                })
        else:
            final_text = (
                "Сделал несколько шагов, но не смог красиво завершить ответ. "
                "Уточните, пожалуйста, запрос."
            )

        if not final_text:
            final_text = "Готово."

        # При сетевой ошибке память не трогаем (ветка диалога неполная).
        if errored:
            return AgentResult(text=final_text, history=history)

        # Память = полная ветка диалога без system, обрезанная с начала так,
        # чтобы она всегда начиналась с сообщения пользователя (иначе API
        # отвергнет «сиротские» tool/assistant-with-tool_calls сообщения).
        new_history = messages[1:]
        if len(new_history) > HISTORY_LIMIT:
            new_history = new_history[-HISTORY_LIMIT:]
        while new_history and new_history[0].get("role") != "user":
            new_history.pop(0)

        return AgentResult(text=final_text, history=new_history)
