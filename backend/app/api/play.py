import asyncio
import logging
import time
from dataclasses import replace

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Site
from app.schemas import Episode
from app.services.parser import parse_episodes
from app.services.resolver import resolve_feifan
from app.services.source_client import SourceClient

router = APIRouter(prefix="/play", tags=["play"])
logger = logging.getLogger(__name__)


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
    async with SourceClient(
        site_id=site.id, base_url=site.base_url, name=site.name
    ) as client:
        items = await client.videolist(ids=[original_id], op="play_resolve")
    if not items:
        logger.warning("play_videolist_empty site=%s original_id=%s", site.name, original_id)
        raise HTTPException(status_code=404, detail="Video not found")

    item = items[0]
    play_raw = item.get("play_url_raw", "")
    if not play_raw:
        logger.info("play_no_play_url site=%s original_id=%s", site.name, original_id)
        return []

    try:
        episodes = parse_episodes(play_raw)
        logger.info("play_parsed site=%s episodes=%d", site.name, len(episodes))
    except ValueError as exc:
        logger.error("play_parse_error site=%s original_id=%s error=%s", site.name, original_id, exc)
        raise HTTPException(status_code=502, detail=f"parse error: {exc}")

    # 解析 feifan / dytt 分享页获取真实 m3u8 地址
    share_suffixes = ("feifan", "dytt")
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
