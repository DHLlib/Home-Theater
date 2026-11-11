"""站点分类映射工作台 API。

- GET    /sites/{site_id}/category-map        该站类名分组 + 建议 + 现状
- POST   /sites/{site_id}/category-map        批量 upsert（别名 / 站点例外）+ 重算
- POST   /sites/{site_id}/category-map/undo   撤销最近一次批量写入
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import validation_error
from app.services.category_map import apply_site_map, build_site_map, undo_last_apply

router = APIRouter(prefix="/sites", tags=["category-map"])
logger = logging.getLogger(__name__)


@router.get("/{site_id}/category-map")
async def get_site_category_map(site_id: int, db: AsyncSession = Depends(get_db)):
    try:
        return await build_site_map(db, site_id)
    except ValueError:
        raise validation_error(f"站点不存在: {site_id}")


@router.post("/{site_id}/category-map")
async def save_site_category_map(
    site_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """items: [{raw_names: [...], system_name, scope: "global"|"site"}]"""
    items = body.get("items") or []
    fill_rest = body.get("fill_rest_system") or None
    if not isinstance(items, list):
        raise validation_error("items 必须是数组")
    try:
        return await apply_site_map(db, site_id, items, fill_rest_system=fill_rest)
    except ValueError:
        raise validation_error(f"站点不存在: {site_id}")


@router.post("/{site_id}/category-map/undo")
async def undo_site_category_map(site_id: int, db: AsyncSession = Depends(get_db)):
    return await undo_last_apply(db, site_id)
