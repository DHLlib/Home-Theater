import os
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AppConfig
from app.services import downloader
from app.services.ad_filter import is_ad_filter_enabled, set_ad_filter_enabled

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/download-root")
async def get_download_root(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "download_root")
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="download_root not set")
    return {"value": row.value}


@router.put("/download-root")
async def set_download_root(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    path = body.get("value", "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="value is required")
    p = Path(path)
    if not p.exists() or not p.is_dir():
        raise HTTPException(
            status_code=400, detail="path does not exist or is not a directory"
        )
    # Windows 网络路径（UNC/映射盘）上 os.access 经常不可靠，
    # 若 exists 已确认目录存在，则不再因 access 误判而拒绝；
    # 真实写权限由下载器在写入时通过 PermissionError 兜底。
    if not os.access(p, os.W_OK):
        # 保守放行：仅当路径明确不是 UNC/映射盘时才拒绝
        # UNC 路径形如 \\server\share；映射盘为 X:\ 等单盘符根
        if not (len(path) >= 2 and path[0] == "\\" and path[1] == "\\"):
            # 对普通本地路径仍要求可写
            try:
                test_file = p / ".ht_write_test"
                test_file.write_text("")
                test_file.unlink()
            except OSError as exc:
                raise HTTPException(
                    status_code=400, detail=f"path is not writable: {exc}"
                ) from exc

    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "download_root")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = str(p.resolve())
    else:
        row = AppConfig(key="download_root", value=str(p.resolve()))
        db.add(row)
    await db.commit()
    return {"value": row.value}


@router.get("/max-concurrent-downloads")
async def get_max_concurrent_downloads():
    return {"value": downloader.get_max_concurrent()}


@router.put("/max-concurrent-downloads")
async def set_max_concurrent_downloads(
    body: dict = Body(...), db: AsyncSession = Depends(get_db)
):
    raw = body.get("value")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="value must be an integer")
    if value < 1 or value > 50:
        raise HTTPException(status_code=400, detail="value must be between 1 and 50")

    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "max_concurrent_downloads")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = str(value)
    else:
        row = AppConfig(key="max_concurrent_downloads", value=str(value))
        db.add(row)
    await db.commit()

    # 立即通知运行中的 coordinator
    actual = downloader.set_max_concurrent(value)
    return {"value": actual}


@router.get("/ad-filter-enabled")
async def get_ad_filter_enabled_api():
    return {"value": await is_ad_filter_enabled()}


@router.put("/ad-filter-enabled")
async def set_ad_filter_enabled_api(body: dict = Body(...)):
    raw = body.get("value")
    if not isinstance(raw, bool):
        raise HTTPException(status_code=400, detail="value must be a boolean")
    await set_ad_filter_enabled(raw)
    return {"value": raw}
