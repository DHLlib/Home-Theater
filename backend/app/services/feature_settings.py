"""个人部署的播放功能开关，持久化到 AppConfig 并供各页面共享。"""
from __future__ import annotations

import asyncio
import time

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import FEATURE_SETTINGS_CACHE_TTL_SECONDS
from app.db import async_session_factory
from app.models import AppConfig
from app.services import playback_guard
from app.services.playback_enhancement import enhancement_available

DEFAULTS = {
    "media_analysis": True,
    "playback_guard": True,
    "enhancement": False,
}
_CACHE_SECONDS = FEATURE_SETTINGS_CACHE_TTL_SECONDS
_cache: dict[str, bool] = dict(DEFAULTS)
_cache_expires_at = 0.0
_lock = asyncio.Lock()


async def get_playback_features() -> dict[str, bool]:
    global _cache, _cache_expires_at
    now = time.monotonic()
    if now < _cache_expires_at:
        return dict(_cache)
    async with _lock:
        now = time.monotonic()
        if now < _cache_expires_at:
            return dict(_cache)
        async with async_session_factory() as session:
            rows = (
                await session.execute(
                    select(AppConfig).where(AppConfig.key.in_(list(DEFAULTS)))
                )
            ).scalars().all()
        values = dict(DEFAULTS)
        for row in rows:
            values[row.key] = row.value.strip().lower() in {"true", "1", "yes", "on"}
        _cache = values
        _cache_expires_at = time.monotonic() + _CACHE_SECONDS
        return dict(values)


async def is_feature_enabled(name: str) -> bool:
    if name not in DEFAULTS:
        raise ValueError(f"unknown playback feature: {name}")
    return (await get_playback_features())[name]


async def set_playback_features(
    changes: dict[str, bool], db: AsyncSession | None = None
) -> dict[str, bool]:
    global _cache, _cache_expires_at
    unknown = set(changes) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"unknown playback features: {sorted(unknown)}")
    if not changes:
        return await get_playback_features()
    if changes.get("enhancement") is True and not enhancement_available():
        raise ValueError("未安装 ffmpeg，无法启用轻量画质增强")

    values = [{"key": key, "value": "true" if value else "false"} for key, value in changes.items()]
    stmt = pg_insert(AppConfig).values(values)
    upsert = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": stmt.excluded.value}
    )
    if db is not None:
        await db.execute(upsert)
        await db.commit()
    else:
        async with async_session_factory() as session:
            await session.execute(upsert)
            await session.commit()

    if changes.get("playback_guard") is False:
        playback_guard.clear()

    current = await get_playback_features()
    async with _lock:
        current.update(changes)
        _cache = current
        _cache_expires_at = time.monotonic() + _CACHE_SECONDS
    return dict(_cache)
