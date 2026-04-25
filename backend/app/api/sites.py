from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site
from app.schemas import CategoryMapping, FailedSource, SiteCategoriesOut, SiteCategoriesUpdate
from app.services.health import probe as health_probe
from app.services.source_client import SourceClient

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("")
async def list_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).order_by(Site.sort, Site.id))
    return result.scalars().all()


@router.post("")
async def create_site(site: dict = Body(...), db: AsyncSession = Depends(get_db)):
    db_site = Site(**site)
    db.add(db_site)
    await db.commit()
    await db.refresh(db_site)
    return db_site


@router.patch("/{site_id}")
async def update_site(site_id: int, patch: dict = Body(...), db: AsyncSession = Depends(get_db)):
    db_site = await db.get(Site, site_id)
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")
    for key, value in patch.items():
        if hasattr(db_site, key):
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
    client = SourceClient(
        site_id=db_site.id, base_url=db_site.base_url, name=db_site.name
    )
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
    return SiteCategoriesOut(site_id=db_site.id, categories=categories)
