"""分享页解析：从第三方分享页中提取真实媒体地址。"""
from __future__ import annotations

import asyncio
import re
import time
from urllib.parse import urljoin, urlparse

import httpx

from app.constants import DEFAULT_USER_AGENT, HTTP_TIMEOUT_RESOLVE

# 常见分享页嵌入真实地址的模式（按优先级尝试）
_SHARE_URL_PATTERNS = [
    re.compile(r'const\s+url\s*=\s*"([^"]+)"'),
    re.compile(r'var\s+url\s*=\s*"([^"]+)"'),
    re.compile(r'let\s+url\s*=\s*"([^"]+)"'),
    re.compile(r'"url"\s*:\s*"([^"]+)"'),
    re.compile(r'url\s*:\s*["\']([^"\']+)["\']'),
]

# 内存缓存：share_url -> (resolved_url, expire_at)
_SHARE_PAGE_CACHE: dict[str, tuple[str | None, float]] = {}
_SHARE_PAGE_CACHE_TTL_SECONDS = 3600  # 1 小时
_SHARE_PAGE_CACHE_LOCK = asyncio.Lock()


def _to_absolute_url(share_url: str, real_path: str) -> str:
    """把提取出的路径拼接为完整 URL。"""
    if real_path.startswith(("http://", "https://")):
        return real_path
    # 优先以 share_url 为 base 做 urljoin
    joined = urljoin(share_url, real_path)
    if joined != share_url:
        return joined
    # 兜底：取 share_url 的 scheme+netloc 拼接
    parsed = urlparse(share_url)
    return f"{parsed.scheme}://{parsed.netloc}{real_path}"


async def _do_resolve_share(c: httpx.AsyncClient, share_url: str, headers: dict[str, str] | None) -> str | None:
    request_headers = headers or {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": share_url,
    }
    try:
        resp = await c.get(share_url, headers=request_headers)
        resp.raise_for_status()
        text = resp.text
        for pattern in _SHARE_URL_PATTERNS:
            match = pattern.search(text)
            if match:
                real_path = match.group(1)
                return _to_absolute_url(share_url, real_path)
        return None
    except Exception:
        return None


async def resolve_share_page(
    share_url: str,
    client: httpx.AsyncClient | None = None,
    headers: dict | None = None,
) -> str | None:
    """
    访问视频分享页，按常见模式提取真实 m3u8/媒体地址。
    支持传入已有的 httpx.AsyncClient 以复用连接。
    解析结果带 TTL 内存缓存，避免对同一分享页重复请求。
    """
    now = time.monotonic()

    async with _SHARE_PAGE_CACHE_LOCK:
        cached = _SHARE_PAGE_CACHE.get(share_url)
        if cached is not None:
            resolved, expire_at = cached
            if expire_at > now:
                return resolved
            _SHARE_PAGE_CACHE.pop(share_url, None)

    resolved: str | None = None
    if client is not None:
        resolved = await _do_resolve_share(client, share_url, headers)
    else:
        try:
            async with httpx.AsyncClient(
                timeout=HTTP_TIMEOUT_RESOLVE, follow_redirects=True
            ) as c:
                resolved = await _do_resolve_share(c, share_url, headers)
        except Exception:
            resolved = None

    async with _SHARE_PAGE_CACHE_LOCK:
        if resolved is not None:
            _SHARE_PAGE_CACHE[share_url] = (resolved, now + _SHARE_PAGE_CACHE_TTL_SECONDS)
        # 缓存未命中但解析失败时，短暂缓存 None 避免高频重试（30 秒）
        else:
            _SHARE_PAGE_CACHE[share_url] = (None, now + 30)

    return resolved
