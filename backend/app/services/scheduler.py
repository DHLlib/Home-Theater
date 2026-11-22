"""后台调度器：站点维护（健康 + 更新检测共享一次探测）+ 自动刮削 + 每日补全。

统一的站点维护循环取代了早期独立的 _probe_loop 与 _check_update_loop：
- 健康检测默认每 10 分钟一次；内容更新检测首次约 30 秒、基础间隔 5 分钟，
  未命中指数退避到 60 分钟；播放保护期间退让。
- 同一站点同一轮中健康与更新检测共享一次 health.probe 的 items，
  不做第二次网络请求；健康写 SiteProbeLog + 自动禁用/恢复，
  更新检测结果交给 crawler.check_list_items，命中则入单 worker 刮削队列。
- 网络/解析失败记 last_check_status='error' 并按基础间隔重试，
  绝不按 unchanged 进入 miss 退避。
- next_health_at/next_check_at/last_check_status 持久化到
  AppConfig key='site_maintenance_schedule'（每 tick 一次批量写），重启后恢复。
- 增量刮削与每日补全都通过 maintenance 协调器提交（trigger=scheduled/startup），
  不再使用内存 fire-and-forget。
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.config import settings
from app.constants import (
    BATCH_PROBE_CONCURRENCY,
    BATCH_PROBE_TIMEOUT,
    CRAWLER_FILL_VIDEOLIST_HOUR,
    CRAWLER_FILL_VIDEOLIST_MINUTE,
)
from app.db import async_session_factory
from app.models import AppConfig, Site, SiteHealthCounter, SiteProbeLog, _utcnow
from app.services import playback_guard
from app.services.crawler import Crawler
from app.services.health import ProbeResult, probe
from app.services.maintenance import maintenance_coordinator
from app.services.notify_sender import Event, notify_sender

logger = logging.getLogger(__name__)
PROBE_INTERVAL = settings.probe_interval  # 站点健康检测间隔（秒）
PROBE_LOG_RETENTION_DAYS = 1  # 探测日志保留 1 天
FAIL_THRESHOLD = settings.fail_threshold  # 连续失败 N 次自动禁用
RECOVER_THRESHOLD = settings.recover_threshold  # 连续成功 N 次自动恢复

# --- 自适应更新检测配置 ---
CHECK_BASE_INTERVAL = settings.check_base_interval  # 基础检测间隔（秒）
CHECK_MAX_INTERVAL = settings.check_max_interval  # 最大检测间隔（秒）
CHECK_MISS_BACKOFF = 2  # 未命中时间隔乘数
CHECK_FIRST_DELAY = 30  # 启动后首次更新检测延迟（秒）
CHECK_LOOP_TICK = 60  # 维护循环 tick（秒）

FILL_STARTUP_DELAY = 60  # 启动后首次计算补全时间前的延迟（秒），避免启动风暴

# AppConfig 中持久化维护调度状态的 key
SCHEDULE_STATE_KEY = "site_maintenance_schedule"

# 站点维护状态：site_id -> {
#   next_health_at, next_check_at, interval, miss_count,
#   last_check_status(updated/unchanged/error), last_error,
# }
_maint_state: dict[int, dict] = {}
# 兼容旧名：历史上外部以 _check_state 引用更新检测状态
_check_state = _maint_state

# 刮削队列：检测到更新后推入，由独立 worker 消费
_crawl_queue: asyncio.Queue[int] = asyncio.Queue()
# 已入队的站点集合：排队期间同一站点不重复入队
_crawl_queued: set[int] = set()

# 全局 crawler 实例（供外部查询状态）
crawler: Crawler | None = None


async def _get_health_counter(db, site_id: int) -> SiteHealthCounter:
    """获取或创建站点健康计数器。"""
    counter = await db.get(SiteHealthCounter, site_id)
    if counter is None:
        counter = SiteHealthCounter(site_id=site_id)
        db.add(counter)
        await db.flush()
    return counter


async def _increment_failure_count(db, site_id: int) -> int:
    """增加失败计数，返回当前值。"""
    counter = await _get_health_counter(db, site_id)
    counter.failure_count += 1
    counter.recovery_count = 0  # 重置恢复计数
    await db.commit()
    return counter.failure_count


async def _increment_recovery_count(db, site_id: int) -> int:
    """增加恢复计数，返回当前值。"""
    counter = await _get_health_counter(db, site_id)
    counter.recovery_count += 1
    await db.commit()
    return counter.recovery_count


async def _reset_failure_count(db, site_id: int) -> None:
    """重置失败计数。"""
    counter = await db.get(SiteHealthCounter, site_id)
    if counter:
        counter.failure_count = 0
        await db.commit()


async def _reset_recovery_count(db, site_id: int) -> None:
    """重置恢复计数。"""
    counter = await db.get(SiteHealthCounter, site_id)
    if counter:
        counter.recovery_count = 0
        await db.commit()


async def init_scheduler() -> asyncio.Task:
    """启动调度器任务，返回 task 以便 lifespan 取消。"""
    logger.info("调度器已启动")
    return asyncio.create_task(_master_loop())


async def _master_loop() -> None:
    """主调度循环：站点维护 + 刮削 worker + 每日补全；启动全量经协调器提交。"""
    global crawler

    crawler = Crawler(async_session_factory)

    # 启动全量刮削走统一协调器（trigger=startup）：与手动全量共享去重键，
    # 重启中断也能被 recover_interrupted 正确标记
    async def _startup_full_crawl_handler(ctx) -> dict:
        if crawler is None:
            return {"state": "skipped", "error": "刮削器尚未启动"}
        return await crawler.start(
            stop_event=ctx.cancel_event, progress=ctx.progress
        )

    try:
        await maintenance_coordinator.submit(
            "crawl.full", _startup_full_crawl_handler, trigger="startup"
        )
    except Exception:
        logger.exception("启动全量刮削任务提交失败")

    maintenance_task = asyncio.create_task(_site_maintenance_loop())
    worker_task = asyncio.create_task(_crawl_worker_loop())
    fill_task = asyncio.create_task(_fill_videolist_loop())

    try:
        await asyncio.gather(maintenance_task, worker_task, fill_task)
    finally:
        if crawler:
            await crawler.stop()


# ------------------------------------------------------------------
# 统一站点维护循环（健康 + 更新检测共享一次探测）
# ------------------------------------------------------------------

async def _site_maintenance_loop() -> None:
    """站点维护循环：每 tick 检查各站点健康/更新是否到期并统一处理。"""
    await _load_maintenance_state()
    while True:
        try:
            await _tick_site_maintenance()
        except Exception:
            logger.exception("站点维护循环异常")
        await asyncio.sleep(CHECK_LOOP_TICK)


async def _tick_site_maintenance(force: bool = False) -> None:
    """单次 tick：对到期的站点执行一次共享探测，分流健康与更新处理。

    force=True 时无视到期时间，对所有站点执行健康检测（兼容旧 _probe_all_sites）。
    """
    async with async_session_factory() as session:
        result = await session.execute(select(Site).order_by(Site.sort))
        sites = list(result.scalars().all())
    if not sites:
        return

    now = time.time()
    due: list[tuple[Site, bool, bool]] = []
    for site in sites:
        st = _maint_state.get(site.id) or {}
        next_health = st.get("next_health_at")
        health_due = force or next_health is None or now >= next_health

        update_due = False
        # 禁用站只做健康恢复检测，不做内容更新检查；force 轮只做健康
        if site.enabled and crawler is not None and not force:
            next_check = st.get("next_check_at")
            if next_check is None:
                # 首次：约 30 秒后开始更新检测
                _maint_state.setdefault(site.id, {})["next_check_at"] = (
                    now + CHECK_FIRST_DELAY
                )
            else:
                update_due = now >= next_check

        if health_due or update_due:
            due.append((site, health_due, update_due))

    if not due:
        await _persist_maintenance_state()
        return

    semaphore = asyncio.Semaphore(BATCH_PROBE_CONCURRENCY)
    probe_logs: list[SiteProbeLog] = []

    async def _run(site: Site, health_due: bool, update_due: bool) -> None:
        async with semaphore:
            log_entry = await _maintain_one_site(site, health_due, update_due, now)
            if log_entry is not None:
                probe_logs.append(log_entry)

    # _maintain_one_site 内部已捕获异常，单站失败不影响其它站点
    await asyncio.gather(*[_run(s, h, u) for s, h, u in due])

    if probe_logs:
        async with async_session_factory() as session:
            session.add_all(probe_logs)
            # 顺带清理过期探测日志，避免无限增长
            cutoff = _utcnow() - timedelta(days=PROBE_LOG_RETENTION_DAYS)
            await session.execute(
                delete(SiteProbeLog).where(SiteProbeLog.created_at < cutoff)
            )
            await session.commit()

    await _persist_maintenance_state()


async def _maintain_one_site(
    site: Site, health_due: bool, update_due: bool, now: float
) -> SiteProbeLog | None:
    """单个站点的维护轮：一次探测，按到期情况分流健康与更新处理。"""
    try:
        await playback_guard.wait_until_idle()
        pr = await asyncio.wait_for(
            probe(site.id, site.base_url, site.name),
            timeout=BATCH_PROBE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        pr = ProbeResult(
            ok=False,
            latency_ms=None,
            error=f"检测超时（{BATCH_PROBE_TIMEOUT:.0f} 秒预算）",
        )
    except Exception as exc:
        logger.warning("站点维护探测异常 site=%s error=%s", site.name, exc)
        pr = ProbeResult(ok=False, latency_ms=None, error=f"探测异常：{exc!s}")

    log_entry = None
    if health_due:
        log_entry = SiteProbeLog(
            site_id=site.id,
            ok=pr.ok,
            error=pr.error,
            response_time_ms=pr.latency_ms,
        )
        if pr.ok:
            await _on_probe_success(site.id, site.name)
        else:
            await _on_probe_failure(site.id, site.name, pr.error or "探测失败")
        _maint_state.setdefault(site.id, {})["next_health_at"] = now + PROBE_INTERVAL

    if update_due:
        await _process_update_check(site, pr, now)

    return log_entry


async def _process_update_check(site: Site, pr: ProbeResult, now: float) -> None:
    """更新检测：复用探测拿到的第一页 items，不再发第二次请求。

    last_check_status 明确区分 updated/unchanged/error；
    网络失败按基础间隔重试，绝不进入 miss 退避。
    """
    st = _maint_state.setdefault(site.id, {})

    def _retry_later(error: str) -> None:
        st["next_check_at"] = now + CHECK_BASE_INTERVAL
        st["interval"] = CHECK_BASE_INTERVAL
        st["miss_count"] = 0
        st["last_check_status"] = "error"
        st["last_error"] = error

    if not pr.ok:
        _retry_later(pr.error or "探测失败")
        return

    try:
        result = await crawler.check_list_items(site, pr.items or [])
        has_update = result is True or result == "updated"
    except Exception as exc:
        logger.warning("站点 %s 更新检测失败: %s", site.name, exc)
        _retry_later(str(exc))
        return

    if has_update:
        st["next_check_at"] = now + CHECK_BASE_INTERVAL
        st["interval"] = CHECK_BASE_INTERVAL
        st["miss_count"] = 0
        st["last_check_status"] = "updated"
        st["last_error"] = None
        if await _enqueue_crawl(site.id):
            logger.info(
                "站点 %s 检测到有更新，已加入刮削队列 (队列长度=%d)",
                site.name,
                _crawl_queue.qsize(),
            )
    else:
        miss_count = int(st.get("miss_count", 0)) + 1
        new_interval = min(
            CHECK_BASE_INTERVAL * (CHECK_MISS_BACKOFF**miss_count),
            CHECK_MAX_INTERVAL,
        )
        st["next_check_at"] = now + new_interval
        st["interval"] = new_interval
        st["miss_count"] = miss_count
        st["last_check_status"] = "unchanged"
        st["last_error"] = None
        logger.debug(
            "站点 %s 无更新，下次检测 %d 秒后 (未命中=%d)",
            site.name,
            int(new_interval),
            miss_count,
        )


# ------------------------------------------------------------------
# 健康结果处理：自动禁用/恢复（仅自动维护循环调用）
# ------------------------------------------------------------------

async def _probe_all_sites() -> None:
    """兼容旧调用：立即对所有站点执行一轮健康检测。"""
    await _tick_site_maintenance(force=True)


async def _on_probe_success(site_id: int, site_name: str) -> None:
    """探测成功：清理失败计数，检查是否可自动恢复。"""
    async with async_session_factory() as session:
        await _reset_failure_count(session, site_id)

        site = await session.get(Site, site_id)
        if not site:
            return

        # 只有被自动禁用的站点才参与恢复
        if site.enabled or site.auto_disabled_at is None:
            return

        recovery_count = await _increment_recovery_count(session, site_id)
        logger.info(
            "站点探测成功 site=%s recovery_count=%s/%s",
            site_name,
            recovery_count,
            RECOVER_THRESHOLD,
        )

        if recovery_count >= RECOVER_THRESHOLD:
            site.enabled = True
            site.auto_disabled_at = None
            await session.commit()
            await _reset_recovery_count(session, site_id)
            await notify_sender.send(
                "health_events",
                Event(
                    "site_health",
                    {"site_id": site_id, "site_name": site_name, "enabled": True},
                )
            )
            logger.info("站点自动恢复 site=%s", site_name)


async def _on_probe_failure(site_id: int, site_name: str, error: str) -> None:
    """探测失败：增加失败计数，检查是否需自动禁用。"""
    async with async_session_factory() as session:
        await _reset_recovery_count(session, site_id)
        failure_count = await _increment_failure_count(session, site_id)

        logger.warning(
            "站点探测失败 site=%s error=%s failure_count=%s/%s",
            site_name,
            error,
            failure_count,
            FAIL_THRESHOLD,
        )

        if failure_count >= FAIL_THRESHOLD:
            site = await session.get(Site, site_id)
            if site and site.enabled:
                site.enabled = False
                site.auto_disabled_at = _utcnow()
                await session.commit()
                await notify_sender.send(
                    "health_events",
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
# 维护状态持久化（AppConfig，每 tick 一次批量写）
# ------------------------------------------------------------------

async def _persist_maintenance_state() -> None:
    """把 _maint_state 批量写入 AppConfig，重启后可恢复检测计划。"""
    payload = {
        "sites": {
            str(site_id): {
                "next_health_at": st.get("next_health_at"),
                "next_check_at": st.get("next_check_at"),
                "interval": st.get("interval"),
                "miss_count": st.get("miss_count", 0),
                "last_check_status": st.get("last_check_status"),
                "last_error": st.get("last_error"),
            }
            for site_id, st in _maint_state.items()
        }
    }
    try:
        async with async_session_factory() as session:
            row = await session.get(AppConfig, SCHEDULE_STATE_KEY)
            if row is None:
                session.add(
                    AppConfig(key=SCHEDULE_STATE_KEY, value=json.dumps(payload))
                )
            else:
                row.value = json.dumps(payload)
            await session.commit()
    except Exception:
        logger.exception("持久化站点维护状态失败")


async def _load_maintenance_state() -> None:
    """启动时恢复各站点的 next_health_at/next_check_at/last_check_status。"""
    try:
        async with async_session_factory() as session:
            row = await session.get(AppConfig, SCHEDULE_STATE_KEY)
        if not row:
            return
        payload = json.loads(row.value)
        loaded = 0
        for site_id_str, st in (payload.get("sites") or {}).items():
            try:
                site_id = int(site_id_str)
            except (TypeError, ValueError):
                continue
            _maint_state[site_id] = {
                "next_health_at": st.get("next_health_at"),
                "next_check_at": st.get("next_check_at"),
                "interval": st.get("interval"),
                "miss_count": st.get("miss_count", 0),
                "last_check_status": st.get("last_check_status"),
                "last_error": st.get("last_error"),
            }
            loaded += 1
        if loaded:
            logger.info("恢复 %d 个站点的维护调度状态", loaded)
    except Exception:
        logger.exception("恢复站点维护状态失败")


# ------------------------------------------------------------------
# 刮削 worker：检测到更新后通过协调器做增量刮削
# ------------------------------------------------------------------

async def _enqueue_crawl(site_id: int) -> bool:
    """站点入刮削队列；排队期间同一站点不重复入队。返回是否真正入队。"""
    if site_id in _crawl_queued:
        return False
    _crawl_queued.add(site_id)
    await _crawl_queue.put(site_id)
    return True


async def _crawl_worker_loop() -> None:
    """刮削 worker：从队列消费 site_id，经协调器提交 crawl.incremental 并等待终态。

    单 worker 串行处理，避免并发刮削风暴。
    """
    while True:
        site_id = await _crawl_queue.get()
        try:
            _crawl_queued.discard(site_id)
            if crawler:
                logger.info(
                    "刮削 worker 开始处理站点 %s (队列剩余=%d)",
                    site_id,
                    _crawl_queue.qsize(),
                )

                async def _handler(ctx, _site_id: int = site_id) -> dict:
                    return await crawler.run_incremental(
                        _site_id,
                        stop_event=ctx.cancel_event,
                        progress=ctx.progress,
                    )

                job = await maintenance_coordinator.submit(
                    "crawl.incremental",
                    _handler,
                    trigger="scheduled",
                    site_id=site_id,
                )
                await maintenance_coordinator.wait(job["id"])
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("刮削 worker 处理站点 %s 异常", site_id)
        finally:
            _crawl_queue.task_done()


# ------------------------------------------------------------------
# 每日定时全量补 videolist（本地时间 04:00）
# ------------------------------------------------------------------

def _next_fill_run_at() -> datetime:
    """下一次每日补全时间：本地时区的 CRAWLER_FILL_VIDEOLIST_HOUR:MINUTE。

    用 datetime.now().astimezone() 取本地时区，避免把本地 04:00 错算成 UTC。
    """
    now = datetime.now().astimezone()
    target = now.replace(
        hour=CRAWLER_FILL_VIDEOLIST_HOUR,
        minute=CRAWLER_FILL_VIDEOLIST_MINUTE,
        second=0,
        microsecond=0,
    )
    if target <= now:
        target += timedelta(days=1)
    return target


async def _fill_videolist_loop() -> None:
    """每日定时全量补 videolist，经协调器提交 detail.fill。

    已有补全任务在运行时协调器按 kind 全局去重，返回 deduplicated=True，
    本次定时触发直接跳过。
    """
    # 首次启动后先等一轮，避免启动风暴
    await asyncio.sleep(FILL_STARTUP_DELAY)

    while True:
        target = _next_fill_run_at()
        sleep_seconds = (target - datetime.now().astimezone()).total_seconds()
        logger.info(
            "下次自动补 videolist 时间: %s（%s 后）",
            target.isoformat(),
            timedelta(seconds=int(sleep_seconds)),
        )
        await asyncio.sleep(sleep_seconds)

        try:
            if crawler:
                logger.info("定时任务：开始自动全量补 videolist")

                async def _handler(ctx) -> dict:
                    return await crawler.run_fill_job(
                        None,
                        cancel_event=ctx.cancel_event,
                        progress=ctx.progress,
                    )

                job = await maintenance_coordinator.submit(
                    "detail.fill", _handler, trigger="scheduled"
                )
                if job.get("deduplicated"):
                    logger.info("已有补全任务在运行，跳过本次定时触发")
                else:
                    await maintenance_coordinator.wait(job["id"])
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("定时补 videolist 任务异常")


# ------------------------------------------------------------------
# 调度快照（供 maintenance overview 组合）
# ------------------------------------------------------------------

def _epoch_to_iso_z(value: float | int | None) -> str | None:
    if value is None:
        return None
    return (
        datetime.fromtimestamp(value, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def get_schedule_snapshot() -> dict:
    """调度快照：健康间隔、下次补全时间、每站下次健康/更新检测时间与状态。"""
    return {
        "health_interval_seconds": int(PROBE_INTERVAL),
        "fill_next_run_at": _next_fill_run_at()
        .astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "sites": {
            str(site_id): {
                "next_health_at": _epoch_to_iso_z(st.get("next_health_at")),
                "next_check_at": _epoch_to_iso_z(st.get("next_check_at")),
                "last_check_status": st.get("last_check_status"),
                "last_error": st.get("last_error"),
            }
            for site_id, st in _maint_state.items()
        },
    }
