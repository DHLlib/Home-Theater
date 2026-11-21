"""当前视频的按需媒体分析：全局串行、小批量、缓存优先、可取消。"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import (
    MEDIA_ANALYSIS_MAX_SOURCES,
    MEDIA_METADATA_FAILURE_TTL_SECONDS,
    MEDIA_METADATA_TTL_SECONDS,
)
from app.models import Site, SourceMediaInfo, VideoCache, _utcnow
from app.services.media_metadata import (
    MediaMetadata,
    probe_media_metadata,
    stream_url_hash,
    upsert_media_metadata,
)
from app.services.parser import parse_episodes
from app.services.resolver import resolve_share_page
from app.services.stream_accel import browser_headers


@dataclass(frozen=True)
class MediaAnalysisOutcome:
    processed: int = 0
    probed: int = 0
    skipped: int = 0
    running: bool = False


_analysis_lock = asyncio.Lock()


async def _fresh_row(
    db: AsyncSession,
    site_id: int,
    original_id: str,
    episode_index: int,
    url: str | None,
) -> SourceMediaInfo | None:
    row = await db.get(SourceMediaInfo, (site_id, original_id, episode_index))
    if row is None:
        return None
    ttl = (
        MEDIA_METADATA_TTL_SECONDS
        if row.probe_ok
        else MEDIA_METADATA_FAILURE_TTL_SECONDS
    )
    if row.checked_at < _utcnow() - timedelta(seconds=ttl):
        return None
    if url is not None and row.url_hash != stream_url_hash(url):
        return None
    return row


async def analyze_candidates(
    db: AsyncSession,
    candidates: list[tuple[int, str]],
    should_continue: Callable[[], Awaitable[bool]] | None = None,
) -> MediaAnalysisOutcome:
    if _analysis_lock.locked():
        return MediaAnalysisOutcome(running=True)

    async with _analysis_lock:
        processed = 0
        probed = 0
        skipped = 0
        for site_id, original_id in candidates[:MEDIA_ANALYSIS_MAX_SOURCES]:
            if should_continue is not None and not await should_continue():
                break
            processed += 1
            site = await db.get(Site, site_id)
            cache = (
                await db.execute(
                    select(VideoCache).where(
                        VideoCache.site_id == site_id,
                        VideoCache.original_id == original_id,
                    )
                )
            ).scalar_one_or_none()
            if site is None or cache is None:
                continue
            try:
                episodes = parse_episodes(cache.play_url_raw or "")
            except ValueError:
                episodes = []
            if not episodes:
                continue
            episode = episodes[0]

            if episode.suffix.lower() in {"feifan", "dytt", "360zy"}:
                if await _fresh_row(db, site_id, original_id, 0, None) is not None:
                    skipped += 1
                    continue
                try:
                    resolved = await resolve_share_page(episode.url)
                except Exception:
                    resolved = None
                if resolved:
                    episode = replace(episode, url=resolved, suffix="ffm3u8")

            if await _fresh_row(db, site_id, original_id, 0, episode.url) is not None:
                skipped += 1
                continue

            headers = browser_headers(site.base_url)
            started = time.monotonic()
            try:
                metadata = await probe_media_metadata(
                    episode.url, episode.suffix, headers
                )
            except Exception as exc:
                metadata = MediaMetadata(
                    method="request",
                    ok=False,
                    error=str(exc)[:500],
                )
            latency_ms = round((time.monotonic() - started) * 1000)
            await upsert_media_metadata(
                db,
                site_id,
                original_id,
                episode.index,
                episode.url,
                metadata,
                latency_ms,
            )
            await db.commit()
            probed += 1

        return MediaAnalysisOutcome(
            processed=processed,
            probed=probed,
            skipped=skipped,
        )
