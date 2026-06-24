"""下载任务 API：单集创建、批量创建、暂停/恢复/删除。"""
import asyncio
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AppConfig, DownloadTask
from app.schemas import DownloadBatchCreate, DownloadBatchResult, DownloadTaskCreate
from app.services.downloader import pause as dl_pause, request_stop, resume as dl_resume
from app.services.notify_sender import Event, notify_sender

router = APIRouter(prefix="/downloads", tags=["downloads"])
logger = logging.getLogger(__name__)

_batch_create_locks: dict[tuple[int, str], asyncio.Lock] = {}
_lock_creation_lock = asyncio.Lock()


async def _get_batch_lock(key: tuple[int, str]) -> asyncio.Lock:
    async with _lock_creation_lock:
        if key not in _batch_create_locks:
            _batch_create_locks[key] = asyncio.Lock()
        return _batch_create_locks[key]


def _sanitize_filename(name: str) -> str:
    safe = "".join(
        c if c.isalnum() or c in "._- " else "_" for c in name
    ).strip()
    if safe in (".", ".."):
        safe = "_"
    return safe


def _build_download_file_path(
    root: str | Path, title: str, episode_name: str, suffix: str
) -> str:
    safe_title = _sanitize_filename(title)
    safe_episode = _sanitize_filename(episode_name)
    suffix_lower = suffix.lower()
    if suffix_lower.endswith(("m3u8", "yun")):
        ext = "m3u8"
    elif suffix_lower in ("mp4", "webm"):
        ext = suffix_lower
    else:
        ext = "mp4"
    return str(Path(root) / safe_title / f"{safe_episode}.{ext}")


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

    file_path = _build_download_file_path(
        root_row.value, req.title, req.episode_name, req.suffix
    )

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
    logger.info("download_created task_id=%d title=%s episode=%s", task.id, req.title, req.episode_name)
    await notify_sender.send("download_events", Event("download_status", {
        "task_id": task.id,
        "status": task.status,
        "title": task.title,
        "episode_name": task.episode_name,
        "file_path": task.file_path,
        "source_site_id": task.source_site_id,
        "source_video_id": task.source_video_id,
        "url": task.url,
        "suffix": task.suffix,
    }))
    return task


@router.post("/batch")
async def create_download_batch(
    req: DownloadBatchCreate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "download_root")
    )
    root_row = result.scalar_one_or_none()
    if not root_row:
        raise HTTPException(status_code=409, detail="download_root not configured")

    logger.info(
        "download_batch_request site_id=%s original_id=%s title=%s episodes=%d",
        req.site_id,
        req.original_id,
        req.title,
        len(req.episodes),
    )

    key = (req.site_id, req.original_id)
    lock = await _get_batch_lock(key)
    try:
        async with lock:
            result = await _do_create_batch(req, db, root_row.value)
    except Exception:
        logger.exception(
            "download_batch_failed site_id=%s original_id=%s title=%s",
            req.site_id,
            req.original_id,
            req.title,
        )
        raise

    logger.info(
        "download_batch_done site_id=%s original_id=%s title=%s created=%s skipped=%s recreated=%s",
        req.site_id,
        req.original_id,
        req.title,
        result.created,
        result.skipped,
        result.recreated,
    )
    return result


async def _do_create_batch(
    req: DownloadBatchCreate, db: AsyncSession, root: str
) -> DownloadBatchResult:
    created: list[int] = []
    skipped: list[int] = []
    recreated: list[int] = []

    for ep in req.episodes:
        stmt = (
            select(DownloadTask)
            .where(
                DownloadTask.source_site_id == req.site_id,
                DownloadTask.source_video_id == req.original_id,
                DownloadTask.episode_index == ep.episode_index,
            )
            .order_by(DownloadTask.created_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        existing: DownloadTask | None = result.scalar_one_or_none()

        if existing and existing.status in ("queued", "downloading", "done"):
            skipped.append(existing.id)
            continue

        is_recreated = existing is not None and existing.status in ("paused", "error")
        if is_recreated:
            await db.delete(existing)

        file_path = _build_download_file_path(
            root, req.title, ep.episode_name, ep.suffix
        )
        task = DownloadTask(
            title=req.title,
            episode_index=ep.episode_index,
            episode_name=ep.episode_name,
            source_site_id=req.site_id,
            source_video_id=req.original_id,
            url=ep.url,
            suffix=ep.suffix,
            file_path=file_path,
            status="queued",
        )
        db.add(task)
        await db.flush()
        await db.refresh(task)

        if is_recreated:
            recreated.append(task.id)
        else:
            created.append(task.id)

        logger.info(
            "download_batch_created task_id=%d title=%s episode=%s recreated=%s",
            task.id,
            req.title,
            ep.episode_name,
            is_recreated,
        )
        await notify_sender.send("download_events", Event("download_status", {
            "task_id": task.id,
            "status": task.status,
            "title": task.title,
            "episode_name": task.episode_name,
            "file_path": task.file_path,
            "source_site_id": task.source_site_id,
            "source_video_id": task.source_video_id,
            "url": task.url,
            "suffix": task.suffix,
        }))

    await db.commit()
    return DownloadBatchResult(created=created, skipped=skipped, recreated=recreated)


@router.post("/{task_id}/pause")
async def pause_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_pause(task_id)
    # 状态在 downloader 的独立 session 中修改，重新查询以避免脏读
    task = await db.get(DownloadTask, task_id)
    return task


@router.post("/{task_id}/resume")
async def resume_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_resume(task_id)
    # 状态在 downloader 的独立 session 中修改，重新查询以避免脏读
    task = await db.get(DownloadTask, task_id)
    return task


@router.delete("/{task_id}")
async def delete_download(
    task_id: int,
    delete_file: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # 先通知运行中的 worker 尽快释放文件句柄，再删 DB 与文件
    request_stop(task_id)

    file_deleted = False
    file_error = None
    if delete_file and task.file_path:
        file_path = Path(task.file_path)
        targets: list[Path] = [file_path]

        # m3u8 任务完成前 file_path 仍是 .m3u8，完成后会被更新为 .mp4；
        # 实际下载的 .ts 片段临时存放在 .ts_{task_id}/ 目录。
        if file_path.suffix.lower() == ".m3u8":
            targets.append(file_path.with_suffix(".mp4"))
        ts_dir = file_path.parent / f".ts_{task.id}"
        if ts_dir.exists():
            targets.append(ts_dir)

        deleted_any = False
        errors: list[str] = []
        for target in targets:
            try:
                if target.is_file():
                    target.unlink()
                    deleted_any = True
                elif target.is_dir():
                    shutil.rmtree(target)
                    deleted_any = True
            except FileNotFoundError:
                pass
            except PermissionError:
                errors.append(f"无权限删除 {target.name}")
            except Exception as exc:
                errors.append(f"删除 {target.name} 失败: {exc}")

        file_deleted = deleted_any
        if not deleted_any:
            file_error = "; ".join(errors) if errors else "源文件已被删除或不存在"

    await db.delete(task)
    await db.commit()
    logger.info("download_deleted task_id=%d file_deleted=%s", task_id, file_deleted)
    await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "deleted"}))
    return {"ok": True, "file_deleted": file_deleted, "file_error": file_error}
