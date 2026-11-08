"""分类别名 API：一屏式分类对照表的数据来源。

- GET    /category-aliases            列出全部别名（含使用量）
- GET    /category-aliases/unmapped   未归类的远程类名
- POST   /category-aliases            新增（或更新）一条别名
- PUT    /category-aliases/{key}      改系统分类 / 启停
- DELETE /category-aliases/{key}      删除
- POST   /category-aliases/adopt      批量采纳（未分类一键归类）
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import CategoryAlias, SystemCategory
from app.services.category_alias import (
    alias_usage,
    delete_alias,
    invalidate_alias_cache,
    list_overrides,
    load_aliases,
    recompute_videos_for_names,
    unmapped_categories,
    upsert_alias,
)

router = APIRouter(prefix="/category-aliases", tags=["category-aliases"])
logger = logging.getLogger(__name__)


def _invalidate_all() -> None:
    """别名变更后同时作废别名缓存与首页分类过滤缓存。"""
    invalidate_alias_cache()
    from app.api.videos import invalidate_category_filter_cache

    invalidate_category_filter_cache()


async def _system_category_names(db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(SystemCategory.name).order_by(SystemCategory.sort, SystemCategory.id)
    )
    return [row[0] for row in result.all()]


@router.get("")
async def list_category_aliases(db: AsyncSession = Depends(get_db)):
    """别名列表：附来源条数/站点数，按来源数倒序，便于优先处理热门类名。"""
    aliases = await load_aliases(db, use_cache=False)
    usage = await alias_usage(db)
    system_names = await _system_category_names(db)

    items = []
    for key, info in aliases.items():
        stat = usage.get(key, {"sources": 0, "sites": 0, "raw_names": []})
        items.append(
            {
                "name_key": key,
                "system_name": info["system_name"],
                "enabled": info["enabled"],
                "source": "manual" if not info["enabled"] else "auto",
                "raw_names": sorted(
                    set(info["raw_names"]) | set(stat["raw_names"])
                ),
                "source_count": stat["sources"],
                "site_count": stat["sites"],
            }
        )
    items.sort(key=lambda item: item["source_count"], reverse=True)
    return {"items": items, "system_categories": system_names}


@router.get("/unmapped")
async def list_unmapped(db: AsyncSession = Depends(get_db)):
    return {"items": await unmapped_categories(db)}


@router.get("/overrides")
async def list_site_overrides(db: AsyncSession = Depends(get_db)):
    rows = await list_overrides(db)
    return {
        "items": [
            {
                "id": row.id,
                "site_id": row.site_id,
                "name_key": row.name_key,
                "system_name": row.system_name,
            }
            for row in rows
        ]
    }


@router.post("")
async def create_or_update_alias(
    body: dict = Body(...), db: AsyncSession = Depends(get_db)
):
    raw_name = str(body.get("raw_name") or body.get("name_key") or "").strip()
    system_name = str(body.get("system_name") or "").strip()
    if not raw_name or not system_name:
        return {"ok": False, "detail": "raw_name 与 system_name 必填"}

    alias = await upsert_alias(db, raw_name, system_name)
    await db.commit()
    await db.refresh(alias)
    _invalidate_all()
    await recompute_videos_for_names(db, list(alias.raw_names or [raw_name]))
    logger.info(
        "category_alias_saved key=%s system=%s", alias.name_key, alias.system_name
    )
    return {
        "ok": True,
        "name_key": alias.name_key,
        "system_name": alias.system_name,
        "enabled": alias.enabled,
    }


@router.put("/{name_key}")
async def update_alias(
    name_key: str, body: dict = Body(...), db: AsyncSession = Depends(get_db)
):
    alias = await db.get(CategoryAlias, name_key)
    if alias is None:
        return {"ok": False, "detail": "别名不存在"}

    if "system_name" in body:
        alias.system_name = str(body["system_name"]).strip() or alias.system_name
        alias.source = "manual"
    if "enabled" in body:
        alias.enabled = bool(body["enabled"])

    await db.commit()
    _invalidate_all()
    await recompute_videos_for_names(db, list(alias.raw_names or [alias.name_key]))
    logger.info(
        "category_alias_updated key=%s system=%s enabled=%s",
        alias.name_key,
        alias.system_name,
        alias.enabled,
    )
    return {
        "ok": True,
        "name_key": alias.name_key,
        "system_name": alias.system_name,
        "enabled": alias.enabled,
    }


@router.delete("/{name_key}")
async def remove_alias(name_key: str, db: AsyncSession = Depends(get_db)):
    alias = await db.get(CategoryAlias, name_key)
    raw_names = list(alias.raw_names or [name_key]) if alias else [name_key]
    removed = await delete_alias(db, name_key)
    await db.commit()
    if removed:
        _invalidate_all()
        await recompute_videos_for_names(db, raw_names)
    return {"ok": removed}


@router.post("/adopt")
async def adopt_aliases(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """批量采纳：body.items = [{raw_name, system_name}, ...]。"""
    items = body.get("items") or []
    adopted = 0
    raw_names: list[str] = []
    for item in items:
        raw_name = str(item.get("raw_name") or "").strip()
        system_name = str(item.get("system_name") or "").strip()
        if not raw_name or not system_name:
            continue
        await upsert_alias(db, raw_name, system_name)
        raw_names.append(raw_name)
        adopted += 1
    if adopted:
        await db.commit()
        _invalidate_all()
        await recompute_videos_for_names(db, raw_names)
    logger.info("category_aliases_adopted count=%d", adopted)
    return {"ok": True, "adopted": adopted}
