"""后台调度器：站点健康监控 + 自动禁用/恢复 + 数据刮削。"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import select

from app.db import async_session_factory
from app.models import Site
from app.services.crawler import Crawler
from app.services.event_bus import Event, publish
from app.services.health import probe

logger = logging.getLogger(__name__)
PROBE_INTERVAL = 600  # 每 10 分钟探测一次
FAIL_THRESHOLD = 3  # 连续失败 3 次自动禁用
RECOVER_THRESHOLD = 2  # 连续成功 2 次自动恢复

# --- 自适应检测间隔配置 ---
CHECK_BASE_INTERVAL = 300  # 基础检测间隔 5 分钟
CHECK_MAX_INTERVAL = 3600  # 最大检测间隔 60 分钟
CHECK_MISS_BACKOFF = 2  # 未命中时间隔乘数
CHECK_LOOP_TICK = 60  # 主循环 tick 60 秒

# 内存中的失败计数：site_id -> int
_failure_counts: dict[int, int] = {}
_recovery_counts: dict[int, int] = {}

# 站点检测状态：site_id -> {next_check_at, interval, miss_count}
_check_state: dict[int, dict] = {}

# 刮削队列：检测到更新后推入，由独立 worker 消费
_crawl_queue: asyncio.Queue[int] = asyncio.Queue()

# 全局 crawler 实例（供外部查询状态）
crawler: Crawler | None = None


async def init_scheduler() -> asyncio.Task:
    """启动调度器任务，返回 task 以便 lifespan 取消。"""
    logger.info("调度器已启动")
    return asyncio.create_task(_master_loop())


async def _master_loop() -> None:
    """主调度循环：探测 + 刮削检测 + 刮削 worker 长期运行；首次刮削在后台独立执行。"""
    global crawler

    crawler = Crawler(async_session_factory)

    # 首次刮削在后台独立运行，不阻塞主循环
    asyncio.create_task(crawler.start())

    # 主循环管理探测、检测调度、刮削 worker
    probe_task = asyncio.create_task(_probe_loop())
    check_task = asyncio.create_task(_check_update_loop())
    worker_task = asyncio.create_task(_crawl_worker_loop())

    try:
        await asyncio.gather(probe_task, check_task, worker_task)
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
            publish(
                Event(
                    "site_health",
                    {"site_id": site_id, "site_name": site_name, "enabled": True},
                )
            )
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
                publish(
                    Event(
                        "site_health",
                        {
                            "site_id": site_id,
                            "site_name": site_name,
                            "enabled": False,
                            "error": error,
                        },
                    )
                )
                logger.info("站点自动禁用 site=%s", site_name)


# ------------------------------------------------------------------
# 自适应检测调度（方案1+方案2）
# ------------------------------------------------------------------

async def _check_update_loop() -> None:
    """每 60 秒 tick 一次，各站点按自己的 next_check_at 独立检测。

    自适应逻辑：
    - 命中更新 → 间隔重置为 5 分钟，推入刮削队列
    - 未命中 → 间隔 ×2（最长 60 分钟）
    """
    await asyncio.sleep(30)  # 首次启动等待 30 秒

    while True:
        try:
            await _tick_check_updates()
        except Exception:
            logger.exception("刮削检测循环异常")
        await asyncio.sleep(CHECK_LOOP_TICK)


async def _tick_check_updates() -> None:
    """单次 tick：遍历所有启用的站点，检查是否到了各自的检测时间。"""
    if not crawler:
        return

    async with async_session_factory() as db:
        result = await db.execute(
            select(Site).where(Site.enabled.is_(True)).order_by(Site.sort)
        )
        sites = list(result.scalars().all())

    now = time.time()
    scheduled = 0
    queued = 0

    for site in sites:
        state = _check_state.get(site.id, {})
        next_check = state.get("next_check_at", 0)

        if now < next_check:
            continue  # 还没到检测时间

        scheduled += 1
        has_update = await crawler.check_one_site(site)

        if has_update:
            # 命中更新：重置间隔，推入队列
            _check_state[site.id] = {
                "next_check_at": now + CHECK_BASE_INTERVAL,
                "interval": CHECK_BASE_INTERVAL,
                "miss_count": 0,
            }
            await _crawl_queue.put(site.id)
            queued += 1
            logger.info(
                "站点 %s 检测到有更新，已加入刮削队列 (队列长度=%d)",
                site.name,
                _crawl_queue.qsize(),
            )
        else:
            # 未命中：拉长间隔
            miss_count = state.get("miss_count", 0) + 1
            new_interval = min(
                CHECK_BASE_INTERVAL * (CHECK_MISS_BACKOFF**miss_count),
                CHECK_MAX_INTERVAL,
            )
            _check_state[site.id] = {
                "next_check_at": now + new_interval,
                "interval": new_interval,
                "miss_count": miss_count,
            }
            logger.debug(
                "站点 %s 无更新，下次检测 %d 秒后 (间隔=%ds, 未命中=%d)",
                site.name,
                int(new_interval),
                int(new_interval),
                miss_count,
            )

    if scheduled > 0:
        logger.info(
            "检测 tick 完成：本次检测 %d 个站，%d 个入队",
            scheduled,
            queued,
        )


async def _crawl_worker_loop() -> None:
    """刮削 worker：从队列消费 site_id，执行增量刮削。

    单 worker 串行处理，避免并发刮削风暴。
    如需提速可改为 Semaphore 控制并发数。
    """
    while True:
        site_id = await _crawl_queue.get()
        try:
            if crawler:
                logger.info(
                    "刮削 worker 开始处理站点 %s (队列剩余=%d)",
                    site_id,
                    _crawl_queue.qsize(),
                )
                await crawler.run_incremental(site_id)
        except Exception:
            logger.exception("刮削 worker 处理站点 %s 异常", site_id)
        finally:
            _crawl_queue.task_done()
