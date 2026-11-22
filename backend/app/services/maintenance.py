"""统一维护任务协调器：刮削 / videolist 补全 / 缓存清理等长任务的单一控制面。

单进程个人部署，不引入外部队列：
- 进程内 asyncio 调度，maintenance_jobs 表做持久化（恢复 / 历史 / 前端快照）。
- 每次状态 / 进度变化写 DB（进度按 MAINTENANCE_PROGRESS_FLUSH_SECONDS 节流，
  终态必写），并通过 maintenance_events 频道推 maintenance_progress 事件；
  事件 payload 只有轻量字段，前端收到后拉快照，丢事件不会永久 loading。
- 去重：crawl.full / detail.fill / cache.cleanup 全局同类型去重，
  crawl.incremental 按 (kind, site_id) 去重。活动 key 在第一个 await 之前
  同步预留，两个并发 submit 不会都创建任务。
- 取消是合作式的：cancel_event 置位 + DB 落 cancel_requested，执行器在
  批次 / 页边界响应；即使 handler 正常返回，只要 cancel_event 已置位就标
  cancelled。重启遗留的 queued/running 由 recover_interrupted 标 interrupted。
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select, update

from app.constants import (
    MAINTENANCE_LIST_LIMIT_MAX,
    MAINTENANCE_PROGRESS_FLUSH_SECONDS,
    MAINTENANCE_SHUTDOWN_TIMEOUT_SECONDS,
)
from app.models import MaintenanceJob, _utcnow
from app.services.notify_sender import Event, notify_sender

logger = logging.getLogger(__name__)

ACTIVE_STATES = ("queued", "running")
TERMINAL_STATES = ("done", "partial", "failed", "skipped", "cancelled", "interrupted")
# handler 允许自报的终态（cancelled / interrupted 由协调器决定，不接受自报）
HANDLER_STATES = ("done", "partial", "failed", "skipped")
# 全局同类型去重（不区分 site_id）；crawl.incremental 按 (kind, site_id) 去重
GLOBAL_DEDUP_KINDS = frozenset({"crawl.full", "detail.fill", "cache.cleanup"})

JobHandler = Callable[["JobContext"], Awaitable[dict | None]]

_ERROR_MAX_LEN = 500


def _iso(dt: datetime | None) -> str | None:
    """DB 存的是 naive UTC（_utcnow），API 序列化为带 Z 的 ISO 字符串。"""
    if dt is None:
        return None
    return dt.isoformat() + "Z"


def _row_to_dict(row: MaintenanceJob) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "state": row.state,
        "trigger": row.trigger,
        "site_id": row.site_id,
        "cancel_requested": row.cancel_requested,
        "progress_completed": row.progress_completed,
        "progress_total": row.progress_total,
        "details": row.details or {},
        "error": row.error,
        "created_at": _iso(row.created_at),
        "started_at": _iso(row.started_at),
        "finished_at": _iso(row.finished_at),
    }


class JobContext:
    """传给任务处理函数的上下文：真实 job_id + 合作取消信号 + 进度上报。"""

    def __init__(
        self,
        coordinator: "MaintenanceCoordinator",
        job_id: str,
        cancel_event: asyncio.Event,
    ) -> None:
        self._coordinator = coordinator
        self.job_id = job_id
        self.cancel_event = cancel_event

    async def progress(
        self, completed: int, total: int, details: dict | None = None
    ) -> None:
        """上报进度：更新内存快照并按节流写库 / 推送。终态由协调器兜底必写。"""
        await self._coordinator._on_progress(
            self.job_id, completed, total, details or {}
        )


class MaintenanceCoordinator:
    """维护任务协调器（单例见模块底部；测试可注入独立 db_factory）。"""

    def __init__(self, db_factory: Any = None) -> None:
        self._db_factory = db_factory
        # job_id -> {snapshot, ctx, task, key, created_dt}
        self._active: dict[str, dict] = {}
        # 去重 key -> job_id；key 为 (kind, site_id|None)
        self._active_keys: dict[tuple, str] = {}
        self._last_flush: dict[str, float] = {}
        # 每个 job 一把写库锁：cancel() 与任务协程可能并发 flush 同一行，
        # 后 commit 的旧值会覆盖先 commit 的新值；锁内再从活快照取值可避免
        self._flush_locks: dict[str, asyncio.Lock] = {}

    # ------------------------------------------------------------------
    # 提交 / 执行
    # ------------------------------------------------------------------

    @staticmethod
    def _dedup_key(kind: str, site_id: int | None) -> tuple:
        if kind in GLOBAL_DEDUP_KINDS:
            return (kind, None)
        return (kind, site_id)

    async def submit(
        self,
        kind: str,
        handler: JobHandler,
        *,
        trigger: str = "manual",
        site_id: int | None = None,
    ) -> dict:
        """提交任务并立即返回 job dict；重复提交返回已有活动任务且 deduplicated=True。"""
        key = self._dedup_key(kind, site_id)
        # 第一个 await 之前完成去重检查 + key 预留：单事件循环内同步执行，
        # 并发 submit 只会有一个走到创建分支
        existing_id = self._active_keys.get(key)
        if existing_id is not None:
            existing = self._active.get(existing_id)
            if existing is not None and existing["snapshot"]["state"] in ACTIVE_STATES:
                snap = dict(existing["snapshot"])
                snap["deduplicated"] = True
                return snap

        job_id = uuid4().hex
        cancel_event = asyncio.Event()
        ctx = JobContext(self, job_id, cancel_event)
        created_dt = _utcnow()
        snapshot = {
            "id": job_id,
            "kind": kind,
            "state": "queued",
            "trigger": trigger,
            "site_id": site_id,
            "cancel_requested": False,
            "progress_completed": 0,
            "progress_total": 0,
            "details": {},
            "error": None,
            "created_at": _iso(created_dt),
            "started_at": None,
            "finished_at": None,
        }
        entry = {
            "snapshot": snapshot,
            "ctx": ctx,
            "task": None,
            "key": key,
            "created_dt": created_dt,
        }
        self._active[job_id] = entry
        self._active_keys[key] = job_id
        self._flush_locks[job_id] = asyncio.Lock()

        try:
            await self._insert_row(job_id, snapshot, created_dt)
        except Exception as exc:
            self._active.pop(job_id, None)
            if self._active_keys.get(key) == job_id:
                self._active_keys.pop(key, None)
            self._flush_locks.pop(job_id, None)
            raise RuntimeError("无法保存任务状态，请检查数据库后重试") from exc
        await self._publish(snapshot)
        entry["task"] = asyncio.create_task(self._execute(job_id, handler))
        return dict(snapshot)

    async def run(
        self,
        kind: str,
        handler: JobHandler,
        *,
        trigger: str = "manual",
        site_id: int | None = None,
    ) -> dict:
        """提交并等待终态，返回最终 job dict（用于 site.discover 等短任务记录）。"""
        job = await self.submit(kind, handler, trigger=trigger, site_id=site_id)
        final = await self.wait(job["id"])
        return final if final is not None else job

    async def _execute(self, job_id: str, handler: JobHandler) -> None:
        entry = self._active.get(job_id)
        if entry is None:
            return
        snap = entry["snapshot"]
        ctx = entry["ctx"]

        snap["state"] = "running"
        snap["started_at"] = _iso(_utcnow())
        await self._flush(job_id, snap, force=True)
        await self._publish(snap)

        try:
            result = await handler(ctx)
        except asyncio.CancelledError:
            # 任务协程被硬取消（仅 shutdown 兜底路径）：不向外传播，
            # wait() 的等待方不应被波及
            if ctx.cancel_event.is_set():
                snap["state"] = "cancelled"
            else:
                snap["state"] = "interrupted"
                snap["error"] = snap["error"] or "服务关闭，任务中断"
        except Exception as exc:
            logger.exception("维护任务执行失败 job=%s kind=%s", job_id, snap["kind"])
            snap["state"] = "failed"
            snap["error"] = f"{type(exc).__name__}: {exc}"[:_ERROR_MAX_LEN]
        else:
            if ctx.cancel_event.is_set():
                # 合作式取消：即使 handler 正常返回也标 cancelled
                snap["state"] = "cancelled"
            elif isinstance(result, dict):
                state = result.get("state")
                snap["state"] = state if state in HANDLER_STATES else "done"
                if result.get("error"):
                    snap["error"] = str(result["error"])[:_ERROR_MAX_LEN]
                if isinstance(result.get("details"), dict):
                    snap["details"] = {**snap["details"], **result["details"]}
                if result.get("progress_completed") is not None:
                    snap["progress_completed"] = int(result["progress_completed"])
                if result.get("progress_total") is not None:
                    snap["progress_total"] = int(result["progress_total"])
            else:
                snap["state"] = "done"

        snap["finished_at"] = _iso(_utcnow())
        await self._flush(job_id, snap, force=True)
        await self._publish(snap)

        self._active.pop(job_id, None)
        if self._active_keys.get(entry["key"]) == job_id:
            self._active_keys.pop(entry["key"], None)
        self._last_flush.pop(job_id, None)
        self._flush_locks.pop(job_id, None)
        logger.info(
            "维护任务结束 job=%s kind=%s state=%s", job_id, snap["kind"], snap["state"]
        )

    # ------------------------------------------------------------------
    # 进度 / 取消 / 等待
    # ------------------------------------------------------------------

    async def _on_progress(
        self, job_id: str, completed: int, total: int, details: dict
    ) -> None:
        entry = self._active.get(job_id)
        if entry is None:
            return
        snap = entry["snapshot"]
        snap["progress_completed"] = completed
        snap["progress_total"] = total
        if details:
            snap["details"] = {**snap["details"], **details}
        await self._flush(job_id, snap, force=False)
        await self._publish(snap)

    async def cancel(self, job_id: str) -> dict | None:
        """合作式取消：置 cancel_event + 持久化 cancel_requested，不硬杀写入。"""
        entry = self._active.get(job_id)
        if entry is None:
            return await self.get_job(job_id)
        snap = entry["snapshot"]
        if snap["state"] in TERMINAL_STATES:
            return dict(snap)
        entry["ctx"].cancel_event.set()
        snap["cancel_requested"] = True
        await self._flush(job_id, snap, force=True)
        await self._publish(snap)
        return dict(snap)

    async def wait(self, job_id: str) -> dict | None:
        """等待任务协程结束并返回快照；shield 隔离，等待方被取消不会波及任务。"""
        entry = self._active.get(job_id)
        if entry is None or entry["task"] is None:
            return await self.get_job(job_id)
        snap = entry["snapshot"]
        task = entry["task"]
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            # 区分来源：任务自身被取消 → 返回快照；等待方被取消 → 继续传播
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                raise
        return dict(snap)

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    async def get_job(self, job_id: str) -> dict | None:
        entry = self._active.get(job_id)
        if entry is not None:
            return dict(entry["snapshot"])
        async with self._factory()() as db:
            row = await db.get(MaintenanceJob, job_id)
        return _row_to_dict(row) if row is not None else None

    async def list_jobs(self, limit: int = 30, active_only: bool = False) -> list[dict]:
        """倒序返回任务：数据库最新记录 + 内存活动任务覆盖（内存更实时）。"""
        limit = max(1, min(limit, MAINTENANCE_LIST_LIMIT_MAX))
        if active_only:
            jobs = [dict(e["snapshot"]) for e in self._active.values()]
            jobs.sort(key=lambda j: j["created_at"] or "", reverse=True)
            return jobs[:limit]
        async with self._factory()() as db:
            rows = (
                await db.execute(
                    select(MaintenanceJob)
                    .order_by(MaintenanceJob.created_at.desc())
                    .limit(limit)
                )
            ).scalars().all()
        by_id = {row.id: _row_to_dict(row) for row in rows}
        for e in self._active.values():
            by_id[e["snapshot"]["id"]] = dict(e["snapshot"])
        merged = sorted(
            by_id.values(), key=lambda j: j["created_at"] or "", reverse=True
        )
        return merged[:limit]

    def find_active(self, kind: str) -> dict | None:
        """返回该类型当前活动任务的快照（同步内存查询，供旧 cancel 入口适配）。"""
        for e in self._active.values():
            snap = e["snapshot"]
            if snap["kind"] == kind and snap["state"] in ACTIVE_STATES:
                return dict(snap)
        return None

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    async def recover_interrupted(self) -> None:
        """启动时调用：DB 中遗留的 queued/running（及 cancel_requested 未落地）
        任务说明进程死过，统一标记 interrupted。终态不动。"""
        stale = MaintenanceJob.state.in_(ACTIVE_STATES) | (
            MaintenanceJob.cancel_requested.is_(True)
            & MaintenanceJob.state.notin_(TERMINAL_STATES)
        )
        async with self._factory()() as db:
            result = await db.execute(
                update(MaintenanceJob)
                .where(stale)
                .values(
                    state="interrupted",
                    error="服务重启，任务中断",
                    finished_at=_utcnow(),
                )
            )
            if result.rowcount:
                await db.commit()
                logger.info("恢复 %d 个重启前未完成的维护任务为 interrupted", result.rowcount)

    async def shutdown(self) -> None:
        """关闭：为全部活动任务置 cancel_event，限时等待合作退出，
        超时后兜底硬取消并 await，不遗留协程。"""
        entries = list(self._active.values())
        if not entries:
            return
        for e in entries:
            e["ctx"].cancel_event.set()
            if e["snapshot"]["state"] == "queued":
                e["snapshot"]["cancel_requested"] = True

        deadline = time.monotonic() + MAINTENANCE_SHUTDOWN_TIMEOUT_SECONDS
        for e in entries:
            task = e["task"]
            if task is None or task.done():
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=remaining)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        pending = [
            e["task"] for e in entries if e["task"] is not None and not e["task"].done()
        ]
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

        # 兜底：协程被取消前还没落终态（如 queued 尚未启动）时补写 interrupted
        for e in entries:
            snap = e["snapshot"]
            if snap["state"] in ACTIVE_STATES:
                snap["state"] = "interrupted"
                snap["error"] = snap["error"] or "服务关闭，任务中断"
                snap["finished_at"] = _iso(_utcnow())
                await self._flush(e["snapshot"]["id"], snap, force=True)
            self._active.pop(snap["id"], None)
            if self._active_keys.get(e["key"]) == snap["id"]:
                self._active_keys.pop(e["key"], None)
            self._last_flush.pop(snap["id"], None)
            self._flush_locks.pop(snap["id"], None)

    # ------------------------------------------------------------------
    # 持久化 / 事件
    # ------------------------------------------------------------------

    def _factory(self):
        if self._db_factory is not None:
            return self._db_factory
        from app.db import async_session_factory

        return async_session_factory

    async def _insert_row(
        self, job_id: str, snap: dict, created_dt: datetime
    ) -> None:
        try:
            async with self._factory()() as db:
                db.add(
                    MaintenanceJob(
                        id=job_id,
                        kind=snap["kind"],
                        trigger=snap["trigger"],
                        state=snap["state"],
                        site_id=snap["site_id"],
                        cancel_requested=snap["cancel_requested"],
                        progress_completed=snap["progress_completed"],
                        progress_total=snap["progress_total"],
                        details=snap["details"],
                        error=snap["error"],
                        created_at=created_dt,
                    )
                )
                await db.commit()
        except Exception:
            logger.exception("维护任务写库失败（插入）job=%s", job_id)
            raise

    async def _flush(self, job_id: str, snap: dict, *, force: bool) -> None:
        """把快照的非终态字段写回 DB；进度写按节流，force=True（状态迁移 / 终态）必写。

        同一 job 的并发 flush（cancel 与任务协程）按锁串行，且在锁内才从
        活快照取值构造 UPDATE：否则先开始、后 commit 的旧快照会覆盖新状态。
        """
        lock = self._flush_locks.get(job_id)
        if lock is None:
            await self._flush_locked(job_id, snap, force=force)
            return
        async with lock:
            await self._flush_locked(job_id, snap, force=force)

    async def _flush_locked(self, job_id: str, snap: dict, *, force: bool) -> None:
        now = time.monotonic()
        last = self._last_flush.get(job_id, 0.0)
        if not force and now - last < MAINTENANCE_PROGRESS_FLUSH_SECONDS:
            return
        self._last_flush[job_id] = now
        try:
            async with self._factory()() as db:
                await db.execute(
                    update(MaintenanceJob)
                    .where(MaintenanceJob.id == job_id)
                    .values(
                        state=snap["state"],
                        cancel_requested=snap["cancel_requested"],
                        progress_completed=snap["progress_completed"],
                        progress_total=snap["progress_total"],
                        details=snap["details"],
                        error=snap["error"],
                        started_at=(
                            datetime.fromisoformat(snap["started_at"].rstrip("Z"))
                            if snap["started_at"]
                            else None
                        ),
                        finished_at=(
                            datetime.fromisoformat(snap["finished_at"].rstrip("Z"))
                            if snap["finished_at"]
                            else None
                        ),
                    )
                )
                await db.commit()
        except Exception:
            logger.exception("维护任务写库失败（更新）job=%s", job_id)

    async def _publish(self, snap: dict) -> None:
        """推送轻量进度事件；payload 不含 details，前端收到后拉快照。"""
        try:
            await notify_sender.send(
                "maintenance_events",
                Event(
                    "maintenance_progress",
                    {
                        "job_id": snap["id"],
                        "kind": snap["kind"],
                        "state": snap["state"],
                        "site_id": snap["site_id"],
                        "trigger": snap["trigger"],
                        "progress_completed": snap["progress_completed"],
                        "progress_total": snap["progress_total"],
                        "cancel_requested": snap["cancel_requested"],
                    },
                ),
            )
        except Exception:
            logger.exception("维护任务事件推送失败 job=%s", snap["id"])


maintenance_coordinator = MaintenanceCoordinator()
