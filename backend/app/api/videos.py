import asyncio
from dataclasses import replace
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, desc, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site, VideoCache
from app.schemas import (
    AggregatedListResponse,
    AggregatedVideo,
    DetailRequest,
    DetailResponse,
    FailedSource,
)
from app.services.aggregator import normalize_title
from app.services.parser import Episode as EpisodeDataclass, parse_episodes
from app.services.resolver import resolve_feifan
import app.services.scheduler as scheduler_module
from app.services.source_client import SourceClient

router = APIRouter(prefix="/videos", tags=["videos"])


# ------------------------------------------------------------------
# 分类解析（复用现有逻辑）
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# 集数后缀归一化（复用现有逻辑）
# ------------------------------------------------------------------

async def _normalize_episode_suffixes(episodes: list[dict]) -> list[dict]:
    """把 feifan 解析为真实 m3u8，360zy 统一为 ffm3u8，与 play.py 保持一致。"""
    if not episodes:
        return episodes

    has_feifan = any(ep.get("suffix") == "feifan" for ep in episodes)
    has_360zy = any(ep.get("suffix") == "360zy" for ep in episodes)

    if not has_feifan and not has_360zy:
        return episodes

    eps = [
        EpisodeDataclass(ep["ep_name"], ep["url"], ep["suffix"], ep["index"])
        for ep in episodes
    ]

    if has_feifan:
        feifan_indices = [i for i, e in enumerate(eps) if e.suffix == "feifan"]
        resolved = await asyncio.gather(
            *[resolve_feifan(eps[i].url) for i in feifan_indices],
            return_exceptions=True,
        )
        for idx, real_url in zip(feifan_indices, resolved):
            if isinstance(real_url, str) and real_url:
                eps[idx] = replace(eps[idx], url=real_url, suffix="ffm3u8")

    for i, e in enumerate(eps):
        if e.suffix == "360zy":
            eps[i] = replace(eps[i], suffix="ffm3u8")

    return [
        {"ep_name": e.ep_name, "url": e.url, "suffix": e.suffix, "index": e.index}
        for e in eps
    ]


# ------------------------------------------------------------------
# 列表 API（改为本地查询）
# ------------------------------------------------------------------

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
    """从本地 VideoCache 查询并按分类聚合去重。"""
    result = await db.execute(
        select(Site).where(Site.enabled == True).order_by(Site.sort)
    )
    sites = result.scalars().all()

    # 构建 (site_id, type_id) 过滤条件
    filters = []
    for site in sites:
        if category:
            remote_cats = _resolve_remote_categories(site, category)
            if not remote_cats:
                continue
            for rid in remote_cats:
                filters.append((site.id, int(rid) if isinstance(rid, str) and rid.isdigit() else rid))
        elif t is not None:
            filters.append((site.id, int(t) if isinstance(t, str) and t.isdigit() else t))
        else:
            # 不指定分类：该站点全部
            filters.append((site.id, None))

    if not filters:
        return AggregatedListResponse(items=[], failed_sources=[])

    # 组装 WHERE 条件
    conditions = []
    for site_id, type_id in filters:
        if type_id is not None:
            conditions.append(
                (VideoCache.site_id == site_id) & (VideoCache.type_id == type_id)
            )
        else:
            conditions.append(VideoCache.site_id == site_id)

    query = (
        select(VideoCache)
        .where(or_(*conditions))
        .order_by(desc(VideoCache.cached_at), desc(VideoCache.id))
    )
    result = await db.execute(query)
    records = result.scalars().all()

    # 聚合去重
    bucket: dict[tuple[str, int | None], dict] = {}
    latest_cache: dict[tuple[str, int | None], datetime] = {}
    for r in records:
        key = (normalize_title(r.title), r.year)
        if key not in bucket:
            bucket[key] = {
                "title": r.title,
                "year": r.year,
                "poster_url": r.poster_url,
                "sources": [],
            }
            latest_cache[key] = r.cached_at or datetime.min
        else:
            if r.cached_at and r.cached_at > latest_cache[key]:
                latest_cache[key] = r.cached_at
        source_ref = {
            "site_id": r.site_id,
            "original_id": r.original_id,
            "type": r.type_name,
            "remarks": r.remarks,
            "updated_at": r.source_updated_at,
        }
        bucket[key]["sources"].append(source_ref)

    # 按最新缓存时间倒序排列，保证每次刷新顺序一致
    aggregated = sorted(
        bucket.values(),
        key=lambda item: latest_cache.get(
            (normalize_title(item["title"]), item["year"]), datetime.min
        ),
        reverse=True,
    )

    # 分页
    page = pg or 1
    per_page = 20
    start = (page - 1) * per_page
    end = start + per_page
    page_items = aggregated[start:end]

    if mode == "source":
        # source 模式：平铺展示，不聚合
        raw_items = []
        for r in records[start:end]:
            raw_items.append({
                "title": r.title,
                "year": r.year,
                "poster_url": r.poster_url,
                "sources": [{
                    "site_id": r.site_id,
                    "original_id": r.original_id,
                    "type": r.type_name,
                    "remarks": r.remarks,
                    "updated_at": r.source_updated_at,
                }],
            })
        return AggregatedListResponse(
            items=[AggregatedVideo(**item) for item in raw_items],
            failed_sources=[],
        )

    return AggregatedListResponse(
        items=[AggregatedVideo(**item) for item in page_items],
        failed_sources=[],
    )


# ------------------------------------------------------------------
# 搜索 API（改为本地 LIKE）
# ------------------------------------------------------------------

@router.get("/search")
async def search_videos(
    wd: str,
    pg: int | None = 1,
    category: str | None = None,
    mode: str = "aggregated",
    db: AsyncSession = Depends(get_db),
):
    """本地 VideoCache LIKE 搜索。"""
    if not wd or not wd.strip():
        raise HTTPException(status_code=400, detail="搜索词不能为空")

    result = await db.execute(
        select(Site).where(Site.enabled == True).order_by(Site.sort)
    )
    sites = result.scalars().all()

    # 分类过滤（同 list_videos）
    filters = []
    for site in sites:
        if category:
            remote_cats = _resolve_remote_categories(site, category)
            if not remote_cats:
                continue
            for rid in remote_cats:
                filters.append((site.id, int(rid) if isinstance(rid, str) and rid.isdigit() else rid))
        else:
            filters.append((site.id, None))

    if not filters:
        return AggregatedListResponse(items=[], failed_sources=[])

    conditions = []
    for site_id, type_id in filters:
        if type_id is not None:
            conditions.append(
                (VideoCache.site_id == site_id) & (VideoCache.type_id == type_id)
            )
        else:
            conditions.append(VideoCache.site_id == site_id)

    query = (
        select(VideoCache)
        .where(
            or_(*conditions),
            VideoCache.title.contains(wd.strip()),
        )
        .order_by(desc(VideoCache.cached_at), desc(VideoCache.id))
    )
    result = await db.execute(query)
    records = result.scalars().all()

    # 聚合去重
    bucket: dict[tuple[str, int | None], dict] = {}
    latest_cache: dict[tuple[str, int | None], datetime] = {}
    for r in records:
        key = (normalize_title(r.title), r.year)
        if key not in bucket:
            bucket[key] = {
                "title": r.title,
                "year": r.year,
                "poster_url": r.poster_url,
                "sources": [],
            }
            latest_cache[key] = r.cached_at or datetime.min
        else:
            if r.cached_at and r.cached_at > latest_cache[key]:
                latest_cache[key] = r.cached_at
        source_ref = {
            "site_id": r.site_id,
            "original_id": r.original_id,
            "type": r.type_name,
            "remarks": r.remarks,
            "updated_at": r.source_updated_at,
        }
        bucket[key]["sources"].append(source_ref)

    # 按最新缓存时间倒序排列
    aggregated = sorted(
        bucket.values(),
        key=lambda item: latest_cache.get(
            (normalize_title(item["title"]), item["year"]), datetime.min
        ),
        reverse=True,
    )

    page = pg or 1
    per_page = 20
    start = (page - 1) * per_page
    end = start + per_page
    page_items = aggregated[start:end]

    if mode == "source":
        raw_items = []
        for r in records[start:end]:
            raw_items.append({
                "title": r.title,
                "year": r.year,
                "poster_url": r.poster_url,
                "sources": [{
                    "site_id": r.site_id,
                    "original_id": r.original_id,
                    "type": r.type_name,
                    "remarks": r.remarks,
                    "updated_at": r.source_updated_at,
                }],
            })
        return AggregatedListResponse(
            items=[AggregatedVideo(**item) for item in raw_items],
            failed_sources=[],
        )

    return AggregatedListResponse(
        items=[AggregatedVideo(**item) for item in page_items],
        failed_sources=[],
    )


# ------------------------------------------------------------------
# 详情 API（优先读缓存，未命中再实时请求）
# ------------------------------------------------------------------

@router.post("/detail")
async def video_detail(req: DetailRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Site).where(Site.id.in_([s.site_id for s in req.sources]))
    )
    sites = {s.id: s for s in result.scalars().all()}

    # 缓存过期时间：7 天
    CACHE_TTL_DAYS = 7
    expire_threshold = datetime.utcnow() - timedelta(days=CACHE_TTL_DAYS)

    async def fetch_one(source_ref):
        site = sites.get(source_ref.site_id)
        if not site:
            return None, None, FailedSource(
                site_id=source_ref.site_id,
                site_name=None,
                error="site not found",
            )

        # 1. 查缓存
        cached_result = await db.execute(
            select(VideoCache).where(
                VideoCache.site_id == source_ref.site_id,
                VideoCache.original_id == source_ref.original_id,
            )
        )
        cached = cached_result.scalar_one_or_none()

        # 缓存有效条件：有 play_url_raw 且未过期
        cache_valid = (
            cached
            and cached.play_url_raw
            and cached.cached_at
            and cached.cached_at > expire_threshold
        )

        if cache_valid:
            episodes = []
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

        # 2. 缓存未命中或过期，实时请求
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
                    "has_detail": True,
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
            if data.get("episodes"):
                data["episodes"] = await _normalize_episode_suffixes(data["episodes"])
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
                "has_detail": True,
            },
        )
        await db.execute(stmt)
    if cache_entries:
        await db.commit()

    if not sources and failed_sources:
        raise HTTPException(status_code=502, detail="all sources failed")

    return DetailResponse(
        title=req.title,
        year=req.year,
        sources=sources,
    )


# ------------------------------------------------------------------
# 刮削状态 API
# ------------------------------------------------------------------

@router.get("/crawler/status")
async def crawler_status():
    """返回刮削器当前状态。"""
    if scheduler_module.crawler is None:
        return {"running": False, "sites": {}}
    return scheduler_module.crawler.get_status()


# ------------------------------------------------------------------
# 手动触发增量更新 API
# ------------------------------------------------------------------

@router.post("/crawler/incremental/{site_id}")
async def trigger_incremental(site_id: int):
    """手动触发指定站点的增量更新。"""
    if scheduler_module.crawler is None:
        raise HTTPException(status_code=503, detail="刮削器未启动")
    asyncio.create_task(scheduler_module.crawler.run_incremental(site_id))
    return {"message": f"站点 {site_id} 增量更新已启动"}


# ------------------------------------------------------------------
# 清理缓存 API（保留）
# ------------------------------------------------------------------

@router.delete("/cache")
async def clear_video_cache(db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(VideoCache))
    await db.commit()
    return {"deleted": result.rowcount}
