import logging

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site
from app.schemas import CategoryMapping, FailedSource, SiteCategoriesOut, SiteCategoriesUpdate, SiteCreate, SitePatch
from app.services.health import probe as health_probe
from app.services.source_client import SourceClient

router = APIRouter(prefix="/sites", tags=["sites"])
logger = logging.getLogger(__name__)


@router.get("")
async def list_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).order_by(Site.sort, Site.id))
    return result.scalars().all()


@router.post("")
async def create_site(site: SiteCreate, db: AsyncSession = Depends(get_db)):
    db_site = Site(**site.model_dump())
    db.add(db_site)
    await db.commit()
    await db.refresh(db_site)
    logger.info("site_created site_id=%d name=%s url=%s", db_site.id, site.name, site.base_url)
    return db_site


@router.patch("/{site_id}")
async def update_site(site_id: int, patch: SitePatch, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    for key, value in patch.model_dump(exclude_unset=True).items():
        setattr(db_site, key, value)
    await db.commit()
    await db.refresh(db_site)
    return db_site


@router.delete("/{site_id}")
async def delete_site(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.delete(db_site)
    await db.commit()
    logger.info("site_deleted site_id=%d name=%s", site_id, db_site.name)
    return {"ok": True}


@router.post("/{site_id}/probe")
async def probe_site(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    result = await health_probe(
        site_id=db_site.id,
        base_url=db_site.base_url,
        name=db_site.name,
    )
    logger.info("site_probe site_id=%d name=%s ok=%s", db_site.id, db_site.name, result.get("ok"))
    return result


@router.get("/{site_id}/categories")
async def get_site_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    cats = db_site.categories or []
    return SiteCategoriesOut(
        site_id=db_site.id,
        categories=[CategoryMapping(**c) for c in cats],
    )


@router.put("/{site_id}/categories")
async def update_site_categories(
    site_id: int,
    body: SiteCategoriesUpdate,
    db: AsyncSession = Depends(get_db),
):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    # AC-002 gap fix: server-side mutual exclusion validation
    seen: dict[str, str] = {}
    for c in body.categories:
        if c.remote_id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"remote_id '{c.remote_id}' 已分配到分类 '{seen[c.remote_id]}'",
            )
        seen[c.remote_id] = c.name

    db_site.categories = [c.model_dump() for c in body.categories]
    await db.commit()
    await db.refresh(db_site)
    return SiteCategoriesOut(
        site_id=db_site.id,
        categories=[CategoryMapping(**c) for c in (db_site.categories or [])],
    )


@router.post("/{site_id}/fetch-categories")
async def fetch_remote_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    """从资源站自动拉取分类列表（ac=list 不带 t 时通常返回 class 字段）。"""
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    async with SourceClient(
        site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
    ) as client:
        try:
            data = await client._get({"ac": "list"})
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))
    class_list = data.get("class", [])
    if not isinstance(class_list, list):
        raise HTTPException(status_code=502, detail="资源站未返回 class 分类列表")
    categories = []
    for raw in class_list:
        if isinstance(raw, dict):
            # 过滤父分类（type_pid=0），只保留可作为 t 参数查询的子分类
            type_pid = raw.get("type_pid")
            if type_pid == 0 or type_pid == "0":
                continue
            categories.append(
                CategoryMapping(
                    remote_id=str(raw.get("type_id") or raw.get("id") or ""),
                    name=str(raw.get("type_name") or raw.get("name") or ""),
                )
            )
    logger.info("site_fetch_categories site_id=%d name=%s categories=%d", db_site.id, db_site.name, len(categories))
    return SiteCategoriesOut(site_id=db_site.id, categories=categories)
