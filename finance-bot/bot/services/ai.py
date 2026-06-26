"""Интеграция с OpenRouter (OpenAI-совместимый API).

Три задачи:
- parse_transaction — разбор операции из произвольного текста («кофе 250»);
- read_receipt — распознавание чека по фото (vision-модель);
- advice — человеческие советы по экономии на основе сводки трат.

Клиент «мягкий»: при любой ошибке возвращает None/пустую строку, чтобы бот
откатился на оффлайн-логику (Tesseract, ручной ввод, правила).
"""

from __future__ import annotations

import base64
import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger("finance-bot")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_JSON_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


@dataclass
class ParsedTx:
    kind: str  # income | expense
    amount: float
    category: str
    note: Optional[str]
    confidence: float


@dataclass
class ReceiptData:
    amount: Optional[float]
    category: Optional[str]
    merchant: Optional[str]
    note: Optional[str]


class AIClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        vision_model: str,
        timeout: float = 45.0,
    ):
        self.api_key = api_key
        self.model = model
        self.vision_model = vision_model
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def _chat(
        self,
        messages: list,
        *,
        model: Optional[str] = None,
        json_mode: bool = True,
        max_tokens: int = 700,
    ) -> Optional[str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-Title": "Finance Bot",
            "HTTP-Referer": "https://t.me/",
        }
        payload = {
            "model": model or self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
            if resp.status_code != 200:
                logger.warning("OpenRouter %s: %s", resp.status_code, resp.text[:300])
                return None
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as exc:  # pragma: no cover
            logger.warning("OpenRouter запрос не удался: %s", exc)
            return None

    @staticmethod
    def _load_json(raw: str) -> Optional[dict]:
        if not raw:
            return None
        cleaned = _JSON_FENCE.sub("", raw).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Иногда модель добавляет текст вокруг — вытащим первый {...}.
            start, end = cleaned.find("{"), cleaned.rfind("}")
            if 0 <= start < end:
                try:
                    return json.loads(cleaned[start : end + 1])
                except json.JSONDecodeError:
                    return None
            return None

    @staticmethod
    def _match_category(value: Optional[str], options: list[str]) -> Optional[str]:
        """Сопоставляет ответ модели с одной из наших категорий."""
        if not value:
            return None
        if value in options:
            return value
        # Сравнение по тексту без эмодзи/регистра.
        def norm(s: str) -> str:
            return re.sub(r"[^\w]", "", s, flags=re.UNICODE).lower()

        nv = norm(value)
        for opt in options:
            if norm(opt) == nv or nv and nv in norm(opt):
                return opt
        return None

    async def parse_transaction(
        self, text: str, expense_cats: list[str], income_cats: list[str]
    ) -> Optional[ParsedTx]:
        system = (
            "Ты — парсер личных финансов. По сообщению пользователя определи "
            "одну операцию и верни строго JSON со схемой: "
            '{"kind":"income|expense","amount":number,'
            '"category":"<точная строка из списка>","note":string|null,'
            '"confidence":number(0..1)}. '
            "Если это доход — выбери категорию из INCOME, иначе из EXPENSE. "
            "amount — положительное число в рублях. "
            "Если в тексте нет суммы или это не операция — verni confidence<=0.3. "
            "category должна ТОЧНО совпадать с одной из строк (вместе с эмодзи)."
        )
        user = (
            f"EXPENSE: {expense_cats}\n"
            f"INCOME: {income_cats}\n\n"
            f"Сообщение: {text!r}"
        )
        raw = await self._chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            json_mode=True,
            max_tokens=300,
        )
        data = self._load_json(raw)
        if not data:
            return None
        try:
            amount = float(data.get("amount") or 0)
        except (TypeError, ValueError):
            return None
        if amount <= 0:
            return None
        kind = "income" if str(data.get("kind")) == "income" else "expense"
        options = income_cats if kind == "income" else expense_cats
        category = self._match_category(data.get("category"), options) or options[-1]
        note = data.get("note")
        if note is not None:
            note = str(note).strip() or None
        try:
            conf = float(data.get("confidence", 0.5))
        except (TypeError, ValueError):
            conf = 0.5
        return ParsedTx(kind, round(amount, 2), category, note, conf)

    async def read_receipt(
        self, image_bytes: bytes, expense_cats: list[str]
    ) -> Optional[ReceiptData]:
        b64 = base64.b64encode(image_bytes).decode()
        data_url = f"data:image/jpeg;base64,{b64}"
        system = (
            "Ты распознаёшь кассовые чеки. Верни строго JSON: "
            '{"amount":number|null,"merchant":string|null,'
            '"category":"<точная строка из списка EXPENSE>","note":string|null}. '
            "amount — итоговая сумма к оплате (число в рублях). "
            "category выбери наиболее подходящую из списка (точно как в списке). "
            "note — краткое описание (1-3 ключевых товара или назначение)."
        )
        user_content = [
            {
                "type": "text",
                "text": f"EXPENSE: {expense_cats}\nРаспознай этот чек.",
            },
            {"type": "image_url", "image_url": {"url": data_url}},
        ]
        raw = await self._chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            model=self.vision_model,
            json_mode=True,
            max_tokens=400,
        )
        data = self._load_json(raw)
        if not data:
            return None
        amount = data.get("amount")
        try:
            amount = float(amount) if amount is not None else None
            if amount is not None and amount <= 0:
                amount = None
        except (TypeError, ValueError):
            amount = None
        category = self._match_category(data.get("category"), expense_cats)
        merchant = (data.get("merchant") or None)
        note = data.get("note") or None
        if merchant:
            merchant = str(merchant).strip() or None
        if note:
            note = str(note).strip() or None
        return ReceiptData(amount=amount, category=category, merchant=merchant, note=note)

    async def advice(self, stats_summary: str) -> str:
        system = (
            "Ты — дружелюбный финансовый помощник для семейного бюджета на двоих. "
            "На основе сводки трат дай 3-5 конкретных, тёплых и практичных советов "
            "по экономии на русском. Короткие пункты с эмодзи. Без воды и морали. "
            "Если данных мало — честно скажи и предложи, что начать отслеживать."
        )
        raw = await self._chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": stats_summary},
            ],
            json_mode=False,
            max_tokens=600,
        )
        return (raw or "").strip()
