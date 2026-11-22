"""统一维护任务 API：长任务提交 / 查询 / 取消 + 站点维护总览。

路由只做参数校验与调用协调器，具体业务在执行器（scheduler.crawler /
app.api.videos 的清理适配器）。执行器依赖延迟 import，避免循环依赖：
scheduler → crawler →（经 main 注册）本模块。
"""
from __future__ import annotations

import json

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import MAINTENANCE_LIST_LIMIT_MAX
from app.db import get_db
from app.models import AppConfig, Site, SiteHealthCounter, SiteProbeLog
from app.schemas import (
    MaintenanceJobCreate,
    MaintenanceJobOut,
    MaintenanceOverview,
    SiteMaintenanceStatus,
)
from app.services.maintenance import JobContext, maintenance_coordinator

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

# 可通过 API 提交的维护任务类型
SUBMITTABLE_KINDS = frozenset(
    {"crawl.full", "crawl.incremental", "detail.fill", "cache.cleanup"}
)


def _iso(dt: datetime | str | None) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        dt = parsed
    return dt.isoformat() + "Z"


def _load_json(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


# ------------------------------------------------------------------
# 任务提交
# ------------------------------------------------------------------

def _build_handler(kind: str, body: MaintenanceJobCreate):
    """按类型构造执行 handler；crawler 未启动时 503（在 submit 之前抛出）。"""
    if kind == "cache.cleanup":
        site_id, dry_run, speed = body.site_id, body.dry_run, body.speed

        async def _cleanup(ctx: JobContext):
            # 清理适配器由 videos 模块提供（延迟 import 避免循环依赖）
            from app.api import videos as videos_api

            return await videos_api.run_cleanup_managed(site_id, dry_run, speed, ctx)

        return _cleanup

    from app.services import scheduler

    crawler = scheduler.crawler
    if crawler is None:
        raise HTTPException(status_code=503, detail="刮削器尚未启动，请稍后重试")

    site_id = body.site_id
    if kind == "crawl.full":

        async def _full(ctx: JobContext):
            return await crawler.run_full_crawl(
                site_id=site_id, stop_event=ctx.cancel_event, progress=ctx.progress
            )

        return _full
    if kind == "crawl.incremental":

        async def _incremental(ctx: JobContext):
            return await crawler.run_incremental(
                site_id, stop_event=ctx.cancel_event, progress=ctx.progress
            )

        return _incremental

    async def _fill(ctx: JobContext):
        return await crawler.run_fill_job(
            site_id, cancel_event=ctx.cancel_event, progress=ctx.progress
        )

    return _fill


@router.post("/jobs/{kind}", response_model=MaintenanceJobOut)
async def start_maintenance_job(kind: str, body: MaintenanceJobCreate | None = None):
    body = body or MaintenanceJobCreate()
    if kind not in SUBMITTABLE_KINDS:
        raise HTTPException(status_code=400, detail=f"不支持的任务类型: {kind}")
    if kind == "crawl.incremental" and body.site_id is None:
        raise HTTPException(status_code=400, detail="crawl.incremental 必须指定 site_id")

    handler = _build_handler(kind, body)
    return await maintenance_coordinator.submit(
        kind, handler, trigger="manual", site_id=body.site_id
    )


# ------------------------------------------------------------------
# 查询 / 取消
# ------------------------------------------------------------------

@router.get("/jobs", response_model=list[MaintenanceJobOut])
async def list_maintenance_jobs(
    limit: int = Query(30, ge=1, le=MAINTENANCE_LIST_LIMIT_MAX),
    active_only: bool = Query(False),
):
    return await maintenance_coordinator.list_jobs(limit=limit, active_only=active_only)


@router.get("/jobs/{job_id}", response_model=MaintenanceJobOut)
async def get_maintenance_job(job_id: str):
    job = await maintenance_coordinator.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@router.post("/jobs/{job_id}/cancel", response_model=MaintenanceJobOut)
async def cancel_maintenance_job(job_id: str):
    job = await maintenance_coordinator.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


# ------------------------------------------------------------------
# 站点维护总览
# ------------------------------------------------------------------

@router.get("/overview", response_model=MaintenanceOverview)
async def maintenance_overview(db: AsyncSession = Depends(get_db)):
    sites = (
        await db.execute(select(Site).order_by(Site.sort, Site.id))
    ).scalars().all()
    site_ids = [s.id for s in sites]

    # 健康计数器 + 每站最新探测日志（DISTINCT ON，一次查询，禁止 N+1）
    counters: dict[int, SiteHealthCounter] = {}
    latest_logs: dict[int, SiteProbeLog] = {}
    if site_ids:
        counter_rows = (
            await db.execute(
                select(SiteHealthCounter).where(
                    SiteHealthCounter.site_id.in_(site_ids)
                )
            )
        ).scalars().all()
        counters = {c.site_id: c for c in counter_rows}

        log_rows = (
            await db.execute(
                select(SiteProbeLog)
                .where(SiteProbeLog.site_id.in_(site_ids))
                .distinct(SiteProbeLog.site_id)
                .order_by(
                    SiteProbeLog.site_id,
                    SiteProbeLog.created_at.desc(),
                    SiteProbeLog.id.desc(),
                )
            )
        ).scalars().all()
        latest_logs = {log.site_id: log for log in log_rows}

    # 刮削状态 / 统计快照（爬虫预计算的 AppConfig，O(1) 读取，不整表统计）
    cfg_rows = (
        await db.execute(
            select(AppConfig).where(AppConfig.key.in_(["crawler_state", "crawler_stats"]))
        )
    ).scalars().all()
    cfg = {row.key: row.value for row in cfg_rows}
    crawler_state = _load_json(cfg.get("crawler_state"))
    crawler_stats = _load_json(cfg.get("crawler_stats"))
    state_sites = crawler_state.get("sites", {})
    stats_by_site = {
        item["site_id"]: item
        for item in crawler_stats.get("by_site", [])
        if isinstance(item, dict) and "site_id" in item
    }

    # 调度快照由 scheduler 提供（另一模块负责实现，未就绪时给最小兜底）
    from app.services import scheduler

    snapshot_fn = getattr(scheduler, "get_schedule_snapshot", None)
    if callable(snapshot_fn):
        schedules = snapshot_fn()
    else:
        schedules = {
            "health_interval_seconds": getattr(scheduler, "PROBE_INTERVAL", None),
            "fill_next_run_at": None,
            "sites": {},
        }
    schedule_sites = schedules.get("sites", {}) if isinstance(schedules, dict) else {}

    active_jobs = await maintenance_coordinator.list_jobs(active_only=True)

    def _active_ids(site_id: int) -> list[str]:
        return [
            job["id"]
            for job in active_jobs
            if job["site_id"] == site_id or job["site_id"] is None
        ]

    site_statuses: list[SiteMaintenanceStatus] = []
    for site in sites:
        counter = counters.get(site.id)
        latest = latest_logs.get(site.id)
        health = None
        if counter is not None or latest is not None:
            health = {
                "failure_count": counter.failure_count if counter else 0,
                "recovery_count": counter.recovery_count if counter else 0,
                "last_probe_ok": latest.ok if latest else None,
                "last_probe_at": _iso(latest.created_at) if latest else None,
                "last_probe_error": latest.error if latest else None,
                "last_probe_latency_ms": latest.response_time_ms if latest else None,
            }

        site_state = state_sites.get(str(site.id), {})
        crawl_times = [
            t
            for t in (site_state.get("last_full_crawl"), site_state.get("last_incremental"))
            if t
        ]
        stats = stats_by_site.get(site.id, {})
        sched = schedule_sites.get(str(site.id), {})

        site_statuses.append(
            SiteMaintenanceStatus(
                site_id=site.id,
                site_name=site.name,
                enabled=site.enabled,
                health=health,
                last_crawl_at=_iso(max(crawl_times)) if crawl_times else None,
                total=int(stats.get("count", 0)),
                with_detail=int(stats.get("with_detail", 0)),
                without_detail=int(stats.get("without_detail", 0)),
                next_check_at=min(
                    (
                        value
                        for value in (
                            sched.get("next_health_at"), sched.get("next_check_at")
                        )
                        if value
                    ),
                    default=None,
                ),
                last_check_status=sched.get("last_check_status"),
                active_job_ids=_active_ids(site.id),
            )
        )

    jobs = await maintenance_coordinator.list_jobs()
    return MaintenanceOverview(
        sites=site_statuses,
        jobs=[MaintenanceJobOut(**job) for job in jobs],
        schedules=schedules,
    )
