"""站点删除后台任务：级联清理关联数据并刷新聚合缓存。"""
from __future__ import annotations

import asyncio
import logging
from typing import Type

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.db import async_session_factory
from app.models import (
    AggregatedSource,
    DownloadTask,
    Favorite,
    PlayProgress,
    Site,
    SiteCategoryMapping,
    SiteProbeLog,
    VideoCache,
)
from app.services.aggregator import refresh_aggregated_view
from app.services.notify_sender import Event, notify_sender

logger = logging.getLogger(__name__)

# 分批删除大小，避免大站点一次性删除导致事务/内存压力
_DELETE_BATCH_SIZE = 2000


async def _send_progress(site_id: int, status: str, progress: float, message: str) -> None:
    """发送删除进度事件；发送失败不影响删除流程。"""
    try:
        await notify_sender.send(
            "site_delete_events",
            Event(
                "site_delete_progress",
                {
                    "site_id": site_id,
                    "status": status,
                    "progress": round(progress, 2),
                    "message": message,
                },
            ),
        )
    except Exception:
        logger.exception("发送站点删除进度事件失败 site_id=%d", site_id)


async def _delete_in_batches(
    db: AsyncSession,
    site_id: int,
    model: Type[DeclarativeBase],
    filter_column,
    total: int,
    progress_base: float,
    progress_weight: float,
) -> int:
    """分批删除指定表中 site_id 匹配的记录，并发送进度。"""
    deleted_total = 0
    while True:
        result = await db.execute(
            delete(model).where(
                filter_column == site_id,
                model.id.in_(  # type: ignore[attr-defined]
                    select(model.id).where(filter_column == site_id).limit(_DELETE_BATCH_SIZE)  # type: ignore[attr-defined]
                ),
            )
        )
        count = result.rowcount or 0
        if count == 0:
            break
        deleted_total += count
        await db.commit()
        progress = progress_base + min(deleted_total / max(total, 1), 1.0) * progress_weight
        await _send_progress(
            site_id,
            "running",
            progress,
            f"已删除 {model.__tablename__} {deleted_total}/{total} 条",
        )
        # 让出事件循环，避免长时间阻塞
        await asyncio.sleep(0)
    return deleted_total


async def _cleanup_favorites(db: AsyncSession, site_id: int) -> None:
    """清理收藏中指向已删除站点的来源；若来源为空则删除整个收藏。"""
    result = await db.execute(select(Favorite))
    favorites = result.scalars().all()
    cleaned = 0
    removed = 0
    for fav in favorites:
        if not fav.sources:
            continue
        new_sources = [s for s in fav.sources if s.get("site_id") != site_id]
        if len(new_sources) == len(fav.sources):
            continue
        if new_sources:
            fav.sources = new_sources
            cleaned += 1
        else:
            await db.delete(fav)
            removed += 1
    await db.commit()
    logger.info(
        "favorites_cleaned site_id=%d updated=%d removed=%d",
        site_id,
        cleaned,
        removed,
    )


async def delete_site_background(site_id: int, site_name: str) -> None:
    """后台删除站点及其关联数据。"""
    logger.info("site_delete_started site_id=%d name=%s", site_id, site_name)
    await _send_progress(site_id, "running", 0, "开始删除站点")

    try:
        async with async_session_factory() as db:
            # 先禁用站点，防止删除过程中调度器继续刮削
            site = await db.get(Site, site_id)
            if site is None:
                await _send_progress(site_id, "failed", 0, "站点不存在")
                return
            site.enabled = False
            await db.commit()
            await _send_progress(site_id, "running", 2, "已禁用站点，停止刮削")

            # 1. 删除探测日志
            await db.execute(delete(SiteProbeLog).where(SiteProbeLog.site_id == site_id))
            await db.commit()
            await _send_progress(site_id, "running", 5, "已删除探测日志")

            # 2. 删除站点分类映射
            await db.execute(
                delete(SiteCategoryMapping).where(SiteCategoryMapping.site_id == site_id)
            )
            await db.commit()
            await _send_progress(site_id, "running", 10, "已删除分类映射")

            # 3. 删除聚合来源
            await db.execute(
                delete(AggregatedSource).where(AggregatedSource.site_id == site_id)
            )
            await db.commit()
            await _send_progress(site_id, "running", 15, "已删除聚合来源")

            # 4. 删除播放进度
            await db.execute(
                delete(PlayProgress).where(PlayProgress.source_site_id == site_id)
            )
            await db.commit()
            await _send_progress(site_id, "running", 20, "已删除播放进度")

            # 5. 删除下载任务
            await db.execute(
                delete(DownloadTask).where(DownloadTask.source_site_id == site_id)
            )
            await db.commit()
            await _send_progress(site_id, "running", 25, "已删除下载任务")

            # 6. 分批删除 video_cache（数据量最大的表）
            total_result = await db.execute(
                select(func.count()).select_from(VideoCache).where(VideoCache.site_id == site_id)
            )
            total = total_result.scalar_one() or 0
            await _send_progress(site_id, "running", 30, f"准备删除 {total} 条视频缓存")

            # 预先收集受影响的 norm_title，用于后续增量刷新聚合缓存
            norm_title_result = await db.execute(
                select(VideoCache.norm_title)
                .where(VideoCache.site_id == site_id, VideoCache.norm_title.isnot(None))
                .distinct()
            )
            affected_norm_titles = {n for n in norm_title_result.scalars().all() if n}
            logger.info(
                "site_delete_norm_titles site_id=%d count=%d",
                site_id,
                len(affected_norm_titles),
            )

            await _delete_in_batches(
                db,
                site_id,
                VideoCache,
                VideoCache.site_id,
                total,
                30,
                50,
            )

            # 7. 清理收藏来源
            await _cleanup_favorites(db, site_id)
            await _send_progress(site_id, "running", 85, "已清理收藏来源")

            # 8. 删除站点本身
            site = await db.get(Site, site_id)
            if site:
                await db.delete(site)
                await db.commit()
            await _send_progress(site_id, "running", 90, "已删除站点")

        # 9. 刷新聚合缓存（使用新 session，仅增量更新受影响的 norm_title）
        await _send_progress(site_id, "running", 92, "开始刷新聚合缓存")
        async with async_session_factory() as db:
            await refresh_aggregated_view(
                db,
                affected_norm_titles=affected_norm_titles if affected_norm_titles else None,
            )
        await _send_progress(site_id, "completed", 100, "删除完成")
        logger.info("site_delete_completed site_id=%d name=%s", site_id, site_name)

    except Exception as exc:
        logger.exception("site_delete_failed site_id=%d name=%s", site_id, site_name)
        await _send_progress(site_id, "failed", 0, f"删除失败: {exc}")
        raise
