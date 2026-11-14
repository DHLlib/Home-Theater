"""播放加速：m3u8 分片代理 + 多连接并行预取。

背景：第三方 CDN 按**单连接**限速（实测单连接 145–423KB/s，6 并发聚合
1.9–3.2MB/s）。hls.js 默认串行拉分片，单连接被限速时起播要十几秒。

做法：
- 播放走 /api/play/accel/m3u8，把 playlist 里的分片改写成
  /api/play/accel/segment，浏览器只连本机；
- 后端按「加速档位」（2/4/8/16 并发）拉取分片，并预取后续若干片；
- 分片按 URL 缓存在内存（默认 300MB / 10 分钟），二次播放直接命中；
- 请求统一带浏览器 UA + 站点 Referer，避免 WAF 403。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections import OrderedDict
from typing import NamedTuple
from urllib.parse import quote, urljoin

import httpx

from app.constants import DEFAULT_USER_AGENT

logger = logging.getLogger(__name__)

# 档位 → 并发数；文案与前端保持一致
ACCEL_LEVELS: dict[str, int] = {"1": 2, "2": 4, "3": 8, "4": 16}
ACCEL_LEVEL_LABELS = {"1": "一档", "2": "二档", "3": "三档", "4": "狂暴"}
DEFAULT_LEVEL = "2"

CACHE_MAX_BYTES = 300 * 1024 * 1024
CACHE_TTL_SECONDS = 600

_playlists: "OrderedDict[str, Playlist]" = OrderedDict()
_segments: "OrderedDict[str, Segment]" = OrderedDict()
_segment_bytes = 0
_inflight: dict[str, asyncio.Task] = {}
_signature = (0, "", "")  # (并发数, enabled, level)，变化时重建信号量
_semaphore: asyncio.Semaphore | None = None


class Playlist(NamedTuple):
    url: str
    site_id: int
    segments: list[str]
    fetched_at: float


class Segment(NamedTuple):
    content: bytes
    content_type: str
    fetched_at: float


def playlist_key(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def level_concurrency(level: str) -> int:
    return ACCEL_LEVELS.get(level, ACCEL_LEVELS[DEFAULT_LEVEL])


def _get_semaphore(concurrency: int) -> asyncio.Semaphore:
    global _semaphore, _signature
    if _semaphore is None or _signature[0] != concurrency:
        _semaphore = asyncio.Semaphore(concurrency)
        _signature = (concurrency, _signature[1], _signature[2])
    return _semaphore


def register_playlist(url: str, site_id: int, segments: list[str]) -> str:
    key = playlist_key(url)
    _playlists[key] = Playlist(url, site_id, segments, time.time())
    while len(_playlists) > 64:
        _playlists.popitem(last=False)
    return key


_playlist_text: "OrderedDict[str, tuple[str, float]]" = OrderedDict()


def cache_playlist_text(url: str, text: str) -> None:
    _playlist_text[url] = (text, time.time())
    while len(_playlist_text) > 64:
        _playlist_text.popitem(last=False)


def get_cached_playlist_text(url: str) -> str | None:
    item = _playlist_text.get(url)
    if item is None:
        return None
    text, ts = item
    if time.time() - ts > CACHE_TTL_SECONDS:
        _playlist_text.pop(url, None)
        return None
    _playlist_text.move_to_end(url)
    return text


async def prime_stream(
    url: str,
    site_id: int,
    headers: dict[str, str],
    concurrency: int,
    depth: int = 0,
) -> None:
    """进播放页时提前预热：拉 playlist、登记分片、预取前 2 片。

    与播放器初始化并行，冷启动能省掉 playlist 链路的 1–2 秒。
    只对 m3u8 生效；master playlist 会继续递归预热变体。
    """
    if depth > 2 or ".m3u8" not in url.lower():
        return
    if get_cached_playlist_text(url) is not None:
        return
    try:
        text = await fetch_text(url, headers)
    except Exception:  # noqa: BLE001
        logger.debug("预热 playlist 失败: %s", url, exc_info=True)
        return
    cache_playlist_text(url, text)
    key = register_playlist(url, site_id, [])
    rewritten, segments = rewrite_playlist(text, url, site_id, key)
    register_playlist(url, site_id, segments)
    playlist = get_playlist(key)
    if playlist is None:
        return
    if segments:
        prefetch_first_segments(playlist, headers, concurrency, count=2)
        return
    # master playlist：继续预热第一个变体
    for line in text.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#"):
            continue
        absolute = urljoin(url, raw)
        if ".m3u8" in absolute.lower():
            await prime_stream(absolute, site_id, headers, concurrency, depth + 1)
            return


def get_playlist(key: str) -> Playlist | None:
    playlist = _playlists.get(key)
    if playlist is None:
        return None
    if time.time() - playlist.fetched_at > CACHE_TTL_SECONDS:
        _playlists.pop(key, None)
        return None
    _playlists.move_to_end(key)
    return playlist


def _cache_get(url: str) -> Segment | None:
    global _segment_bytes
    seg = _segments.get(url)
    if seg is None:
        return None
    if time.time() - seg.fetched_at > CACHE_TTL_SECONDS:
        _segments.pop(url, None)
        _segment_bytes -= len(seg.content)
        return None
    _segments.move_to_end(url)
    return seg


def _cache_put(url: str, content: bytes, content_type: str) -> None:
    global _segment_bytes
    if url in _segments:
        _segment_bytes -= len(_segments[url].content)
    _segments[url] = Segment(content, content_type, time.time())
    _segment_bytes += len(content)
    while _segment_bytes > CACHE_MAX_BYTES and _segments:
        _, old = _segments.popitem(last=False)
        _segment_bytes -= len(old.content)


def browser_headers(referer: str | None) -> dict[str, str]:
    headers = {"User-Agent": DEFAULT_USER_AGENT, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    return headers


_client: httpx.AsyncClient | None = None


def _shared_client() -> httpx.AsyncClient:
    """复用一个连接池：每片新建 client 会重做 TCP+TLS 握手（实测每片多 0.5–1s）。"""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=64, max_keepalive_connections=32),
        )
    return _client


async def fetch_text(url: str, headers: dict[str, str], timeout: float = 15.0) -> str:
    client = _shared_client()
    resp = await client.get(url, headers=headers, timeout=timeout)
    if resp.status_code != 200:
        raise RuntimeError(f"upstream {resp.status_code}")
    return resp.text


async def _fetch_segment_once(
    url: str,
    headers: dict[str, str],
    concurrency: int,
    byte_range: str | None = None,
) -> tuple[bytes, str]:
    sem = _get_semaphore(concurrency)
    async with sem:
        client = _shared_client()
        req_headers = dict(headers)
        if byte_range:
            req_headers["Range"] = byte_range
        for attempt in (1, 2):
            try:
                resp = await client.get(url, headers=req_headers)
                if resp.status_code in (200, 206):
                    return resp.content, resp.headers.get("content-type", "video/mp2t")
                raise RuntimeError(f"upstream {resp.status_code}")
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(0.2)
    raise RuntimeError("unreachable")


def _start_fetch(
    url: str, headers: dict[str, str], concurrency: int
) -> asyncio.Task:
    """在途下载去重：同一分片只下一次，客户端请求和预取共享结果。"""

    async def run() -> tuple[bytes, str]:
        try:
            content, content_type = await _fetch_segment_once(
                url, headers, concurrency
            )
            _cache_put(url, content, content_type)
            return content, content_type
        finally:
            _inflight.pop(url, None)

    task = asyncio.create_task(run())
    _inflight[url] = task
    return task


async def get_segment(
    url: str,
    headers: dict[str, str],
    concurrency: int,
    byte_range: str | None = None,
) -> tuple[bytes, str]:
    if byte_range:
        return await _fetch_segment_once(url, headers, concurrency, byte_range)

    cached = _cache_get(url)
    if cached is not None:
        return cached.content, cached.content_type

    inflight = _inflight.get(url)
    if inflight is not None:
        try:
            return await inflight
        except Exception:  # noqa: BLE001
            pass

    return await _start_fetch(url, headers, concurrency)


async def _fetch_segment_chunked(
    url: str,
    headers: dict[str, str],
    concurrency: int,
    chunks: int = 4,
) -> tuple[bytes, str]:
    """大分片按 Range 切块并行拉：单连接被限速时，首片从 ~4s 降到 ~1s。"""
    probe = await _fetch_segment_once(url, headers, concurrency, "bytes=0-0")
    content_type = probe[1]
    # 上游不支持 Range（回 200 整片）就直接用探测结果
    if len(probe[0]) > 1024:
        return probe
    client = _shared_client()
    head = await client.get(url, headers={**headers, "Range": "bytes=0-0"})
    content_range = head.headers.get("content-range", "")
    total = 0
    if "/" in content_range:
        try:
            total = int(content_range.rsplit("/", 1)[1])
        except ValueError:
            total = 0
    if total <= 0 or head.status_code != 206:
        return await _fetch_segment_once(url, headers, concurrency)

    chunk_size = max(total // chunks, 1)
    ranges = []
    for index in range(chunks):
        start = index * chunk_size
        end = total - 1 if index == chunks - 1 else min(start + chunk_size, total) - 1
        if start > end:
            break
        ranges.append((index, start, end))

    results = await asyncio.gather(
        *(
            _fetch_segment_once(url, headers, concurrency, f"bytes={start}-{end}")
            for _, start, end in ranges
        ),
        return_exceptions=True,
    )
    parts: list[bytes] = []
    for item in results:
        if isinstance(item, Exception):
            # 任一分块失败就回退整片拉取，保证正确性
            return await _fetch_segment_once(url, headers, concurrency)
        parts.append(item[0])
    return b"".join(parts), content_type


def prefetch_first_segments(
    playlist: Playlist,
    headers: dict[str, str],
    concurrency: int,
    count: int = 2,
) -> None:
    """起播阶段用分块并行预取前几片：单连接被限速时首片 4s → 1~2s。"""
    for index in range(min(count, len(playlist.segments))):
        url = playlist.segments[index]
        if url in _segments or url in _inflight:
            continue

        async def run(target: str = url) -> None:
            try:
                content, content_type = await _fetch_segment_once(
                    target, headers, concurrency
                )
                _cache_put(target, content, content_type)
            except Exception:  # noqa: BLE001
                logger.debug("起播预取失败: %s", target, exc_info=True)
            finally:
                _inflight.pop(target, None)

        _inflight[url] = asyncio.create_task(run())


def prefetch_segments(
    playlist: Playlist,
    start_index: int,
    headers: dict[str, str],
    concurrency: int,
    include_start: bool = False,
    limit: int | None = None,
) -> None:
    """后台预取后续分片；已有缓存或在途的跳过。

    limit 控制这次最多排几个：起播时只预取前 2 片，避免和首片抢连接。
    """
    first = 0 if include_start else 1
    count = min(concurrency, limit) if limit is not None else concurrency
    for offset in range(first, count + first):
        idx = start_index + offset
        if idx >= len(playlist.segments):
            return
        url = playlist.segments[idx]
        if url in _segments or url in _inflight:
            continue
        _start_fetch(url, headers, concurrency)


def rewrite_playlist(
    text: str, playlist_url: str, site_id: int, key: str
) -> tuple[str, list[str]]:
    """把 playlist 里的 URL 改写成本机代理地址，返回 (新文本, 分片地址列表)。"""
    out: list[str] = []
    segments: list[str] = []
    for line in text.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#"):
            out.append(line)
            continue
        absolute = urljoin(playlist_url, raw)
        if ".m3u8" in absolute.lower():
            proxied = (
                f"/api/play/accel/m3u8?site_id={site_id}&url={quote(absolute, safe='')}"
            )
        else:
            index = len(segments)
            segments.append(absolute)
            proxied = f"/api/play/accel/segment?pl={key}&i={index}"
        out.append(proxied)
    return "\n".join(out) + "\n", segments
