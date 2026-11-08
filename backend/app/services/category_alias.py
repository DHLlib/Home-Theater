"""分类别名：远程分类名 → 系统分类的全局映射。

替代按站点的 site_category_mappings：远程类名跨站高度重复（实测 98 个名字
对应 805 条站点映射），按名字配一次即可，新站点命中即自动生效。

读取路径（首页分类筛选）按 remote 类名的原始写法过滤 aggregated_sources.type_name，
所以别名同时保存归一化 key（主键）与实际出现过的 raw 写法。
"""
from __future__ import annotations

import logging
import re
import time
from collections import Counter

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AggregatedSource,
    CategoryAlias,
    SiteCategoryMapping,
    SiteCategoryOverride,
    SystemCategory,
)
from app.services.smart_matcher import _is_adult, _match_one

logger = logging.getLogger(__name__)

_WS = re.compile(r"\s+")
_ALIAS_CACHE_TTL = 60.0

_alias_cache: dict[str, dict] | None = None
_alias_cache_ts: float = 0.0


def normalize_category_name(name: str | None) -> str:
    """把远程类名归一化成匹配用的 key。

    去空白、全角括号转半角、破折号统一、大小写折叠；只做幂等的字符级处理，
    不做语义猜测（语义交给 smart_matcher 的规则）。
    """
    if not name:
        return ""
    s = _WS.sub("", str(name).strip())
    s = s.replace("（", "(").replace("）", ")")
    s = s.replace("—", "-").replace("–", "-")
    return s.casefold()


def invalidate_alias_cache() -> None:
    global _alias_cache, _alias_cache_ts
    _alias_cache = None
    _alias_cache_ts = 0.0


async def load_aliases(db: AsyncSession, *, use_cache: bool = True) -> dict[str, dict]:
    """加载全部别名：{name_key: {system_name, enabled, raw_names}}。"""
    global _alias_cache, _alias_cache_ts
    now = time.monotonic()
    if (
        use_cache
        and _alias_cache is not None
        and (now - _alias_cache_ts) < _ALIAS_CACHE_TTL
    ):
        return _alias_cache

    result = await db.execute(select(CategoryAlias))
    data: dict[str, dict] = {}
    for row in result.scalars().all():
        data[row.name_key] = {
            "system_name": row.system_name,
            "enabled": row.enabled,
            "raw_names": list(row.raw_names or []),
        }
    _alias_cache = data
    _alias_cache_ts = now
    return data


async def resolve_remote_names(
    db: AsyncSession, system_names: set[str]
) -> list[str]:
    """系统分类名集合 → 需要匹配的远程类名原始写法（供 SQL 过滤）。"""
    aliases = await load_aliases(db)
    names: list[str] = []
    for info in aliases.values():
        if not info["enabled"]:
            continue
        if info["system_name"] not in system_names:
            continue
        names.extend(info["raw_names"] or [])
    return sorted(set(names))


async def _system_category_names(db: AsyncSession) -> dict[str, dict]:
    result = await db.execute(select(SystemCategory))
    return {
        row.name: {"enabled": row.enabled, "parent_id": row.parent_id}
        for row in result.scalars().all()
    }


async def seed_aliases_from_data(db: AsyncSession) -> dict:
    """从现有数据生成别名：优先按站点映射多数票，未覆盖的走关键词规则。

    幂等：已存在的别名只补 raw_names，用户手工确认过的 system_name 不覆盖。
    """
    src_rows = (
        await db.execute(
            select(
                AggregatedSource.site_id,
                AggregatedSource.type_id,
                AggregatedSource.type_name,
            ).distinct()
        )
    ).all()

    mapping_rows = (
        await db.execute(
            select(
                SiteCategoryMapping.site_id,
                SiteCategoryMapping.remote_id,
                SiteCategoryMapping.system_name,
                SiteCategoryMapping.enabled,
            )
        )
    ).all()
    by_site_type = {
        (m.site_id, str(m.remote_id)): (m.system_name, m.enabled)
        for m in mapping_rows
    }

    votes: dict[str, Counter] = {}
    raws: dict[str, set[str]] = {}
    for site_id, type_id, type_name in src_rows:
        if not type_name or type_id is None:
            continue
        key = normalize_category_name(type_name)
        if not key:
            continue
        raws.setdefault(key, set()).add(type_name)
        mapping = by_site_type.get((site_id, str(type_id)))
        if mapping and mapping[1]:
            votes.setdefault(key, Counter())[mapping[0]] += 1

    system_categories = await _system_category_names(db)
    existing = {
        row.name_key: row
        for row in (await db.execute(select(CategoryAlias))).scalars().all()
    }

    created = updated = skipped_adult = skipped_unknown = 0
    for key, names in raws.items():
        counter = votes.get(key)
        if counter:
            system_name = counter.most_common(1)[0][0]
        else:
            sample = sorted(names)[0]
            if _is_adult(sample):
                skipped_adult += 1
                continue
            suggested, confidence = _match_one(sample)
            if not suggested or confidence < 0.6:
                skipped_unknown += 1
                continue
            system_name = suggested

        if system_name not in system_categories:
            skipped_unknown += 1
            continue

        alias = existing.get(key)
        if alias is not None:
            alias.raw_names = sorted(set(alias.raw_names or []) | names)
            if alias.source != "manual" and alias.system_name != system_name:
                alias.system_name = system_name
            updated += 1
        else:
            db.add(
                CategoryAlias(
                    name_key=key,
                    system_name=system_name,
                    raw_names=sorted(names),
                    enabled=True,
                    source="auto",
                )
            )
            existing[key] = None  # 占位，避免重复 add
            created += 1

    await db.commit()
    invalidate_alias_cache()

    conflicts = sum(1 for counter in votes.values() if len(counter) > 1)
    summary = {
        "created": created,
        "updated": updated,
        "skipped_adult": skipped_adult,
        "skipped_unknown": skipped_unknown,
        "name_keys": len(raws),
        "conflicts": conflicts,
    }
    logger.info("category_aliases_seeded %s", summary)
    return summary


async def alias_usage(db: AsyncSession) -> dict[str, dict]:
    """按远程类名统计来源条数与站点数：{name_key: {sources, sites, raw_names}}。"""
    rows = (
        await db.execute(
            select(
                AggregatedSource.type_name,
                AggregatedSource.site_id,
            ).where(AggregatedSource.type_name.isnot(None))
        )
    ).all()
    usage: dict[str, dict] = {}
    for type_name, site_id in rows:
        key = normalize_category_name(type_name)
        if not key:
            continue
        item = usage.setdefault(
            key, {"sources": 0, "sites": set(), "raw_names": set()}
        )
        item["sources"] += 1
        item["sites"].add(site_id)
        item["raw_names"].add(type_name)
    return {
        key: {
            "sources": value["sources"],
            "sites": len(value["sites"]),
            "raw_names": sorted(value["raw_names"]),
        }
        for key, value in usage.items()
    }


async def unmapped_categories(db: AsyncSession) -> list[dict]:
    """未归类的远程类名（按来源条数倒序），用于「未分类」桶。"""
    aliases = await load_aliases(db)
    usage = await alias_usage(db)
    result = []
    for key, info in usage.items():
        if key in aliases:
            continue
        raw = info["raw_names"][0]
        if _is_adult(raw):
            continue
        suggested, confidence = _match_one(raw)
        result.append(
            {
                "name_key": key,
                "raw_names": info["raw_names"],
                "source_count": info["sources"],
                "site_count": info["sites"],
                "suggested_system_name": suggested if confidence >= 0.6 else None,
            }
        )
    result.sort(key=lambda item: item["source_count"], reverse=True)
    return result


async def upsert_alias(
    db: AsyncSession,
    raw_name: str,
    system_name: str,
    *,
    source: str = "manual",
) -> CategoryAlias:
    """新增/更新单个别名，合并 raw 写法。调用方负责 commit。"""
    key = normalize_category_name(raw_name)
    if not key:
        raise ValueError("分类名为空")
    alias = await db.get(CategoryAlias, key)
    if alias is None:
        alias = CategoryAlias(
            name_key=key,
            system_name=system_name,
            raw_names=[raw_name],
            enabled=True,
            source=source,
        )
        db.add(alias)
    else:
        alias.system_name = system_name
        alias.enabled = True
        alias.source = source
        alias.raw_names = sorted(set(alias.raw_names or []) | {raw_name})
    return alias


async def delete_alias(db: AsyncSession, name_key: str) -> bool:
    result = await db.execute(delete(CategoryAlias).where(CategoryAlias.name_key == name_key))
    return bool(result.rowcount)


async def list_overrides(db: AsyncSession) -> list[SiteCategoryOverride]:
    result = await db.execute(select(SiteCategoryOverride).order_by(SiteCategoryOverride.site_id))
    return list(result.scalars().all())
