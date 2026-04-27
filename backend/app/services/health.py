"""站点连通性 probe（硬契约）。

GET <base_url>?ac=list&pg=1，校验返回 JSON 含 list 键并测延时；
失败原因尽量明确，供 Settings 页直接展示。
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.services.source_client import SourceClient, SourceProtocolError


@dataclass
class ProbeResult:
    ok: bool
    latency_ms: int | None
    error: str | None


async def probe(site_id: int, base_url: str, name: str = "", timeout: float = 5.0) -> ProbeResult:
    async with SourceClient(site_id=site_id, base_url=base_url, name=name, timeout=timeout) as client:
        started = time.perf_counter()
        items = None
        try:
            items = await client.list(pg=1)
        except httpx.TimeoutException as exc:
            return ProbeResult(ok=False, latency_ms=None, error=f"超时：{exc!s}")
        except httpx.HTTPError as exc:
            return ProbeResult(ok=False, latency_ms=None, error=f"网络错误：{exc!s}")
        except SourceProtocolError as exc:
            latency = int((time.perf_counter() - started) * 1000)
            return ProbeResult(ok=False, latency_ms=latency, error=str(exc))
        except Exception as exc:
            return ProbeResult(ok=False, latency_ms=None, error=f"未知错误：{exc!s}")
        latency = int((time.perf_counter() - started) * 1000)
        if not items:
            return ProbeResult(ok=True, latency_ms=latency, error="list 为空，但响应合规")
        return ProbeResult(ok=True, latency_ms=latency, error=None)
