"""分类设置：系统小类 ← 站点远程分类的手动挂载。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import site_not_found, validation_error
from app.models import Site
from app.services.category_links import (
    attach_affected_videos,
    attach_links,
    category_counts,
    category_summary,
    detach_links,
    list_remote_categories,
    refresh_site_remote_categories,
)

router = APIRouter(prefix="/category-settings", tags=["category-settings"])
logger = logging.getLogger(__name__)


class LinkItem(BaseModel):
    site_id: int
    remote_id: str = Field(min_length=1)
    system_category_id: int


class LinkBatch(BaseModel):
    items: list[LinkItem]


class DetachItem(BaseModel):
    site_id: int
    remote_id: str = Field(min_length=1)


class DetachBatch(BaseModel):
    items: list[DetachItem]


def _build_tree(rows: list[dict]) -> list[dict]:
    by_parent: dict[int | None, list[dict]] = {}
    for row in rows:
        by_parent.setdefault(row["parent_id"], []).append(row)

    def build(parent_id: int | None) -> list[dict]:
        return [
            {**row, "children": build(row["id"])}
            for row in by_parent.get(parent_id, [])
        ]

    return build(None)


def _invalidate_category_caches() -> None:
    from app.api.videos import invalidate_category_filter_cache

    invalidate_category_filter_cache()


@router.get("/overview")
async def category_overview(db: AsyncSession = Depends(get_db)):
    rows = await category_counts(db)
    return {
        "categories": _build_tree(rows),
        "summary": await category_summary(db),
    }


@router.get("/remotes")
async def category_remotes(db: AsyncSession = Depends(get_db)):
    return {"items": await list_remote_categories(db)}


@router.post("/links")
async def create_links(body: LinkBatch, db: AsyncSession = Depends(get_db)):
    try:
        touched = await attach_links(
            db, [item.model_dump() for item in body.items]
        )
    except ValueError as exc:
        raise validation_error(str(exc))
    if not touched:
        return {"ok": True, "linked": 0, "affected_videos": 0}
    await db.commit()
    affected = await attach_affected_videos(db, touched)
    await db.commit()
    _invalidate_category_caches()
    logger.info("category_links_linked count=%d videos=%d", len(touched), affected)
    return {"ok": True, "linked": len(touched), "affected_videos": affected}


@router.delete("/links")
async def remove_links(body: DetachBatch, db: AsyncSession = Depends(get_db)):
    touched = await detach_links(db, [item.model_dump() for item in body.items])
    if not touched:
        return {"ok": True, "unlinked": 0, "affected_videos": 0}
    await db.commit()
    affected = await attach_affected_videos(db, touched)
    await db.commit()
    _invalidate_category_caches()
    logger.info("category_links_unlinked count=%d videos=%d", len(touched), affected)
    return {"ok": True, "unlinked": len(touched), "affected_videos": affected}


@router.post("/refresh")
async def refresh_remote_categories(db: AsyncSession = Depends(get_db)):
    """重新拉取所有站点的远程分类快照。站点多时按顺序执行，失败不阻塞其他站。"""
    sites = (
        await db.execute(select(Site).order_by(Site.sort, Site.id))
    ).scalars().all()
    synced = 0
    errors: list[dict] = []
    added = updated = 0
    for site in sites:
        try:
            stats = await refresh_site_remote_categories(db, site)
            synced += 1
            added += stats["added"]
            updated += stats["updated"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("refresh_remote_categories site=%s failed: %s", site.id, exc)
            errors.append({"site_id": site.id, "site": site.name, "error": str(exc)})
    return {
        "ok": True,
        "sites": synced,
        "added": added,
        "updated": updated,
        "errors": errors,
    }


@router.post("/sites/{site_id}/refresh")
async def refresh_site_remote_categories_api(
    site_id: int, db: AsyncSession = Depends(get_db)
):
    site = await db.get(Site, site_id)
    if not site:
        raise site_not_found(site_id)
    try:
        stats = await refresh_site_remote_categories(db, site)
    except ValueError as exc:
        raise validation_error(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.warning("refresh_site_remote_categories site=%s failed: %s", site_id, exc)
        raise validation_error(f"拉取远程分类失败：{exc}")
    return {"ok": True, **stats}
