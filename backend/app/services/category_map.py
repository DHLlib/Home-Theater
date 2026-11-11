"""站点分类映射工作台：聚类、建议、批量写入与撤销。

设计要点
- 聚类只是「视图」：把相似远程类名（编辑距离相似度 ≥ 0.75）并成一组，方便一次配完；
  真正落库的仍然是逐类名的别名 / 站点例外。
- 建议按可信度排序：本站历史映射（旧 site_category_mappings）> 关键词规则 > 名称相似度。
- 写入是 upsert：新建与修改走同一条路径；scope=site 写站点例外，scope=global 写全局别名。
- 撤销：写入前快照被触及的别名/例外行，保留最近一次，进程内存储（重启后失效）。
"""
from __future__ import annotations

import logging
from collections import Counter
from difflib import SequenceMatcher

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    CategoryAlias,
    Site,
    SiteCategoryMapping,
    SiteCategoryOverride,
)
from app.services.category_alias import (
    invalidate_alias_cache,
    load_aliases,
    normalize_category_name,
    recompute_videos_for_names,
    upsert_alias,
    upsert_override,
)
from app.services.smart_matcher import _is_adult, _match_one

logger = logging.getLogger(__name__)

# 聚类阈值：编辑相似度（0–1）。实测真实变体（福利/福利片、伦理/伦理片）在 0.75 以上，
# 而「短剧 / 古装短剧」这类「通用 vs 细分」只有 0.67，不应该被合并。
CLUSTER_RATIO = 0.75
# 自动建议的最低置信度；低于它仍然展示建议，但前端不预填（用户拍的阈值 70%）
SUGGEST_FLOOR = 0.6

# 最近一次写入的快照，按站点保存，供「撤销」使用
_UNDO: dict[int, dict] = {}


# ----------------------------------------------------------------------
# 读取：站点类名 → 分组 + 建议
# ----------------------------------------------------------------------


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _cluster_names(names: list[str]) -> list[list[str]]:
    """把相似类名并组（并查集）。返回按组内条数降序的组列表。"""
    keys = [(name, normalize_category_name(name)) for name in names]
    parent = list(range(len(keys)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            if not keys[i][1] or not keys[j][1]:
                continue
            if _similar(keys[i][1], keys[j][1]) >= CLUSTER_RATIO:
                union(i, j)

    grouped: dict[int, list[str]] = {}
    for idx, (name, _) in enumerate(keys):
        grouped.setdefault(find(idx), []).append(name)
    return list(grouped.values())


async def _site_name_stats(db: AsyncSession, site_id: int) -> dict[str, dict]:
    """站点内每个远程类名的来源数与视频数。"""
    rows = (
        await db.execute(
            select(
                AggregatedSource.type_name,
                func.count(),
                func.count(func.distinct(AggregatedSource.aggregated_video_id)),
            )
            .where(
                AggregatedSource.site_id == site_id,
                AggregatedSource.type_name.isnot(None),
            )
            .group_by(AggregatedSource.type_name)
        )
    ).all()
    return {
        (name or "").strip(): {"sources": sources, "videos": videos}
        for name, sources, videos in rows
        if (name or "").strip()
    }


async def _site_null_name_stats(db: AsyncSession, site_id: int) -> dict:
    row = (
        await db.execute(
            select(
                func.count(),
                func.count(func.distinct(AggregatedSource.aggregated_video_id)),
            ).where(
                AggregatedSource.site_id == site_id,
                AggregatedSource.type_name.is_(None),
            )
        )
    ).one()
    return {"sources": row[0] or 0, "videos": row[1] or 0}


async def _sample_titles(db: AsyncSession, site_id: int) -> dict[str, list[str]]:
    """每个远程类名取 3 条最新标题，供人工判断。"""
    rn = func.row_number().over(
        partition_by=AggregatedSource.type_name,
        order_by=(
            AggregatedVideoV3.latest_updated_at.desc().nullslast(),
            AggregatedVideoV3.id.desc(),
        ),
    )
    ranked = (
        select(
            AggregatedSource.type_name.label("type_name"),
            AggregatedVideoV3.title.label("title"),
            rn.label("rn"),
        )
        .join(
            AggregatedVideoV3,
            AggregatedVideoV3.id == AggregatedSource.aggregated_video_id,
        )
        .where(AggregatedSource.site_id == site_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(ranked.c.type_name, ranked.c.title).where(ranked.c.rn <= 3)
        )
    ).all()
    out: dict[str, list[str]] = {}
    for name, title in rows:
        out.setdefault((name or "").strip(), []).append(title)
    return out


async def _site_history(db: AsyncSession, site_id: int) -> dict[str, str]:
    """旧站点映射（type_id → system_name），按类名汇总成多数票。"""
    pairs = (
        await db.execute(
            select(AggregatedSource.type_id, AggregatedSource.type_name)
            .where(
                AggregatedSource.site_id == site_id,
                AggregatedSource.type_name.isnot(None),
                AggregatedSource.type_id.isnot(None),
            )
            .distinct()
        )
    ).all()
    name_by_type = {
        str(type_id): (type_name or "").strip()
        for type_id, type_name in pairs
        if type_name
    }
    if not name_by_type:
        return {}

    mappings = (
        await db.execute(
            select(
                SiteCategoryMapping.remote_id,
                SiteCategoryMapping.system_name,
                SiteCategoryMapping.enabled,
            ).where(SiteCategoryMapping.site_id == site_id)
        )
    ).all()

    votes: dict[str, Counter] = {}
    for remote_id, system_name, enabled in mappings:
        if not enabled:
            continue
        name = name_by_type.get(str(remote_id))
        if name:
            votes.setdefault(name, Counter())[system_name] += 1
    return {name: counter.most_common(1)[0][0] for name, counter in votes.items()}


def _suggest(
    name: str,
    history: dict[str, str],
    system_names: list[str],
) -> tuple[str | None, str, float]:
    """返回 (建议分类, 来源, 置信度)。"""
    if name in history:
        return history[name], "history", 0.9

    matched, confidence = _match_one(name)
    if matched and confidence >= SUGGEST_FLOOR:
        return matched, "rule", round(min(confidence, 0.95), 2)

    best, best_ratio = None, 0.0
    for candidate in system_names:
        ratio = _similar(name, candidate)
        if ratio > best_ratio:
            best, best_ratio = candidate, ratio
    if best and best_ratio >= SUGGEST_FLOOR:
        return best, "similarity", round(best_ratio, 2)
    return None, "none", 0.0


async def build_site_map(db: AsyncSession, site_id: int) -> dict:
    site = await db.get(Site, site_id)
    if site is None:
        raise ValueError("site not found")

    stats = await _site_name_stats(db, site_id)
    null_stats = await _site_null_name_stats(db, site_id)
    samples = await _sample_titles(db, site_id)
    history = await _site_history(db, site_id)
    aliases = await load_aliases(db)
    overrides = {
        row.name_key: row.system_name
        for row in (
            await db.execute(
                select(SiteCategoryOverride).where(
                    SiteCategoryOverride.site_id == site_id
                )
            )
        ).scalars()
    }
    # 系统分类全集（建议用）
    from app.models import SystemCategory

    all_categories = [
        row.name
        for row in (
            await db.execute(select(SystemCategory).order_by(SystemCategory.sort))
        ).scalars()
    ]

    cross = {
        name: {"sites": sites, "sources": sources}
        for name, sites, sources in (
            await db.execute(
                select(
                    AggregatedSource.type_name,
                    func.count(func.distinct(AggregatedSource.site_id)),
                    func.count(),
                )
                .where(AggregatedSource.type_name.in_(list(stats.keys())))
                .group_by(AggregatedSource.type_name)
            )
        ).all()
        if (name or "").strip()
    }

    names = list(stats.keys())
    groups = []
    mapped_names_total = 0
    for cluster in _cluster_names(names):
        cluster = sorted(cluster, key=lambda name: stats[name]["sources"], reverse=True)
        members = []
        sources = videos = 0
        mapped_state: dict[str, tuple[str, str]] = {}
        for name in cluster:
            stat = stats[name]
            sources += stat["sources"]
            videos += stat["videos"]
            key = normalize_category_name(name)
            if key in overrides:
                mapped_state[name] = (overrides[key], "site")
            else:
                info = aliases.get(key)
                if info and info["enabled"]:
                    mapped_state[name] = (info["system_name"], "global")
            members.append(
                {
                    "raw_name": name,
                    "sources": stat["sources"],
                    "videos": stat["videos"],
                    "samples": samples.get(name, []),
                    "adult": _is_adult(name),
                }
            )

        mapped_names_total += len(mapped_state)
        current_system = None
        scope = None
        for name in cluster:
            if name in mapped_state:
                current_system, scope = mapped_state[name]
                break
        # 只有组内每个类名都有映射才算真的映射完成；否则「部分映射」仍要露出来，
        # 否则未映射的变体（如「福利片」）会被已映射的主名（「福利」）藏起来。
        all_mapped = len(mapped_state) == len(cluster)
        partial = bool(mapped_state) and not all_mapped

        suggested = source = None
        confidence = 0.0
        if current_system is None:
            # 组内逐个尝试，取置信度最高的建议
            for name in cluster:
                cand, cand_source, cand_conf = _suggest(name, history, all_categories)
                if cand and cand_conf > confidence:
                    suggested, source, confidence = cand, cand_source, cand_conf

        other_sites = sum(1 for name in cluster if cross.get(name, {}).get("sites", 1) > 1)
        other_sources = sum(cross.get(name, {}).get("sources", 0) for name in cluster) - sources

        groups.append(
            {
                "group_key": cluster[0],
                "names": members,
                "sources": sources,
                "videos": videos,
                "mapped": all_mapped,
                "partial": partial,
                "current_system": current_system,
                "scope": scope,
                "suggested_system": suggested,
                "suggestion_source": source or "none",
                "confidence": confidence,
                "cross_site": {
                    "sites": other_sites,
                    "sources": max(other_sources, 0),
                },
            }
        )

    groups.sort(key=lambda g: (g["mapped"], g["confidence"], -g["sources"]))
    mapped_count = mapped_names_total

    uncategorized = (
        await db.execute(
            select(func.count(func.distinct(AggregatedVideoV3.id)))
            .select_from(AggregatedVideoV3)
            .join(
                AggregatedSource,
                AggregatedSource.aggregated_video_id == AggregatedVideoV3.id,
            )
            .where(
                AggregatedSource.site_id == site_id,
                AggregatedVideoV3.system_category.is_(None),
            )
        )
    ).scalar_one()
    total_videos = (
        await db.execute(
            select(func.count(func.distinct(AggregatedSource.aggregated_video_id))).where(
                AggregatedSource.site_id == site_id
            )
        )
    ).scalar_one()

    return {
        "site": {"id": site.id, "name": site.name},
        "stats": {
            "names": len(names),
            "mapped": mapped_count,
            "unmapped": len(names) - mapped_count,
            "videos": total_videos,
            "uncategorized_videos": uncategorized,
            "no_name_sources": null_stats["sources"],
            "no_name_videos": null_stats["videos"],
        },
        "groups": groups,
    }


# ----------------------------------------------------------------------
# 写入：批量 upsert + 撤销
# ----------------------------------------------------------------------


async def _snapshot(db: AsyncSession, site_id: int, keys: list[str]) -> dict:
    """记录被触及的别名 / 例外行的当前值，供撤销还原。"""
    alias_rows = (
        await db.execute(
            select(CategoryAlias).where(CategoryAlias.name_key.in_(keys))
        )
    ).scalars().all()
    override_rows = (
        await db.execute(
            select(SiteCategoryOverride).where(
                SiteCategoryOverride.site_id == site_id,
                SiteCategoryOverride.name_key.in_(keys),
            )
        )
    ).scalars().all()
    return {
        "aliases": {
            row.name_key: {
                "system_name": row.system_name,
                "enabled": row.enabled,
                "raw_names": list(row.raw_names or []),
                "source": row.source,
            }
            for row in alias_rows
        },
        "overrides": {row.name_key: row.system_name for row in override_rows},
        "names": keys,
    }


async def apply_site_map(
    db: AsyncSession,
    site_id: int,
    items: list[dict],
    fill_rest_system: str | None = None,
) -> dict:
    site = await db.get(Site, site_id)
    if site is None:
        raise ValueError("site not found")

    stats = await _site_name_stats(db, site_id)
    aliases = await load_aliases(db)
    overrides = {
        row.name_key
        for row in (
            await db.execute(
                select(SiteCategoryOverride.name_key).where(
                    SiteCategoryOverride.site_id == site_id
                )
            )
        ).scalars()
    }

    # 1) 先算出这次要动哪些类名（含「剩余归到其他资源」），在写入前拍快照，
    #    否则 autoflush 会把新值算进「之前的状态」，撤销就还原不了。
    touched: list[str] = []
    planned: list[tuple[str, str, str]] = []  # (raw_name, system_name, scope)
    for item in items:
        raw_names = [name for name in item.get("raw_names", []) if name]
        system_name = item.get("system_name")
        scope = item.get("scope", "global")
        if not raw_names or not system_name:
            continue
        for raw_name in raw_names:
            if not normalize_category_name(raw_name):
                continue
            touched.append(raw_name)
            planned.append((raw_name, system_name, scope))

    covered = {normalize_category_name(name) for name in touched}
    if fill_rest_system:
        for name in stats:
            key = normalize_category_name(name)
            if not key or key in covered:
                continue
            info = aliases.get(key)
            if info and info["enabled"]:
                continue
            if key in overrides:
                continue
            touched.append(name)
            planned.append((name, fill_rest_system, "global"))

    keys = sorted({normalize_category_name(name) for name in touched if name})
    _UNDO[site_id] = await _snapshot(db, site_id, keys)

    # 2) 逐项 upsert
    alias_written = 0
    override_written = 0
    for raw_name, system_name, scope in planned:
        if scope == "site":
            await upsert_override(db, site_id, raw_name, system_name)
            override_written += 1
            continue
        await upsert_alias(db, raw_name, system_name)
        alias_written += 1
        # 全局别名覆盖后，本站旧的例外会与之冲突，顺手清掉
        key = normalize_category_name(raw_name)
        if key in overrides:
            await db.execute(
                delete(SiteCategoryOverride).where(
                    SiteCategoryOverride.site_id == site_id,
                    SiteCategoryOverride.name_key == key,
                )
            )

    before = await _site_uncategorized(db, site_id)

    await db.commit()
    invalidate_alias_cache()
    from app.api.videos import invalidate_category_filter_cache

    invalidate_category_filter_cache()

    recomputed = 0
    if touched:
        recomputed = await recompute_videos_for_names(db, touched)
        await db.commit()
        invalidate_category_filter_cache()

    after = await _site_uncategorized(db, site_id)

    logger.info(
        "category_map_applied site=%s alias=%d override=%d names=%d videos=%d uncat=%d->%d",
        site_id,
        alias_written,
        override_written,
        len(keys),
        recomputed,
        before,
        after,
    )
    return {
        "ok": True,
        "aliases_written": alias_written,
        "overrides_written": override_written,
        "names_touched": len(keys),
        "recomputed_videos": recomputed,
        "uncategorized_before": before,
        "uncategorized_after": after,
        "undo_available": site_id in _UNDO,
    }


async def _site_uncategorized(db: AsyncSession, site_id: int) -> int:
    return (
        await db.execute(
            select(func.count(func.distinct(AggregatedVideoV3.id)))
            .select_from(AggregatedVideoV3)
            .join(
                AggregatedSource,
                AggregatedSource.aggregated_video_id == AggregatedVideoV3.id,
            )
            .where(
                AggregatedSource.site_id == site_id,
                AggregatedVideoV3.system_category.is_(None),
            )
        )
    ).scalar_one()


async def undo_last_apply(db: AsyncSession, site_id: int) -> dict:
    snapshot = _UNDO.pop(site_id, None)
    if snapshot is None:
        return {"ok": False, "detail": "没有可撤销的操作"}

    for key in snapshot["names"]:
        previous = snapshot["aliases"].get(key)
        if previous is None:
            await db.execute(delete(CategoryAlias).where(CategoryAlias.name_key == key))
            continue
        alias = await db.get(CategoryAlias, key)
        if alias is None:
            alias = CategoryAlias(name_key=key, raw_names=previous["raw_names"])
            db.add(alias)
        alias.system_name = previous["system_name"]
        alias.enabled = previous["enabled"]
        alias.raw_names = previous["raw_names"]
        alias.source = previous["source"]

    for key in snapshot["names"]:
        previous = snapshot["overrides"].get(key)
        existing = (
            await db.execute(
                select(SiteCategoryOverride).where(
                    SiteCategoryOverride.site_id == site_id,
                    SiteCategoryOverride.name_key == key,
                )
            )
        ).scalar_one_or_none()
        if previous is None:
            if existing is not None:
                await db.delete(existing)
            continue
        if existing is None:
            db.add(
                SiteCategoryOverride(
                    site_id=site_id, name_key=key, system_name=previous
                )
            )
        else:
            existing.system_name = previous

    await db.commit()
    invalidate_alias_cache()
    from app.api.videos import invalidate_category_filter_cache

    invalidate_category_filter_cache()
    await recompute_videos_for_names(db, snapshot["names"], chunk_size=2000)
    await db.commit()

    logger.info("category_map_undo site=%s names=%d", site_id, len(snapshot["names"]))
    return {"ok": True, "names_restored": len(snapshot["names"])}
