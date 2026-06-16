"""m3u8 去广告全局开关。"""
from __future__ import annotations

import asyncio
import time

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.db import async_session_factory
from app.models import AppConfig

_AD_FILTER_CACHE_TTL_SECONDS = 10.0
_ad_filter_cache: dict[str, object] = {"value": False, "expires_at": 0.0}
_ad_filter_cache_lock = asyncio.Lock()


async def is_ad_filter_enabled() -> bool:
    """从 AppConfig 读取全局去广告开关，默认关闭。

    带 10 秒内存缓存，避免每次播放/下载都查数据库。
    """
    global _ad_filter_cache

    now = time.monotonic()
    cached = _ad_filter_cache
    if now < cached["expires_at"]:
        return bool(cached["value"])

    async with _ad_filter_cache_lock:
        # 拿到锁后再检查一次，避免并发都去打数据库
        now = time.monotonic()
        if now < _ad_filter_cache["expires_at"]:
            return bool(_ad_filter_cache["value"])

        enabled = False
        async with async_session_factory() as session:
            row = await session.get(AppConfig, "ad_filter_enabled")
            if row is not None and row.value:
                enabled = row.value.strip().lower() in ("true", "1", "yes", "on")

        _ad_filter_cache = {
            "value": enabled,
            "expires_at": time.monotonic() + _AD_FILTER_CACHE_TTL_SECONDS,
        }
        return enabled


async def set_ad_filter_enabled(value: bool) -> bool:
    """持久化全局去广告开关。

    使用 UPDATE 直接写入，消除 read-modify-write 竞态；若记录不存在则插入。
    """
    global _ad_filter_cache

    text = "true" if value else "false"
    async with async_session_factory() as session:
        # 先尝试 UPDATE，避免读取再写回
        result = await session.execute(
            update(AppConfig)
            .where(AppConfig.key == "ad_filter_enabled")
            .values(value=text)
        )

        # 没有更新到记录，说明 key 不存在，插入
        if result.rowcount == 0:
            session.add(AppConfig(key="ad_filter_enabled", value=text))
            try:
                await session.commit()
            except IntegrityError:
                # 并发插入冲突：回滚后用 UPDATE 兜底
                await session.rollback()
                await session.execute(
                    update(AppConfig)
                    .where(AppConfig.key == "ad_filter_enabled")
                    .values(value=text)
                )
                await session.commit()
        else:
            await session.commit()

    # 立即刷新缓存，让后续请求立刻感知新状态
    async with _ad_filter_cache_lock:
        _ad_filter_cache = {
            "value": value,
            "expires_at": time.monotonic() + _AD_FILTER_CACHE_TTL_SECONDS,
        }

    return value
