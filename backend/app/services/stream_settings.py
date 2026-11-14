"""播放加速开关与档位（全局设置，存 AppConfig）。"""
from __future__ import annotations

import asyncio
import time

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.db import async_session_factory
from app.models import AppConfig
from app.services.stream_accel import ACCEL_LEVELS, DEFAULT_LEVEL

_ENABLED_KEY = "stream_accel_enabled"
_LEVEL_KEY = "stream_accel_level"

_CACHE_TTL_SECONDS = 5.0
_cache: dict[str, object] = {"enabled": False, "level": DEFAULT_LEVEL, "expires_at": 0.0}
_lock = asyncio.Lock()


def _parse_bool(text: str | None) -> bool:
    return bool(text) and text.strip().lower() in ("true", "1", "yes", "on")


async def get_stream_accel() -> tuple[bool, str]:
    """返回 (是否开启, 档位)。默认关闭、二档。"""
    global _cache
    now = time.monotonic()
    if now < float(_cache["expires_at"]):
        return bool(_cache["enabled"]), str(_cache["level"])

    async with _lock:
        now = time.monotonic()
        if now < float(_cache["expires_at"]):
            return bool(_cache["enabled"]), str(_cache["level"])

        enabled = False
        level = DEFAULT_LEVEL
        async with async_session_factory() as session:
            enabled_row = await session.get(AppConfig, _ENABLED_KEY)
            level_row = await session.get(AppConfig, _LEVEL_KEY)
            enabled = _parse_bool(enabled_row.value if enabled_row else None)
            if level_row and level_row.value in ACCEL_LEVELS:
                level = level_row.value

        _cache = {
            "enabled": enabled,
            "level": level,
            "expires_at": time.monotonic() + _CACHE_TTL_SECONDS,
        }
        return enabled, level


async def _upsert(key: str, value: str) -> None:
    async with async_session_factory() as session:
        result = await session.execute(
            update(AppConfig).where(AppConfig.key == key).values(value=value)
        )
        if result.rowcount == 0:
            session.add(AppConfig(key=key, value=value))
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                await session.execute(
                    update(AppConfig).where(AppConfig.key == key).values(value=value)
                )
                await session.commit()
        else:
            await session.commit()


async def set_stream_accel(enabled: bool, level: str | None = None) -> tuple[bool, str]:
    global _cache
    if level is not None and level not in ACCEL_LEVELS:
        raise ValueError(f"invalid level: {level}")

    await _upsert(_ENABLED_KEY, "true" if enabled else "false")
    if level is not None:
        await _upsert(_LEVEL_KEY, level)

    async with _lock:
        current_level = level or str(_cache["level"])
        _cache = {
            "enabled": enabled,
            "level": current_level,
            "expires_at": time.monotonic() + _CACHE_TTL_SECONDS,
        }
    return enabled, str(_cache["level"])
