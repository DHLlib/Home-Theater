import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AppConfig, DownloadTask
from app.schemas import DownloadTaskCreate
from app.services.downloader import pause as dl_pause, resume as dl_resume

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("")
async def list_downloads(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DownloadTask).order_by(DownloadTask.created_at.desc())
    )
    return result.scalars().all()


@router.post("")
async def create_download(req: DownloadTaskCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "download_root")
    )
    root_row = result.scalar_one_or_none()
    if not root_row:
        raise HTTPException(status_code=409, detail="download_root not configured")

    root = Path(root_row.value)
    safe_title = "".join(
        c if c.isalnum() or c in "._- " else "_" for c in req.title
    ).strip()
    episode_name = "".join(
        c if c.isalnum() or c in "._- " else "_" for c in req.episode_name
    ).strip()
    ext = req.suffix if req.suffix in ("mp4", "m3u8") else "mp4"
    file_path = str(root / safe_title / f"{episode_name}.{ext}")

    task = DownloadTask(
        title=req.title,
        episode_index=req.episode_index,
        episode_name=req.episode_name,
        source_site_id=req.site_id,
        source_video_id=req.original_id,
        url=req.url,
        suffix=req.suffix,
        file_path=file_path,
        status="queued",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.post("/{task_id}/pause")
async def pause_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_pause(task_id)
    return task


@router.post("/{task_id}/resume")
async def resume_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_resume(task_id)
    return task


@router.delete("/{task_id}")
async def delete_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
    return {"ok": True}
