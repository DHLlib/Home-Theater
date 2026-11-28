"""分类挂载的后端异步队列。

HTTP 只负责写入 category_link_jobs 并立即返回；本模块的工作协程串行领取
queued 任务，执行挂载/解挂和定向重算，避免用户连续点多个分类时并发写库。
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.constants import CATEGORY_QUEUE_POLL_SECONDS
from app.models import CategoryLinkJob, _utcnow
from app.services.category_links import (
    attach_affected_videos,
    attach_links,
    detach_links,
)

logger = logging.getLogger(__name__)


async def enqueue_job(
    db: AsyncSession,
    *,
    action: str,
    items: list[dict],
    label: str,
) -> CategoryLinkJob:
    job = CategoryLinkJob(
        id=uuid.uuid4().hex,
        action=action,
        label=label,
        items=items,
        state="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def recover_jobs(db: AsyncSession) -> None:
    """启动时把中断的 running 任务放回队列；挂载/解挂本身是幂等的。"""
    await db.execute(
        update(CategoryLinkJob)
        .where(CategoryLinkJob.state == "running")
        .values(state="queued", started_at=None)
    )
    await db.commit()


async def queue_counts(db: AsyncSession) -> dict:
    rows = (
        await db.execute(
            select(CategoryLinkJob.state, func.count())
            .where(CategoryLinkJob.state.in_(["queued", "running"]))
            .group_by(CategoryLinkJob.state)
        )
    ).all()
    counts = {state: int(count) for state, count in rows}
    return {
        "queued": counts.get("queued", 0),
        "running": counts.get("running", 0),
        "active": counts.get("queued", 0) + counts.get("running", 0),
    }


async def process_next_job(db: AsyncSession) -> bool:
    """领取并执行一个任务；返回是否处理了任务。测试可直接调用。"""
    job = (
        await db.execute(
            select(CategoryLinkJob)
            .where(CategoryLinkJob.state == "queued")
            .order_by(CategoryLinkJob.created_at, CategoryLinkJob.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if job is None:
        return False

    job_id = job.id
    action = job.action
    label = job.label
    job.state = "running"
    job.started_at = _utcnow()
    await db.commit()

    try:
        if action == "attach":
            touched = await attach_links(db, job.items)
        elif action == "detach":
            touched = await detach_links(db, job.items)
        else:
            raise ValueError(f"未知的分类任务类型：{action}")
        await db.commit()
        affected = await attach_affected_videos(db, touched) if touched else 0
        await db.commit()

        job.state = "done"
        job.affected_videos = int(affected or 0)
        job.finished_at = _utcnow()
        await db.commit()
        try:
            from app.api.videos import invalidate_category_filter_cache

            invalidate_category_filter_cache()
        except Exception:  # noqa: BLE001 - 缓存失效失败不能回滚已完成任务
            logger.exception("分类任务完成后失效缓存失败 job=%s", job_id)
        logger.info(
            "category_link_job_done id=%s action=%s label=%s videos=%d",
            job_id,
            action,
            label,
            affected,
        )
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        failed = await db.get(CategoryLinkJob, job_id)
        if failed is not None:
            failed.state = "failed"
            failed.error = str(exc)[:1000]
            failed.finished_at = _utcnow()
            await db.commit()
        logger.warning(
            "category_link_job_failed id=%s action=%s label=%s: %s",
            job_id,
            action,
            label,
            exc,
        )
    return True


async def process_next(
    db_factory: async_sessionmaker[AsyncSession],
) -> bool:
    async with db_factory() as db:
        return await process_next_job(db)


async def run_category_link_worker(
    db_factory: async_sessionmaker[AsyncSession],
) -> None:
    """单协程串行消费队列；空闲时短轮询。"""
    while True:
        try:
            processed = await process_next(db_factory)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("分类任务队列循环异常")
            processed = False
        if not processed:
            await asyncio.sleep(CATEGORY_QUEUE_POLL_SECONDS)


def job_payload(job: CategoryLinkJob) -> dict:
    return {
        "id": job.id,
        "action": job.action,
        "label": job.label,
        "state": job.state,
        "affected_videos": int(job.affected_videos or 0),
        "error": job.error,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "finished_at": _iso(job.finished_at),
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
