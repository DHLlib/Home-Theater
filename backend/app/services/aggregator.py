"""按 (归一title, year) 聚合多源列表（硬契约）。

归一规则：去 《 》 / 首尾空白 / casefold()。
不接 DB；调用方喂数据进来。
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from sqlalchemy import text

logger = logging.getLogger(__name__)


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
            extra_keys = ("type", "type_id", "category", "remarks", "updated_at")
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


# ------------------------------------------------------------------
# 物化视图刷新
# ------------------------------------------------------------------

async def refresh_aggregated_view(db) -> bool:
    """刷新物化视图 mv_aggregated_videos 及预计算推荐视图。

    调用方需自行处理间隔控制（最小 60 秒）。
    """
    try:
        # 禁用 mergejoin 避免 PostgreSQL 优化器 bug（"mergejoin input data is out of order"）
        await db.execute(text("SET LOCAL enable_mergejoin = off"))
        # CONCURRENTLY 要求物化视图上有唯一索引
        await db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_aggregated_videos"))
        await db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_recommended_videos"))
        await db.commit()
        logger.info("物化视图刷新完成")
        return True
    except Exception as exc:
        logger.warning("物化视图刷新失败: %s", exc)
        # 尝试非并发刷新（首次创建索引前fallback）
        try:
            await db.execute(text("SET LOCAL enable_mergejoin = off"))
            await db.execute(text("REFRESH MATERIALIZED VIEW mv_aggregated_videos"))
            await db.execute(text("REFRESH MATERIALIZED VIEW mv_recommended_videos"))
            await db.commit()
            logger.info("物化视图非并发刷新完成")
            return True
        except Exception as exc2:
            logger.error("物化视图刷新彻底失败: %s", exc2)
            return False
