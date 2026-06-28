import logging

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import PlayProgress
from app.schemas import PlayProgressIn

router = APIRouter(prefix="/progress", tags=["progress"])
logger = logging.getLogger(__name__)


def _year_clause(year: int | None):
    """显式生成 year 的 WHERE 子句，避免依赖 SQLAlchemy 对 None 的隐式 IS NULL 行为。"""
    if year is None:
        return PlayProgress.year.is_(None)
    return PlayProgress.year == year


@router.post("")
async def upsert_progress(req: PlayProgressIn, db: AsyncSession = Depends(get_db)):
    stmt = (
        pg_insert(PlayProgress)
        .values(
            title=req.title,
            year=req.year,
            source_site_id=req.source_site_id,
            source_video_id=req.source_video_id,
            episode_index=req.episode_index,
            episode_name=req.episode_name,
            position_seconds=req.position_seconds,
            duration_seconds=req.duration_seconds,
        )
        .on_conflict_do_update(
            index_elements=["title", "year"],
            set_={
                "source_site_id": req.source_site_id,
                "source_video_id": req.source_video_id,
                "episode_index": req.episode_index,
                "episode_name": req.episode_name,
                "position_seconds": req.position_seconds,
                "duration_seconds": req.duration_seconds,
            },
        )
        .returning(PlayProgress)
    )
    result = await db.execute(stmt)
    row = result.scalar_one()
    await db.commit()
    await db.refresh(row)
    logger.info(
        "progress_upsert title=%s year=%s ep_index=%d pos=%ds",
        req.title, req.year, req.episode_index, req.position_seconds,
    )
    return row


@router.get("/recent")
async def list_recent(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PlayProgress).order_by(PlayProgress.updated_at.desc()).limit(50)
    )
    return result.scalars().all()


@router.get("")
async def get_progress(
    title: str, year: int | None = None, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PlayProgress).where(
            PlayProgress.title == title,
            _year_clause(year),
        )
    )
    row = result.scalar_one_or_none()
    if row:
        logger.info("progress_get title=%s year=%s ep_index=%d pos=%ds", title, year, row.episode_index, row.position_seconds)
    else:
        logger.info("progress_get_miss title=%s year=%s", title, year)
    return row


@router.delete("/{progress_id}")
async def delete_progress(progress_id: int, db: AsyncSession = Depends(get_db)):
    """删除单条播放记录。"""
    result = await db.execute(
        delete(PlayProgress).where(PlayProgress.id == progress_id)
    )
    await db.commit()
    deleted = result.rowcount
    logger.info("progress_deleted id=%d count=%d", progress_id, deleted)
    return {"deleted": deleted}


@router.delete("")
async def clear_progress(db: AsyncSession = Depends(get_db)):
    """清空所有最近播放记录。"""
    result = await db.execute(delete(PlayProgress))
    await db.commit()
    deleted = result.rowcount
    logger.info("progress_cleared count=%d", deleted)
    return {"deleted": deleted}
