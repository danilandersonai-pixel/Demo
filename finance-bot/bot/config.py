"""Конфигурация бота из переменных окружения (.env)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()


def _parse_ids(raw: str) -> tuple[int, ...]:
    ids = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            raise ValueError(f"ALLOWED_USER_IDS содержит не-число: {part!r}")
    return tuple(ids)


@dataclass(frozen=True)
class Config:
    token: str
    allowed_user_ids: tuple[int, ...]
    db_path: Path
    receipts_dir: Path
    currency: str
    timezone: ZoneInfo
    ocr_lang: str
    openrouter_api_key: str
    openrouter_model: str
    openrouter_vision_model: str
    extra: dict = field(default_factory=dict)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.openrouter_api_key)

    @classmethod
    def from_env(cls) -> "Config":
        token = os.getenv("BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "Не задан BOT_TOKEN. Скопируйте .env.example в .env и заполните."
            )

        allowed = _parse_ids(os.getenv("ALLOWED_USER_IDS", ""))
        if not allowed:
            raise RuntimeError(
                "Не задан ALLOWED_USER_IDS — бот не пустит никого. "
                "Укажите Telegram ID (через запятую)."
            )

        tz_name = os.getenv("TZ", "Europe/Moscow").strip() or "Europe/Moscow"
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("UTC")

        db_path = Path(os.getenv("DB_PATH", "data/finance.db")).expanduser()
        receipts_dir = Path(os.getenv("RECEIPTS_DIR", "data/receipts")).expanduser()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        receipts_dir.mkdir(parents=True, exist_ok=True)

        or_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        or_model = (
            os.getenv("OPENROUTER_MODEL", "").strip()
            or "google/gemini-2.0-flash-001"
        )
        or_vision = os.getenv("OPENROUTER_VISION_MODEL", "").strip() or or_model

        return cls(
            token=token,
            allowed_user_ids=allowed,
            db_path=db_path,
            receipts_dir=receipts_dir,
            currency=os.getenv("CURRENCY", "₽").strip() or "₽",
            timezone=tz,
            ocr_lang=os.getenv("OCR_LANG", "rus+eng").strip() or "rus+eng",
            openrouter_api_key=or_key,
            openrouter_model=or_model,
            openrouter_vision_model=or_vision,
        )
