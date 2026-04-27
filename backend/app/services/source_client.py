"""资源站访问唯一出口（硬契约）。

参数协议（不可改）：
    ac=list|videolist
    t=<分类id>
    pg=<页数>
    wd=<关键字>
    h=<小时数>
    ids=<逗号分隔>

调用方禁止自拼 URL；任何路由都必须经过本模块。
"""
from __future__ import annotations

from typing import Any

import asyncio

import httpx


class SourceProtocolError(Exception):
    """资源站返回不符合 ac=list / videolist 协议时抛出。"""


class SourceClient:
    def __init__(self, site_id: int, base_url: str, name: str = "", timeout: float = 8.0):
        self.site_id = site_id
        self.base_url = base_url
        self.name = name or str(site_id)
        self.timeout = timeout

    @staticmethod
    def _build_params(
        ac: str,
        *,
        t: int | str | None = None,
        pg: int | None = None,
        wd: str | None = None,
        h: int | None = None,
        by: str | None = None,
        ids: list[str | int] | None = None,
    ) -> dict[str, str]:
        params: dict[str, str] = {"ac": ac}
        if t is not None:
            params["t"] = str(t)
        if pg is not None:
            params["pg"] = str(pg)
        if wd is not None:
            params["wd"] = str(wd)
        if h is not None:
            params["h"] = str(h)
        if by is not None:
            params["by"] = by
        if ids:
            params["ids"] = ",".join(str(i) for i in ids)
        return params

    async def _get(self, params: dict[str, str]) -> dict[str, Any]:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": self.base_url,
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers=headers) as client:
            for attempt in range(3):
                try:
                    resp = await client.get(self.base_url, params=params)
                    if resp.status_code >= 400:
                        raise SourceProtocolError(
                            f"site={self.name} HTTP {resp.status_code}"
                        )
                    try:
                        data = resp.json()
                    except Exception as exc:
                        raise SourceProtocolError(
                            f"site={self.name} 返回非 JSON：{resp.text[:200]}"
                        ) from exc
                    if not isinstance(data, dict) or not isinstance(data.get("list"), list):
                        raise SourceProtocolError(
                            f"site={self.name} 返回缺少 'list' 列表字段"
                        )
                    return data
                except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
                    if attempt < 2:
                        await asyncio.sleep(1 * (2 ** attempt))
                    else:
                        raise SourceProtocolError(
                            f"site={self.name} 请求重试后仍失败：{exc!s}"
                        ) from exc
                except SourceProtocolError:
                    raise

    async def list(
        self,
        *,
        t: int | str | None = None,
        pg: int | None = None,
        wd: str | None = None,
        h: int | None = None,
        by: str | None = None,
    ) -> list[dict[str, Any]]:
        params = self._build_params("list", t=t, pg=pg, wd=wd, h=h, by=by)
        data = await self._get(params)
        items: list[dict[str, Any]] = []
        for raw in data["list"]:
            items.append(self._normalize_list_item(raw))
        return items

    async def videolist(
        self,
        *,
        ids: list[str | int] | None = None,
        t: int | str | None = None,
        pg: int | None = None,
        h: int | None = None,
    ) -> list[dict[str, Any]]:
        params = self._build_params("videolist", t=t, pg=pg, h=h, ids=ids)
        data = await self._get(params)
        items: list[dict[str, Any]] = []
        for raw in data["list"]:
            items.append(self._normalize_detail_item(raw))
        return items

    def _normalize_list_item(self, raw: dict[str, Any]) -> dict[str, Any]:
        return {
            "site_id": self.site_id,
            "site_name": self.name,
            "original_id": str(raw.get("vod_id") or raw.get("id") or ""),
            "title": raw.get("vod_name") or raw.get("name") or "",
            "year": _safe_int(raw.get("vod_year") or raw.get("year")),
            "poster_url": raw.get("vod_pic") or raw.get("pic"),
            "type": raw.get("type_name") or raw.get("type"),
            "remarks": raw.get("vod_remarks"),
            "updated_at": raw.get("vod_time") or raw.get("last"),
        }

    def _normalize_detail_item(self, raw: dict[str, Any]) -> dict[str, Any]:
        play_raw = raw.get("vod_play_url") or ""
        down_raw = raw.get("vod_down_url") or ""
        play_from = raw.get("vod_play_from") or ""
        down_from = raw.get("vod_down_from") or ""
        return {
            "site_id": self.site_id,
            "site_name": self.name,
            "original_id": str(raw.get("vod_id") or raw.get("id") or ""),
            "title": raw.get("vod_name") or raw.get("name") or "",
            "year": _safe_int(raw.get("vod_year") or raw.get("year")),
            "poster_url": raw.get("vod_pic") or raw.get("pic"),
            "intro": raw.get("vod_content") or raw.get("vod_blurb"),
            "area": raw.get("vod_area"),
            "actors": raw.get("vod_actor"),
            "director": raw.get("vod_director"),
            "play_url_raw": _convert_play_url(play_raw, play_from),
            "download_url_raw": _convert_play_url(down_raw, down_from),
        }


def _safe_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _convert_play_url(raw: str, from_str: str) -> str:
    """把苹果CMS多播放器格式统一转成 '集数$地址$后缀\\n...'。

    支持两种原始形态：
    1. 已符合规范（含 \\n 且每行 3 段）—— 直接返回
    2. 苹果CMS 标准：from=feifan$$$ffm3u8，url=第1集$URL1#第2集$URL2#...$$$第1集$URL3#...
       按 $$ 拆分播放器，按 # 拆分集数，补 suffix=播放器名
    3. 只有 url 无 from，且按 # 分隔、每行 2 段 —— suffix 默认 mp4
    """
    if not raw:
        return ""
    # 若已含换行且每行至少 3 段，视为规范格式
    if "\n" in raw:
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        if lines and all(ln.count("$") >= 2 for ln in lines):
            return raw.strip()

    froms = [f.strip() for f in from_str.split("$$$") if f.strip()] if from_str else []
    urls = [u.strip() for u in raw.split("$$$") if u.strip()]

    out_lines: list[str] = []
    for idx, url_part in enumerate(urls):
        suffix = froms[idx] if idx < len(froms) else "mp4"
        for ep in url_part.split("#"):
            ep = ep.strip()
            if not ep:
                continue
            parts = ep.split("$")
            if len(parts) >= 2:
                out_lines.append(f"{parts[0].strip()}${parts[1].strip()}${suffix}")
            elif len(parts) == 1 and parts[0]:
                # 极少数只有 URL 没有集数名，用空名占位
                out_lines.append(f"${parts[0].strip()}${suffix}")
    return "\n".join(out_lines)
