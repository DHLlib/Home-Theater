"""后台调度器：站点健康监控 + 自动禁用/恢复 + 数据刮削。"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.db import async_session_factory
from app.models import Site
from app.services.crawler import Crawler
from app.services.event_bus import Event, publish
from app.services.health import probe

logger = logging.getLogger(__name__)
PROBE_INTERVAL = 600       # 每 10 分钟探测一次
FAIL_THRESHOLD = 3         # 连续失败 3 次自动禁用
RECOVER_THRESHOLD = 2      # 连续成功 2 次自动恢复
CHECK_UPDATE_INTERVAL = 300  # 每 5 分钟检测一次更新

# 内存中的失败计数：site_id -> int
_failure_counts: dict[int, int] = {}
_recovery_counts: dict[int, int] = {}

# 全局 crawler 实例（供外部查询状态）
crawler: Crawler | None = None


async def init_scheduler() -> asyncio.Task:
    """启动调度器任务，返回 task 以便 lifespan 取消。"""
    logger.info("调度器已启动")
    return asyncio.create_task(_master_loop())


async def _master_loop() -> None:
    """主调度循环：探测 + 刮削检测长期运行；首次刮削在后台独立执行。"""
    global crawler

    crawler = Crawler(async_session_factory)

    # 首次刮削在后台独立运行，不阻塞主循环
    asyncio.create_task(crawler.start())

    # 主循环只管理探测和检测（这两个是无限循环）
    probe_task = asyncio.create_task(_probe_loop())
    check_task = asyncio.create_task(_check_update_loop())

    try:
        await asyncio.gather(probe_task, check_task)
    finally:
        if crawler:
            await crawler.stop()


# ------------------------------------------------------------------
# 探测循环（原有逻辑）
# ------------------------------------------------------------------

async def _probe_loop() -> None:
    """后台循环：持续探测站点健康状态。"""
    while True:
        try:
            await _probe_all_sites()
        except Exception:
            logger.exception("站点探测循环异常")
        await asyncio.sleep(PROBE_INTERVAL)


async def _probe_all_sites() -> None:
    """遍历所有站点执行探测并处理自动禁用/恢复。"""
    async with async_session_factory() as session:
        result = await session.execute(select(Site).order_by(Site.sort))
        sites = result.scalars().all()

    async def _probe_one(site: Site):
        try:
            pr = await probe(site.id, site.base_url, site.name)
        except Exception as exc:
            logger.warning("探测异常 site=%s error=%s", site.name, exc)
            pr = None
        return site, pr

    results = await asyncio.gather(*[_probe_one(s) for s in sites])

    for site, pr in results:
        if pr and pr.ok:
            await _on_probe_success(site.id, site.name)
        else:
            error_msg = pr.error if pr else "探测异常"
            await _on_probe_failure(site.id, site.name, error_msg)


async def _on_probe_success(site_id: int, site_name: str) -> None:
    """探测成功：清理失败计数，检查是否可自动恢复。"""
    _failure_counts.pop(site_id, None)

    async with async_session_factory() as session:
        site = await session.get(Site, site_id)
        if not site:
            return

        # 只有被自动禁用的站点才参与恢复
        if site.enabled or site.auto_disabled_at is None:
            return

        _recovery_counts[site_id] = _recovery_counts.get(site_id, 0) + 1
        logger.info(
            "站点探测成功 site=%s recovery_count=%s/%s",
            site_name,
            _recovery_counts[site_id],
            RECOVER_THRESHOLD,
        )

        if _recovery_counts[site_id] >= RECOVER_THRESHOLD:
            site.enabled = True
            site.auto_disabled_at = None
            await session.commit()
            _recovery_counts.pop(site_id, None)
            publish(Event("site_health", {"site_id": site_id, "site_name": site_name, "enabled": True}))
            logger.info("站点自动恢复 site=%s", site_name)


async def _on_probe_failure(site_id: int, site_name: str, error: str) -> None:
    """探测失败：增加失败计数，检查是否需自动禁用。"""
    _recovery_counts.pop(site_id, None)
    _failure_counts[site_id] = _failure_counts.get(site_id, 0) + 1

    logger.warning(
        "站点探测失败 site=%s error=%s failure_count=%s/%s",
        site_name,
        error,
        _failure_counts[site_id],
        FAIL_THRESHOLD,
    )

    if _failure_counts[site_id] >= FAIL_THRESHOLD:
        async with async_session_factory() as session:
            site = await session.get(Site, site_id)
            if site and site.enabled:
                site.enabled = False
                site.auto_disabled_at = datetime.now(timezone.utc)
                await session.commit()
                publish(Event("site_health", {"site_id": site_id, "site_name": site_name, "enabled": False, "error": error}))
                logger.info("站点自动禁用 site=%s", site_name)


# ------------------------------------------------------------------
# 刮削检测循环
# ------------------------------------------------------------------

async def _check_update_loop() -> None:
    """后台循环：每 5 分钟检测各站是否有更新。"""
    # 首次启动等待 30 秒，让服务完全初始化
    await asyncio.sleep(30)

    while True:
        try:
            if crawler:
                await crawler.check_updates()
        except Exception:
            logger.exception("刮削检测循环异常")
        await asyncio.sleep(CHECK_UPDATE_INTERVAL)
