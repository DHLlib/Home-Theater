"""分类别名：远程分类名 → 系统分类的全局映射。

替代按站点的 site_category_mappings：远程类名跨站高度重复（实测 98 个名字
对应 805 条站点映射），按名字配一次即可，新站点命中即自动生效。

读取路径（首页分类筛选）按 remote 类名的原始写法过滤 aggregated_sources.type_name，
所以别名同时保存归一化 key（主键）与实际出现过的 raw 写法。
"""
from __future__ import annotations

import asyncio
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

# 来源/站点统计要扫 45 万行，缓存 60 秒；抓取后最多延迟一分钟
_usage_cache: dict[str, dict] | None = None
_usage_cache_ts: float = 0.0
_USAGE_CACHE_TTL = 60.0
# 串行化统计计算：面板会并发请求别名列表与未分类列表，两者都要统计，
# 不加锁会同时各扫一遍 45 万行。
_usage_lock = asyncio.Lock()


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


async def alias_usage(db: AsyncSession, *, use_cache: bool = True) -> dict[str, dict]:
    """按远程类名统计来源条数与站点数：{name_key: {sources, sites, raw_names}}。"""
    global _usage_cache, _usage_cache_ts
    async with _usage_lock:
        now = time.monotonic()
        if (
            use_cache
            and _usage_cache is not None
            and (now - _usage_cache_ts) < _USAGE_CACHE_TTL
        ):
            return _usage_cache

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
        result = {
            key: {
                "sources": value["sources"],
                "sites": len(value["sites"]),
                "raw_names": sorted(value["raw_names"]),
            }
            for key, value in usage.items()
        }
        _usage_cache = result
        _usage_cache_ts = now
        return result


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


async def seed_aliases_from_names(
    db: AsyncSession, pairs: list[tuple[str, str]], *, source: str = "auto"
) -> int:
    """把 (远程类名, 系统分类) 批量并入别名表，已存在的 key 不覆盖。

    用于「新站点自动匹配」：高置信结果直接进全局别名，老站点也能受益。
    只新增、不改写已有别名（人工确认过的不覆盖）。
    """
    existing = await load_aliases(db)
    created_names: list[str] = []
    for raw_name, system_name in pairs:
        key = normalize_category_name(raw_name)
        if not key or not system_name or key in existing:
            continue
        db.add(
            CategoryAlias(
                name_key=key,
                system_name=system_name,
                raw_names=[raw_name],
                enabled=True,
                source=source,
            )
        )
        existing[key] = {
            "system_name": system_name,
            "enabled": True,
            "raw_names": [raw_name],
        }
        created_names.append(raw_name)

    if not created_names:
        return 0

    await db.commit()
    invalidate_alias_cache()
    await recompute_videos_for_names(db, created_names)
    logger.info("新站点自动匹配并入别名: %d 条", len(created_names))
    return len(created_names)


async def recompute_videos_for_names(
    db: AsyncSession, raw_names: list[str], *, chunk_size: int = 2000
) -> int:
    """别名变更后重算受影响视频的分类（置空后回填）。

    视频级分类是物化字段，不重算的话「改别名」要等下次全量重建才生效。
    """
    from sqlalchemy import update

    from app.models import AggregatedVideoV3

    names = [name for name in raw_names if name]
    if not names:
        return 0

    video_ids = (
        await db.execute(
            select(AggregatedSource.aggregated_video_id)
            .where(AggregatedSource.type_name.in_(names))
            .distinct()
        )
    ).scalars().all()
    if not video_ids:
        return 0

    for start in range(0, len(video_ids), chunk_size):
        chunk = video_ids[start : start + chunk_size]
        await db.execute(
            update(AggregatedVideoV3)
            .where(AggregatedVideoV3.id.in_(chunk))
            .values(system_category=None)
        )
        await db.commit()

    filled = await backfill_video_categories(db)
    logger.info(
        "别名变更后重算视频分类: names=%s videos=%d filled=%d",
        names[:5],
        len(video_ids),
        filled,
    )
    return filled


async def list_overrides(db: AsyncSession) -> list[SiteCategoryOverride]:
    result = await db.execute(select(SiteCategoryOverride).order_by(SiteCategoryOverride.site_id))
    return list(result.scalars().all())


def pick_system_category(
    type_names: list[str | None],
    aliases: dict[str, dict],
    sort_order: dict[str, int] | None = None,
) -> str | None:
    """按来源别名投票选一个系统分类；平票取 sort 小的，再平按名字。

    同一个聚合视频可能来自多个站点、被标成不同分类（实测 16.2% 如此），
    视频级只保留一个分类，避免在多个分类页重复出现。
    """
    votes: Counter[str] = Counter()
    for raw in type_names:
        if not raw:
            continue
        info = aliases.get(normalize_category_name(raw))
        if not info or not info["enabled"]:
            continue
        votes[info["system_name"]] += 1
    if not votes:
        return None
    order = sort_order or {}
    return max(
        votes.items(),
        key=lambda kv: (kv[1], -order.get(kv[0], 10**6), kv[0]),
    )[0]


async def load_category_decision_maps(
    db: AsyncSession,
) -> tuple[dict[str, dict], dict[str, int]]:
    """返回 (别名表, 系统分类排序) 供视频级分类投票使用。"""
    aliases = await load_aliases(db)
    rows = await db.execute(select(SystemCategory.name, SystemCategory.sort))
    sort_order = {name: sort for name, sort in rows.all()}
    return aliases, sort_order


async def backfill_video_categories(
    db: AsyncSession, *, chunk_size: int = 2000
) -> int:
    """为 aggregated_videos 回填 system_category（只处理当前为 NULL 的行）。

    注意：不能把全部 id 一次塞进 IN（asyncpg 参数上限会直接报错），必须分批。
    """
    from sqlalchemy import text

    from app.models import AggregatedVideoV3

    aliases, sort_order = await load_category_decision_maps(db)

    null_ids = [
        row[0]
        for row in (
            await db.execute(
                select(AggregatedVideoV3.id).where(
                    AggregatedVideoV3.system_category.is_(None)
                )
            )
        ).all()
    ]
    if not null_ids:
        return 0

    stmt = text(
        "UPDATE aggregated_videos SET system_category = :b_cat WHERE id = :b_id"
    )
    filled = 0
    for start in range(0, len(null_ids), chunk_size):
        chunk = null_ids[start : start + chunk_size]
        src_rows = (
            await db.execute(
                select(
                    AggregatedSource.aggregated_video_id,
                    AggregatedSource.type_name,
                ).where(AggregatedSource.aggregated_video_id.in_(chunk))
            )
        ).all()
        grouped: dict[int, list[str | None]] = {}
        for video_id, type_name in src_rows:
            grouped.setdefault(video_id, []).append(type_name)

        computed = []
        for video_id in chunk:
            names = grouped.get(video_id)
            if not names:
                continue
            category = pick_system_category(names, aliases, sort_order)
            if category:
                computed.append({"b_id": video_id, "b_cat": category})

        if computed:
            await db.execute(stmt, computed)
            await db.commit()
            filled += len(computed)

    logger.info("视频级分类回填完成: %d 条", filled)
    return filled
