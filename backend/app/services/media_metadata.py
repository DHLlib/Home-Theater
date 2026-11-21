"""按需获取当前视频的媒体参数；不在爬虫中主动采样视频分片。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import shutil
from dataclasses import dataclass
from urllib.parse import urljoin

from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import MEDIA_ANALYSIS_TIMEOUT_SECONDS
from app.models import SourceMediaInfo, _utcnow
from app.services.parser import is_hls_suffix
from app.services.stream_accel import (
    cache_playlist_text,
    fetch_text,
    get_cached_playlist_text,
)

logger = logging.getLogger(__name__)

_ATTRIBUTE_RE = re.compile(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)')


@dataclass(frozen=True)
class MediaMetadata:
    width: int | None = None
    height: int | None = None
    video_bitrate: int | None = None
    codec: str | None = None
    evidence: str = "unknown"
    method: str = "unknown"
    variant_url: str | None = None
    ok: bool = True
    error: str | None = None


def _int_attribute(attributes: dict[str, str], key: str) -> int | None:
    try:
        return int(attributes[key])
    except (KeyError, TypeError, ValueError):
        return None


def _codec_name(raw: str | None) -> str | None:
    if not raw:
        return None
    first = raw.split(",", 1)[0].strip().strip('"')
    lowered = first.lower()
    if lowered.startswith(("avc1", "avc3")):
        return "H.264"
    if lowered.startswith(("hvc1", "hev1")):
        return "H.265"
    if lowered.startswith("av01"):
        return "AV1"
    if lowered.startswith("vp09"):
        return "VP9"
    return first or None


def parse_hls_master(text: str, playlist_url: str) -> MediaMetadata | None:
    """只读取主播放列表；media playlist 返回 None，不下载分片。"""
    candidates: list[MediaMetadata] = []
    lines = text.splitlines()
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line.startswith("#EXT-X-STREAM-INF:"):
            continue
        attributes = {
            match.group(1): match.group(2).removeprefix('"').removesuffix('"')
            for match in _ATTRIBUTE_RE.finditer(line.split(":", 1)[1])
        }
        variant_url = None
        for next_line in lines[index + 1 :]:
            candidate = next_line.strip()
            if not candidate:
                continue
            if not candidate.startswith("#"):
                variant_url = urljoin(playlist_url, candidate)
            break
        width = None
        height = None
        resolution = attributes.get("RESOLUTION")
        if resolution and "x" in resolution:
            width_raw, height_raw = resolution.lower().split("x", 1)
            try:
                width = int(width_raw)
                height = int(height_raw)
            except ValueError:
                width = None
                height = None
        candidates.append(
            MediaMetadata(
                width=width,
                height=height,
                video_bitrate=(
                    _int_attribute(attributes, "AVERAGE-BANDWIDTH")
                    or _int_attribute(attributes, "BANDWIDTH")
                ),
                codec=_codec_name(attributes.get("CODECS")),
                evidence="declared",
                method="hls_master",
                variant_url=variant_url,
            )
        )
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda item: (
            item.height or 0,
            item.width or 0,
            item.video_bitrate or 0,
        ),
    )


def stream_url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


async def _probe_with_ffprobe(
    url: str, headers: dict[str, str]
) -> MediaMetadata:
    executable = shutil.which("ffprobe")
    if executable is None:
        return MediaMetadata(
            ok=False,
            error="未安装 ffprobe，将在播放时确认实际分辨率",
        )

    command = [
        executable,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,bit_rate",
        "-of",
        "json",
        "-probesize",
        "1000000",
        "-analyzeduration",
        "1000000",
    ]
    if headers:
        command.extend(
            ["-headers", "".join(f"{key}: {value}\r\n" for key, value in headers.items())]
        )
    command.append(url)
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=MEDIA_ANALYSIS_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return MediaMetadata(ok=False, error="媒体信息读取超时")
    if process.returncode != 0:
        return MediaMetadata(
            ok=False,
            error=stderr.decode("utf-8", errors="replace").strip()[:500]
            or "媒体信息读取失败",
        )
    try:
        payload = json.loads(stdout)
        stream = payload["streams"][0]
        width = int(stream["width"])
        height = int(stream["height"])
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return MediaMetadata(ok=False, error="未找到可识别的视频流")
    bitrate = None
    try:
        bitrate = int(stream.get("bit_rate")) if stream.get("bit_rate") else None
    except (TypeError, ValueError):
        bitrate = None
    return MediaMetadata(
        width=width,
        height=height,
        video_bitrate=bitrate,
        codec=stream.get("codec_name"),
        evidence="probed",
        method="ffprobe",
    )


async def probe_media_metadata(
    url: str, suffix: str, headers: dict[str, str]
) -> MediaMetadata:
    if is_hls_suffix(suffix) or ".m3u8" in url.lower():
        text = get_cached_playlist_text(url)
        if text is None:
            text = await fetch_text(
                url, headers, timeout=MEDIA_ANALYSIS_TIMEOUT_SECONDS
            )
            cache_playlist_text(url, text)
        parsed = parse_hls_master(text, url)
        if parsed is not None:
            return parsed
        return MediaMetadata(
            method="hls_media",
            error="播放列表未声明分辨率，将在播放时确认",
        )
    return await _probe_with_ffprobe(url, headers)


def _media_values(
    site_id: int,
    original_id: str,
    episode_index: int,
    url: str,
    metadata: MediaMetadata,
    latency_ms: int | None,
) -> dict:
    return {
        "site_id": site_id,
        "original_id": original_id,
        "episode_index": episode_index,
        "url_hash": stream_url_hash(url),
        "width": metadata.width,
        "height": metadata.height,
        "video_bitrate": metadata.video_bitrate,
        "codec": metadata.codec,
        "evidence": metadata.evidence,
        "method": metadata.method,
        "probe_ok": metadata.ok,
        "latency_ms": latency_ms,
        "error": metadata.error[:500] if metadata.error else None,
        "checked_at": _utcnow(),
    }


async def upsert_media_metadata_many(
    db: AsyncSession,
    entries: list[tuple[int, str, int, str, MediaMetadata, int | None]],
) -> None:
    if not entries:
        return
    values_by_key = {
        (entry[0], entry[1], entry[2]): _media_values(*entry)
        for entry in entries
    }
    values = list(values_by_key.values())
    stmt = pg_insert(SourceMediaInfo).values(values)
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id", "episode_index"],
            set_={
                key: getattr(stmt.excluded, key)
                for key in values[0]
                if key not in {"site_id", "original_id", "episode_index"}
            },
        )
    )


async def upsert_media_metadata(
    db: AsyncSession,
    site_id: int,
    original_id: str,
    episode_index: int,
    url: str,
    metadata: MediaMetadata,
    latency_ms: int | None = None,
) -> None:
    await upsert_media_metadata_many(
        db,
        [(site_id, original_id, episode_index, url, metadata, latency_ms)],
    )


async def load_media_metadata(
    db: AsyncSession, pairs: list[tuple[int, str]]
) -> dict[tuple[int, str], SourceMediaInfo]:
    if not pairs:
        return {}
    rows = (
        await db.execute(
            select(SourceMediaInfo).where(
                tuple_(
                    SourceMediaInfo.site_id, SourceMediaInfo.original_id
                ).in_(pairs),
                SourceMediaInfo.probe_ok.is_(True),
            )
        )
    ).scalars().all()
    selected: dict[tuple[int, str], SourceMediaInfo] = {}
    for row in rows:
        if row.height is None:
            continue
        key = (row.site_id, row.original_id)
        current = selected.get(key)
        rank = (
            row.height,
            row.width or 0,
            row.evidence == "actual",
            row.video_bitrate or 0,
            row.checked_at,
        )
        if current is None:
            selected[key] = row
            continue
        current_rank = (
            current.height or 0,
            current.width or 0,
            current.evidence == "actual",
            current.video_bitrate or 0,
            current.checked_at,
        )
        if rank > current_rank:
            selected[key] = row
    return selected


def describe_media(row: SourceMediaInfo) -> str | None:
    if row.height is None:
        return None
    resolution = (
        f"{row.width}×{row.height}" if row.width is not None else f"{row.height}p"
    )
    evidence = {
        "actual": "实测",
        "probed": "检测",
        "declared": "声明最高",
    }.get(row.evidence, "已记录")
    parts = [f"{evidence} {resolution}"]
    if row.video_bitrate:
        if row.video_bitrate >= 1_000_000:
            parts.append(f"{row.video_bitrate / 1_000_000:.1f} Mbps")
        else:
            parts.append(f"{row.video_bitrate // 1000} Kbps")
    if row.codec:
        parts.append(row.codec)
    return " · ".join(parts)
