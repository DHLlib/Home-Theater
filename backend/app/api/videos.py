import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site
from app.schemas import (
    AggregatedListResponse,
    AggregatedVideo,
    DetailRequest,
    DetailResponse,
    Episode,
    FailedSource,
)
from app.services.aggregator import aggregate_lists
from app.services.parser import parse_episodes
from app.services.source_client import SourceClient

router = APIRouter(prefix="/videos", tags=["videos"])


def _resolve_remote_categories(site: Site, category: str | None) -> list[str | int]:
    """把统一分类名转回该站点的 remote_id 列表；找不到返回空列表。"""
    if not category:
        return []
    results = []
    for c in (site.categories or []):
        if c.get("name") == category:
            rid = c.get("remote_id")
            if rid is not None:
                results.append(rid)
    return results


async def _fetch_site(site: Site, t=None, pg=None, h=None, wd=None):
    client = SourceClient(site_id=site.id, base_url=site.base_url, name=site.name)
    try:
        items = await client.list(t=t, pg=pg, h=h, wd=wd)
        return items, None
    except Exception as exc:
        return None, FailedSource(
            site_id=site.id,
            site_name=site.name,
            error=str(exc),
        )


@router.get("")
async def list_videos(
    t: int | str | None = None,
    pg: int | None = 1,
    h: int | None = None,
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Site).where(Site.enabled == True).order_by(Site.sort)
    )
    sites = result.scalars().all()

    tasks = []
    for site in sites:
        if category:
            remote_cats = _resolve_remote_categories(site, category)
            if not remote_cats:
                continue
            for remote_cat in remote_cats:
                tasks.append(_fetch_site(site, t=remote_cat, pg=pg, h=h))
        else:
            tasks.append(_fetch_site(site, t=t, pg=pg, h=h))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    per_source = []
    failed_sources = []
    for raw in results:
        if isinstance(raw, Exception):
            continue
        items, error = raw
        if error:
            failed_sources.append(error.model_dump())
        if items:
            per_source.append(items)

    if not per_source and failed_sources:
        raise HTTPException(status_code=502, detail="all sources failed")

    aggregated = aggregate_lists(per_source)
    return AggregatedListResponse(
        items=[AggregatedVideo(**item) for item in aggregated],
        failed_sources=failed_sources,
    )


@router.get("/search")
async def search_videos(
    wd: str,
    pg: int | None = 1,
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Site).where(Site.enabled == True).order_by(Site.sort)
    )
    sites = result.scalars().all()

    tasks = []
    for site in sites:
        if category:
            remote_cats = _resolve_remote_categories(site, category)
            if not remote_cats:
                continue
            for remote_cat in remote_cats:
                tasks.append(_fetch_site(site, wd=wd, pg=pg, t=remote_cat))
        else:
            tasks.append(_fetch_site(site, wd=wd, pg=pg))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    per_source = []
    failed_sources = []
    for raw in results:
        if isinstance(raw, Exception):
            continue
        items, error = raw
        if error:
            failed_sources.append(error.model_dump())
        if items:
            per_source.append(items)

    if not per_source and failed_sources:
        raise HTTPException(status_code=502, detail="all sources failed")

    aggregated = aggregate_lists(per_source)
    return AggregatedListResponse(
        items=[AggregatedVideo(**item) for item in aggregated],
        failed_sources=failed_sources,
    )


@router.post("/detail")
async def video_detail(req: DetailRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Site).where(Site.id.in_([s.site_id for s in req.sources]))
    )
    sites = {s.id: s for s in result.scalars().all()}

    async def fetch_one(source_ref):
        site = sites.get(source_ref.site_id)
        if not site:
            return None, FailedSource(
                site_id=source_ref.site_id,
                site_name=None,
                error="site not found",
            )
        client = SourceClient(
            site_id=site.id, base_url=site.base_url, name=site.name
        )
        try:
            items = await client.videolist(ids=[source_ref.original_id])
            if not items:
                return None, FailedSource(
                    site_id=site.id,
                    site_name=site.name,
                    error="empty detail response",
                )
            item = items[0]
            play_raw = item.get("play_url_raw", "")
            episodes = []
            if play_raw:
                try:
                    episodes = parse_episodes(play_raw)
                except ValueError as exc:
                    return None, FailedSource(
                        site_id=site.id,
                        site_name=site.name,
                        error=f"parse error: {exc}",
                    )
            return {
                "site_id": site.id,
                "original_id": source_ref.original_id,
                "title": item.get("title", ""),
                "year": item.get("year"),
                "poster_url": item.get("poster_url"),
                "intro": item.get("intro"),
                "area": item.get("area"),
                "actors": item.get("actors"),
                "director": item.get("director"),
                "episodes": [
                    {"ep_name": e.ep_name, "url": e.url, "suffix": e.suffix, "index": e.index}
                    for e in episodes
                ],
            }, None
        except Exception as exc:
            return None, FailedSource(
                site_id=site.id,
                site_name=site.name,
                error=str(exc),
            )

    tasks = [fetch_one(s) for s in req.sources]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    sources = []
    failed_sources = []
    for raw in results:
        if isinstance(raw, Exception):
            continue
        data, error = raw
        if error:
            failed_sources.append(error.model_dump())
        if data:
            sources.append(data)

    if not sources and failed_sources:
        raise HTTPException(status_code=502, detail="all sources failed")

    return DetailResponse(
        title=req.title,
        year=req.year,
        sources=sources,
    )
