import os
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AppConfig

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
    if not os.access(p, os.W_OK):
        raise HTTPException(status_code=400, detail="path is not writable")

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
