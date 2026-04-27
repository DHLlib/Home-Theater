"""按 (归一title, year) 聚合多源列表（硬契约）。

归一规则：去 《 》 / 首尾空白 / casefold()。
不接 DB；调用方喂数据进来。
"""
from __future__ import annotations

from typing import Any, Iterable


def normalize_title(title: str) -> str:
    if title is None:
        return ""
    s = title.strip()
    for ch in ("《", "》", "<", ">"):
        s = s.replace(ch, "")
    return s.strip().casefold()


def aggregate_lists(per_source: Iterable[Iterable[dict[str, Any]]]) -> list[dict[str, Any]]:
    """把多个来源的列表合并去重。

    入参：[[item, ...], [item, ...], ...]，每个 item 至少包含 title / year / site_id / original_id
    出参：去重后的列表，每条形如：
        {title, year, poster_url, sources: [{site_id, original_id, ...}], ... }
    """
    bucket: dict[tuple[str, int | None], dict[str, Any]] = {}
    for source_items in per_source:
        for item in source_items:
            title = item.get("title", "")
            year = item.get("year")
            key = (normalize_title(title), year)
            existing = bucket.get(key)
            source_ref = {
                "site_id": item.get("site_id"),
                "site_name": item.get("site_name"),
                "original_id": item.get("original_id"),
            }
            extra_keys = ("type", "category", "remarks", "updated_at")
            for ek in extra_keys:
                if ek in item:
                    source_ref[ek] = item[ek]
            if existing is None:
                bucket[key] = {
                    "title": title.strip(),
                    "year": year,
                    "poster_url": item.get("poster_url"),
                    "sources": [source_ref],
                }
            else:
                if not existing.get("poster_url") and item.get("poster_url"):
                    existing["poster_url"] = item.get("poster_url")
                existing["sources"].append(source_ref)
    return list(bucket.values())
