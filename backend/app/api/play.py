import asyncio
import logging
import time
from dataclasses import replace
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import HTTP_TIMEOUT_RESOLVE
from app.db import get_db
from app.models import Site, VideoCache
from app.schemas import Episode
from app.services.parser import parse_episodes
from app.services.resolver import resolve_feifan
from app.services.source_client import SourceClient, _safe_int

router = APIRouter(prefix="/play", tags=["play"])
logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 7 * 24 * 3600


class PlaySourceOut(BaseModel):
    site_id: int
    site_name: str
    original_id: str
    episode_count: int
    suffix: str


class PlaySourcesResponse(BaseModel):
    sources: list[PlaySourceOut]


def _parse_source_info(play_url_raw: str | None) -> tuple[int, str]:
    """从 play_url_raw 解析集数和主要后缀。"""
    if not play_url_raw:
        return 0, "mp4"
    lines = [ln.strip() for ln in play_url_raw.splitlines() if ln.strip()]
    count = len(lines)
    suffix = "mp4"
    if lines:
        parts = lines[0].split("$")
        if len(parts) >= 3:
            suffix = parts[-1].strip()
    return count, suffix


@router.get("/sources", response_model=PlaySourcesResponse)
async def get_sources(
    title: str,
    year: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """查询指定视频（title + year）的所有可用播放源。"""
    stmt = (
        select(VideoCache, Site.name.label("site_name"))
        .join(Site, VideoCache.site_id == Site.id)
        .where(
            VideoCache.title == title,
            VideoCache.play_url_raw.isnot(None),
            VideoCache.play_url_raw != "",
        )
    )
    if year is not None:
        stmt = stmt.where(VideoCache.year == year)
    else:
        stmt = stmt.where(VideoCache.year.is_(None))

    result = await db.execute(stmt)
    rows = result.all()

    sources: list[PlaySourceOut] = []
    for row in rows:
        video_cache = row[0]
        site_name = row[1]
        episode_count, suffix = _parse_source_info(video_cache.play_url_raw)
        sources.append(
            PlaySourceOut(
                site_id=video_cache.site_id,
                site_name=site_name or str(video_cache.site_id),
                original_id=video_cache.original_id,
                episode_count=episode_count,
                suffix=suffix,
            )
        )

    logger.info("play_sources title=%s year=%s count=%d", title, year, len(sources))
    return PlaySourcesResponse(sources=sources)


@router.get("/episodes")
async def get_episodes(
    site_id: int,
    original_id: str,
    db: AsyncSession = Depends(get_db),
):
    start = time.monotonic()
    site = await db.get(Site, site_id)
    if not site:
        logger.warning("play_site_not_found site_id=%s", site_id)
        raise HTTPException(status_code=404, detail="Site not found")

    logger.info("play_get_episodes site=%s original_id=%s", site.name, original_id)

    # 优先读 VideoCache 缓存（7 天有效期），避免每次播放/下载都实时请求资源站
    expire_threshold = datetime.utcnow() - timedelta(seconds=CACHE_TTL_SECONDS)
    stmt = (
        select(VideoCache)
        .where(
            VideoCache.site_id == site_id,
            VideoCache.original_id == original_id,
            VideoCache.has_detail == True,
            VideoCache.play_url_raw.isnot(None),
            VideoCache.play_url_raw != "",
            VideoCache.cached_at > expire_threshold,
        )
    )
    result = await db.execute(stmt)
    cached = result.scalar_one_or_none()

    play_raw = ""
    if cached is not None:
        logger.info(
            "play_episodes_cache_hit site=%s original_id=%s cached_at=%s",
            site.name,
            original_id,
            cached.cached_at,
        )
        play_raw = cached.play_url_raw
    else:
        logger.info("play_episodes_cache_miss site=%s original_id=%s", site.name, original_id)
        async with SourceClient(
            site_id=site.id,
            base_url=site.base_url,
            name=site.name,
            timeout=HTTP_TIMEOUT_RESOLVE,
        ) as client:
            items = await client.videolist(ids=[original_id], op="play_resolve")
        if not items:
            logger.warning("play_videolist_empty site=%s original_id=%s", site.name, original_id)
            raise HTTPException(status_code=404, detail="Video not found")

        item = items[0]
        play_raw = item.get("play_url_raw", "")
        # 顺手把解析结果写回缓存，方便下次直接命中
        if play_raw:
            upsert_stmt = (
                select(VideoCache)
                .where(
                    VideoCache.site_id == site_id,
                    VideoCache.original_id == original_id,
                )
            )
            upsert_result = await db.execute(upsert_stmt)
            cache_row = upsert_result.scalar_one_or_none()
            if cache_row is None:
                cache_row = VideoCache(
                    site_id=site_id,
                    original_id=original_id,
                    title=item.get("title", ""),
                    year=_safe_int(item.get("year")),
                    poster_url=item.get("poster_url"),
                    intro=item.get("intro"),
                    area=item.get("area"),
                    actors=item.get("actors"),
                    director=item.get("director"),
                    play_url_raw=play_raw,
                    cached_at=datetime.utcnow(),
                    has_detail=True,
                )
                db.add(cache_row)
            else:
                cache_row.play_url_raw = play_raw
                cache_row.cached_at = datetime.utcnow()
                cache_row.has_detail = True
            await db.commit()

    if not play_raw:
        logger.info("play_no_play_url site=%s original_id=%s", site.name, original_id)
        return []

    try:
        episodes = parse_episodes(play_raw)
        logger.info("play_parsed site=%s episodes=%d", site.name, len(episodes))
    except ValueError as exc:
        logger.error("play_parse_error site=%s original_id=%s error=%s", site.name, original_id, exc)
        raise HTTPException(status_code=502, detail=f"parse error: {exc}")

    # 解析 feifan / dytt / 360zy 分享页获取真实 m3u8 地址
    share_suffixes = ("feifan", "dytt", "360zy")
    share_indices = [
        i for i, e in enumerate(episodes) if e.suffix in share_suffixes
    ]
    if share_indices:
        logger.info("play_resolve_share site=%s count=%d", site.name, len(share_indices))
        resolved = await asyncio.gather(
            *[resolve_feifan(episodes[i].url) for i in share_indices],
            return_exceptions=True,
        )
        for idx, real_url in zip(share_indices, resolved):
            if isinstance(real_url, str) and real_url:
                episodes[idx] = replace(
                    episodes[idx], url=real_url, suffix="ffm3u8"
                )
                logger.info("play_share_resolved site=%s ep=%s", site.name, episodes[idx].ep_name)
            elif isinstance(real_url, Exception):
                logger.warning("play_share_failed site=%s ep=%s error=%s", site.name, episodes[idx].ep_name, real_url)

    # 后缀归一化：所有 M3U8/Yun 类统一为 ffm3u8
    # 已知模式：xxxm3u8 / xxxyun / 360zy / ckplayer / mp4 / webm
    for i, e in enumerate(episodes):
        suffix_lower = e.suffix.lower()
        if suffix_lower.endswith("m3u8") or suffix_lower.endswith("yun"):
            episodes[i] = replace(e, suffix="ffm3u8")
        elif suffix_lower == "360zy":
            episodes[i] = replace(e, suffix="ffm3u8")

    elapsed = time.monotonic() - start
    logger.info("play_return site=%s episodes=%d elapsed=%.2fs", site.name, len(episodes), elapsed)
    return [
        Episode(ep_name=e.ep_name, url=e.url, suffix=e.suffix, index=e.index)
        for e in episodes
    ]
