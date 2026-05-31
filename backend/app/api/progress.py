import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import PlayProgress
from app.schemas import PlayProgressIn

router = APIRouter(prefix="/progress", tags=["progress"])
logger = logging.getLogger(__name__)


@router.post("")
async def upsert_progress(req: PlayProgressIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PlayProgress).where(
            PlayProgress.title == req.title,
            PlayProgress.year == req.year,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.source_site_id = req.source_site_id
        row.source_video_id = req.source_video_id
        row.episode_index = req.episode_index
        row.episode_name = req.episode_name
        row.position_seconds = req.position_seconds
        row.duration_seconds = req.duration_seconds
    else:
        row = PlayProgress(
            title=req.title,
            year=req.year,
            source_site_id=req.source_site_id,
            source_video_id=req.source_video_id,
            episode_index=req.episode_index,
            episode_name=req.episode_name,
            position_seconds=req.position_seconds,
            duration_seconds=req.duration_seconds,
        )
        db.add(row)
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
            PlayProgress.year == year,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        logger.info("progress_get title=%s year=%s ep_index=%d pos=%ds", title, year, row.episode_index, row.position_seconds)
    else:
        logger.info("progress_get_miss title=%s year=%s", title, year)
    return row
