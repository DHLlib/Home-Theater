import asyncio
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


@router.get("/episodes")
async def get_episodes(
    site_id: int,
    original_id: str,
    db: AsyncSession = Depends(get_db),
):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    client = SourceClient(
        site_id=site.id, base_url=site.base_url, name=site.name
    )
    items = await client.videolist(ids=[original_id])
    if not items:
        raise HTTPException(status_code=404, detail="Video not found")

    item = items[0]
    play_raw = item.get("play_url_raw", "")
    if not play_raw:
        return []

    try:
        episodes = parse_episodes(play_raw)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"parse error: {exc}")

    # 解析 feifan 分享页获取真实 m3u8 地址
    feifan_indices = [
        i for i, e in enumerate(episodes) if e.suffix == "feifan"
    ]
    if feifan_indices:
        resolved = await asyncio.gather(
            *[resolve_feifan(episodes[i].url) for i in feifan_indices],
            return_exceptions=True,
        )
        for idx, real_url in zip(feifan_indices, resolved):
            if isinstance(real_url, str) and real_url:
                episodes[idx] = replace(
                    episodes[idx], url=real_url, suffix="ffm3u8"
                )

    # 统一 360zy 后缀为 ffm3u8，便于前端识别为 m3u8 格式
    for i, e in enumerate(episodes):
        if e.suffix == "360zy":
            episodes[i] = replace(e, suffix="ffm3u8")

    return [
        Episode(ep_name=e.ep_name, url=e.url, suffix=e.suffix, index=e.index)
        for e in episodes
    ]
