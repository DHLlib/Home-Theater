import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site, VideoCache
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


async def _fetch_site(client: SourceClient, site: Site, t=None, pg=None, h=None, wd=None, by=None):
    try:
        items = await client.list(t=t, pg=pg, h=h, wd=wd, by=by)
        return items, None
    except Exception as exc:
        return None, FailedSource(
            site_id=site.id,
            site_name=site.name,
            error=str(exc),
        )


async def _trim_video_cache(db: AsyncSession, limit: int = 5000) -> None:
    """限制 VideoCache 行数，删除最老的记录。"""
    result = await db.execute(select(func.count()).select_from(VideoCache))
    count = result.scalar_one()
    if count > limit:
        subq = select(VideoCache.id).order_by(VideoCache.cached_at).limit(count - limit)
        await db.execute(delete(VideoCache).where(VideoCache.id.in_(subq)))
        await db.commit()


async def _write_list_cache(db: AsyncSession, per_source: list[list[dict]]) -> None:
    """将列表数据的基础字段写入 VideoCache（upsert，不覆盖已有完整字段）。"""
    for source_items in per_source:
        for item in source_items:
            stmt = insert(VideoCache).values(
                site_id=item.get("site_id"),
                original_id=item.get("original_id"),
                title=item.get("title", ""),
                year=item.get("year"),
                poster_url=item.get("poster_url"),
                cached_at=datetime.utcnow(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["site_id", "original_id"],
                set_={
                    "title": item.get("title", ""),
                    "year": item.get("year"),
                    "poster_url": item.get("poster_url"),
                    "cached_at": datetime.utcnow(),
                },
            )
            await db.execute(stmt)
    await db.commit()
    await _trim_video_cache(db)


@router.get("")
async def list_videos(
    t: int | str | None = None,
    pg: int | None = 1,
    h: int | None = None,
    by: str | None = None,
    category: str | None = None,
    mode: str = "aggregated",
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Site).where(Site.enabled == True).order_by(Site.sort)
    )
    sites = result.scalars().all()

    clients: dict[int, SourceClient] = {}
    try:
        for site in sites:
            clients[site.id] = SourceClient(
                site_id=site.id, base_url=site.base_url, name=site.name
            )

        tasks = []
        for site in sites:
            if category:
                remote_cats = _resolve_remote_categories(site, category)
                if not remote_cats:
                    continue
                for remote_cat in remote_cats:
                    tasks.append(_fetch_site(clients[site.id], site, t=remote_cat, pg=pg, h=h, by=by))
            else:
                tasks.append(_fetch_site(clients[site.id], site, t=t, pg=pg, h=h, by=by))

        results = await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        await asyncio.gather(*[c.aclose() for c in clients.values()], return_exceptions=True)

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

    # 写入 VideoCache 基础字段
    await _write_list_cache(db, per_source)

    if mode == "source":
        raw_items = []
        for source_items in per_source:
            for item in source_items:
                raw_items.append({
                    "title": item.get("title", ""),
                    "year": item.get("year"),
                    "poster_url": item.get("poster_url"),
                    "sources": [{
                        "site_id": item.get("site_id"),
                        "original_id": item.get("original_id"),
                        "type": item.get("type"),
                        "category": item.get("category"),
                        "remarks": item.get("remarks"),
                        "updated_at": item.get("updated_at"),
                    }],
                })
        return AggregatedListResponse(
            items=[AggregatedVideo(**item) for item in raw_items],
            failed_sources=failed_sources,
        )

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
    mode: str = "aggregated",
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Site).where(Site.enabled == True).order_by(Site.sort)
    )
    sites = result.scalars().all()

    clients: dict[int, SourceClient] = {}
    try:
        for site in sites:
            clients[site.id] = SourceClient(
                site_id=site.id, base_url=site.base_url, name=site.name
            )

        tasks = []
        for site in sites:
            if category:
                remote_cats = _resolve_remote_categories(site, category)
                if not remote_cats:
                    continue
                for remote_cat in remote_cats:
                    tasks.append(_fetch_site(clients[site.id], site, wd=wd, pg=pg, t=remote_cat))
            else:
                tasks.append(_fetch_site(clients[site.id], site, wd=wd, pg=pg))

        results = await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        await asyncio.gather(*[c.aclose() for c in clients.values()], return_exceptions=True)

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

    # 写入 VideoCache 基础字段
    await _write_list_cache(db, per_source)

    if mode == "source":
        raw_items = []
        for source_items in per_source:
            for item in source_items:
                raw_items.append({
                    "title": item.get("title", ""),
                    "year": item.get("year"),
                    "poster_url": item.get("poster_url"),
                    "sources": [{
                        "site_id": item.get("site_id"),
                        "original_id": item.get("original_id"),
                        "type": item.get("type"),
                        "category": item.get("category"),
                        "remarks": item.get("remarks"),
                        "updated_at": item.get("updated_at"),
                    }],
                })
        return AggregatedListResponse(
            items=[AggregatedVideo(**item) for item in raw_items],
            failed_sources=failed_sources,
        )

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
            return None, None, FailedSource(
                site_id=source_ref.site_id,
                site_name=None,
                error="site not found",
            )

        # 1. 先查缓存
        cached_result = await db.execute(
            select(VideoCache).where(
                VideoCache.site_id == source_ref.site_id,
                VideoCache.original_id == source_ref.original_id,
            )
        )
        cached = cached_result.scalar_one_or_none()
        if cached:
            episodes = []
            if cached.play_url_raw:
                try:
                    parsed = parse_episodes(cached.play_url_raw)
                    episodes = [
                        {"ep_name": e.ep_name, "url": e.url, "suffix": e.suffix, "index": e.index}
                        for e in parsed
                    ]
                except ValueError:
                    pass
            return {
                "site_id": cached.site_id,
                "site_name": site.name,
                "original_id": cached.original_id,
                "title": cached.title,
                "year": cached.year,
                "poster_url": cached.poster_url,
                "intro": cached.intro,
                "area": cached.area,
                "actors": cached.actors,
                "director": cached.director,
                "episodes": episodes,
            }, None, None

        # 2. 缓存未命中，从源站拉取
        async with SourceClient(
            site_id=site.id, base_url=site.base_url, name=site.name
        ) as client:
            try:
                items = await client.videolist(ids=[source_ref.original_id])
                if not items:
                    return None, None, FailedSource(
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
                        return None, None, FailedSource(
                            site_id=site.id,
                            site_name=site.name,
                            error=f"parse error: {exc}",
                        )

                data = {
                    "site_id": site.id,
                    "site_name": site.name,
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
                }
                cache_entry = {
                    "site_id": site.id,
                    "original_id": source_ref.original_id,
                    "title": item.get("title", ""),
                    "year": item.get("year"),
                    "poster_url": item.get("poster_url"),
                    "intro": item.get("intro"),
                    "area": item.get("area"),
                    "actors": item.get("actors"),
                    "director": item.get("director"),
                    "play_url_raw": play_raw,
                    "source_updated_at": item.get("updated_at"),
                    "cached_at": datetime.utcnow(),
                }
                return data, cache_entry, None
            except Exception as exc:
                return None, None, FailedSource(
                    site_id=site.id,
                    site_name=site.name,
                    error=str(exc),
                )

    tasks = [fetch_one(s) for s in req.sources]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    sources = []
    cache_entries = []
    failed_sources = []
    for raw in results:
        if isinstance(raw, Exception):
            continue
        data, cache_entry, error = raw
        if error:
            failed_sources.append(error.model_dump())
        if data:
            sources.append(data)
        if cache_entry:
            cache_entries.append(cache_entry)

    # 统一写入缓存（upsert）
    for entry in cache_entries:
        stmt = insert(VideoCache).values(**entry)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": entry["title"],
                "year": entry["year"],
                "poster_url": entry["poster_url"],
                "intro": entry["intro"],
                "area": entry["area"],
                "actors": entry["actors"],
                "director": entry["director"],
                "play_url_raw": entry["play_url_raw"],
                "source_updated_at": entry["source_updated_at"],
                "cached_at": entry["cached_at"],
            },
        )
        await db.execute(stmt)
    if cache_entries:
        await db.commit()
        await _trim_video_cache(db)

    if not sources and failed_sources:
        raise HTTPException(status_code=502, detail="all sources failed")

    return DetailResponse(
        title=req.title,
        year=req.year,
        sources=sources,
    )


@router.delete("/cache")
async def clear_video_cache(db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(VideoCache))
    await db.commit()
    return {"deleted": result.rowcount}
