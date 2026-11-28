"""按站点的纯手动分类挂载。

一个 (site_id, remote_id) 只能挂到一个小类；一个小类可以挂多个站点、多个
远程类名。远程分类快照只用于界面展示和爬虫范围，挂载关系本身独立存在。

视频级分类仍然只保留一个值：同一聚合视频的多个来源各自按挂载关系投票，
票数相同按小类 sort / name 决定。删除系统分类时不投票，直接把该分类名下的
视频置空。
"""
from __future__ import annotations

import re
from collections import Counter

from sqlalchemy import delete, exists, func, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    Site,
    SiteCategoryLink,
    SiteRemoteCategory,
    SystemCategory,
    _utcnow,
)

_WS = re.compile(r"\s+")


def normalize_category_name(name: str | None) -> str:
    """只做字符级归一化，供 type_id 缺失时按类名回退匹配。"""
    if not name:
        return ""
    s = _WS.sub("", str(name).strip())
    s = s.replace("（", "(").replace("）", ")")
    s = s.replace("—", "-").replace("–", "-")
    return s.casefold()


async def load_links(db: AsyncSession) -> tuple[dict[tuple[int, str], str], dict[tuple[int, str], str]]:
    """返回 (按 remote_id, 按归一化远程名) 两套 {…: system_name}。

    type_id 存在时优先用 id；个别 videolist 来源丢失 type_id，只能用类名兜底。
    """
    rows = (
        await db.execute(
            select(SiteCategoryLink.site_id, SiteCategoryLink.remote_id,
                   SiteCategoryLink.remote_name, SystemCategory.name, SystemCategory.enabled)
            .join(SystemCategory, SystemCategory.id == SiteCategoryLink.system_category_id)
            .where(SystemCategory.enabled.is_(True))
        )
    ).all()
    by_id: dict[tuple[int, str], str] = {}
    by_name: dict[tuple[int, str], str] = {}
    for site_id, remote_id, remote_name, system_name, _enabled in rows:
        by_id[(site_id, str(remote_id))] = system_name
        key = normalize_category_name(remote_name)
        if key:
            by_name[(site_id, key)] = system_name
    return by_id, by_name


async def load_category_decision_maps(
    db: AsyncSession,
) -> tuple[dict[tuple[int, str], str], dict[tuple[int, str], str], dict[str, int]]:
    """返回 (按 id, 按名称, 小类排序)，供视频级投票使用。"""
    by_id, by_name = await load_links(db)
    sort_rows = await db.execute(select(SystemCategory.name, SystemCategory.sort))
    sort_order = {name: sort for name, sort in sort_rows.all()}
    return by_id, by_name, sort_order


def pick_system_category(
    sources: list[tuple[int | None, int | str | None, str | None]],
    links_by_id: dict[tuple[int, str], str],
    links_by_name: dict[tuple[int, str], str],
    sort_order: dict[str, int] | None = None,
) -> str | None:
    """按来源投票；sources = [(site_id, type_id, type_name), ...]。"""
    votes: Counter[str] = Counter()
    for site_id, type_id, type_name in sources:
        if site_id is None:
            continue
        system_name = None
        if type_id is not None:
            system_name = links_by_id.get((site_id, str(type_id)))
        if system_name is None:
            key = normalize_category_name(type_name)
            if key:
                system_name = links_by_name.get((site_id, key))
        if system_name:
            votes[system_name] += 1
    if not votes:
        return None
    order = sort_order or {}
    return max(
        votes.items(),
        key=lambda kv: (kv[1], -order.get(kv[0], 10**6), kv[0]),
    )[0]


# 同一视频的多个来源都挂到不同小类时只保留一个；相关子查询也用于全量回填。
_VOTE_SUBQUERY = """
    SELECT sc.name
    FROM aggregated_sources s
    JOIN site_category_links l
      ON l.site_id = s.site_id AND l.remote_id = s.type_id::text
    JOIN system_categories sc ON sc.id = l.system_category_id
    WHERE s.aggregated_video_id = v.id
    GROUP BY sc.id, sc.name, sc.sort
    ORDER BY count(*) DESC, sc.sort ASC, sc.name ASC
    LIMIT 1
"""


async def recompute_videos_for_site_remotes(
    db: AsyncSession,
    site_id: int,
    remote_ids: list[str],
) -> int:
    """只重算「该站点这些远程分类」涉及的视频，不扫全库。"""
    ids = [str(remote_id) for remote_id in remote_ids if remote_id is not None]
    if not ids:
        return 0
    result = await db.execute(
        text(
            f"""
            UPDATE aggregated_videos v
            SET system_category = ({_VOTE_SUBQUERY})
            WHERE v.id IN (
                SELECT DISTINCT s.aggregated_video_id
                FROM aggregated_sources s
                WHERE s.site_id = :site_id
                  AND s.type_id IS NOT NULL
                  AND s.type_id::text = ANY(CAST(:remote_ids AS text[]))
            )
            """
        ),
        {"site_id": site_id, "remote_ids": ids},
    )
    return int(result.rowcount or 0)


async def backfill_video_categories(db: AsyncSession) -> int:
    """给没有任何视频级分类的行按当前挂载关系回填。

    只在全量重建聚合表后调用；启动时不再全量回填，避免把用户删除分类后
    置空的视频又算回去。
    """
    result = await db.execute(
        text(
            f"""
            UPDATE aggregated_videos v
            SET system_category = ({_VOTE_SUBQUERY})
            WHERE v.system_category IS NULL
              AND EXISTS (
                  SELECT 1 FROM aggregated_sources s
                  WHERE s.aggregated_video_id = v.id
              )
            """
        )
    )
    return int(result.rowcount or 0)


async def category_counts(db: AsyncSession) -> list[dict]:
    """系统分类 + 视频数 + 已挂载远程分类数（用于左树）。"""
    video_count = (
        select(func.count())
        .select_from(AggregatedVideoV3)
        .where(AggregatedVideoV3.system_category == SystemCategory.name)
        .correlate(SystemCategory)
        .scalar_subquery()
    )
    remote_count = (
        select(func.count())
        .select_from(SiteCategoryLink)
        .where(SiteCategoryLink.system_category_id == SystemCategory.id)
        .correlate(SystemCategory)
        .scalar_subquery()
    )
    rows = (
        await db.execute(
            select(SystemCategory, video_count.label("videos"), remote_count.label("remotes"))
            .order_by(SystemCategory.sort, SystemCategory.id)
        )
    ).all()
    return [
        {
            "id": row[0].id,
            "parent_id": row[0].parent_id,
            "name": row[0].name,
            "sort": row[0].sort,
            "enabled": row[0].enabled,
            "videos": int(row[1] or 0),
            "remotes": int(row[2] or 0),
        }
        for row in rows
    ]


async def category_summary(db: AsyncSession) -> dict:
    latest_seen = (
        select(
            SiteRemoteCategory.site_id.label("site_id"),
            func.max(SiteRemoteCategory.last_seen_at).label("seen_at"),
        )
        .group_by(SiteRemoteCategory.site_id)
        .subquery()
    )
    unmapped = (
        await db.execute(
            select(func.count())
            .select_from(SiteRemoteCategory)
            .join(
                latest_seen,
                (latest_seen.c.site_id == SiteRemoteCategory.site_id)
                & (latest_seen.c.seen_at == SiteRemoteCategory.last_seen_at),
            )
            .outerjoin(
                SiteCategoryLink,
                (SiteCategoryLink.site_id == SiteRemoteCategory.site_id)
                & (SiteCategoryLink.remote_id == SiteRemoteCategory.remote_id),
            )
            .where(SiteCategoryLink.id.is_(None))
        )
    ).scalar_one()
    uncategorized = (
        await db.execute(
            select(func.count())
            .select_from(AggregatedVideoV3)
            .where(AggregatedVideoV3.system_category.is_(None))
        )
    ).scalar_one()
    linked = (
        await db.execute(select(func.count()).select_from(SiteCategoryLink))
    ).scalar_one()
    sites = (
        await db.execute(select(func.count()).select_from(Site))
    ).scalar_one()
    return {
        "unmapped_remotes": int(unmapped or 0),
        "uncategorized_videos": int(uncategorized or 0),
        "linked_remotes": int(linked or 0),
        "sites": int(sites or 0),
    }


async def _sample_titles(
    db: AsyncSession, site_id: int, remote_ids: list[str], per_name: int = 3
) -> dict[str, list[str]]:
    # 按远程分类的 type_id 走 (site_id, type_id) 索引；旧的 type_name 匹配会
    # 对每个类名扫一遍该站全部来源，站点多时列表要 3-4 秒。
    numeric_ids = [str(rid) for rid in remote_ids if str(rid).isdigit()]
    if not numeric_ids:
        return {}
    rows = (
        await db.execute(
            text(
                """
                SELECT n.remote_id, v.title
                FROM unnest(CAST(:remote_ids AS text[])) AS n(remote_id)
                CROSS JOIN LATERAL (
                    SELECT av.title
                    FROM aggregated_sources s
                    JOIN aggregated_videos av ON av.id = s.aggregated_video_id
                    WHERE s.site_id = :site_id
                      AND s.type_id = CAST(n.remote_id AS integer)
                    ORDER BY s.id DESC
                    LIMIT :per_name
                ) v
                """
            ),
            {
                "remote_ids": numeric_ids,
                "site_id": site_id,
                "per_name": per_name,
            },
        )
    ).all()
    out: dict[str, list[str]] = {}
    for remote_id, title in rows:
        out.setdefault(str(remote_id), []).append(title)
    return out


async def list_remote_categories(db: AsyncSession) -> list[dict]:
    """所有站点的远程分类快照 + 挂载状态 + 来源/视频计数 + 样例标题。"""
    rows = (
        await db.execute(
            select(
                SiteRemoteCategory,
                Site.name.label("site_name"),
                Site.enabled.label("site_enabled"),
                SiteCategoryLink.system_category_id,
                SystemCategory.name.label("category_name"),
            )
            .join(Site, Site.id == SiteRemoteCategory.site_id)
            .outerjoin(
                SiteCategoryLink,
                (SiteCategoryLink.site_id == SiteRemoteCategory.site_id)
                & (SiteCategoryLink.remote_id == SiteRemoteCategory.remote_id),
            )
            .outerjoin(SystemCategory, SystemCategory.id == SiteCategoryLink.system_category_id)
            .order_by(
                Site.sort,
                Site.id,
                SiteRemoteCategory.parent_name,
                SiteRemoteCategory.sort,
                SiteRemoteCategory.name,
            )
        )
    ).all()

    latest_rows = (
        await db.execute(
            select(
                SiteRemoteCategory.site_id,
                func.max(SiteRemoteCategory.last_seen_at),
            ).group_by(SiteRemoteCategory.site_id)
        )
    ).all()
    latest = {site_id: seen for site_id, seen in latest_rows}

    # 只统计快照里出现的 (site_id, type_id)，避免对 1800 万来源全表 GROUP BY。
    usage_pairs = sorted(
        {
            (remote.site_id, int(remote.remote_id))
            for remote, *_ in rows
            if str(remote.remote_id).isdigit()
        }
    )
    usage_rows = (
        await db.execute(
            select(
                AggregatedSource.site_id,
                AggregatedSource.type_id,
                func.count(),
            )
            .where(
                AggregatedSource.type_id.isnot(None),
                tuple_(
                    AggregatedSource.site_id,
                    AggregatedSource.type_id,
                ).in_(usage_pairs),
            )
            .group_by(AggregatedSource.site_id, AggregatedSource.type_id)
        )
    ).all() if usage_pairs else []
    usage = {
        (site_id, str(type_id)): int(sources or 0)
        for site_id, type_id, sources in usage_rows
    }

    # 样例标题只对「已挂载」行按需查；远程分类多时逐个类名取样例会拖慢整页。
    # 数据量小的站点仍全量取，保留可读性。
    sample_ids_by_site: dict[int, list[str]] = {}
    sample_all = len(rows) <= 200
    for remote, _site_name, _site_enabled, category_id, _category_name in rows:
        if sample_all or category_id is not None:
            sample_ids_by_site.setdefault(remote.site_id, []).append(remote.remote_id)
    samples_by_site: dict[int, dict[str, list[str]]] = {}
    for site_id, remote_ids in sample_ids_by_site.items():
        samples_by_site[site_id] = await _sample_titles(db, site_id, remote_ids)

    items: list[dict] = []
    for remote, site_name, site_enabled, category_id, category_name in rows:
        sources = usage.get((remote.site_id, str(remote.remote_id)), 0)
        samples = samples_by_site.get(remote.site_id, {}).get(remote.remote_id, [])
        items.append(
            {
                "site_id": remote.site_id,
                "site_name": site_name,
                "site_enabled": site_enabled,
                "remote_id": remote.remote_id,
                "name": remote.name,
                "parent_remote_id": remote.parent_remote_id,
                "parent_name": remote.parent_name,
                "sort": remote.sort,
                "last_seen_at": remote.last_seen_at,
                "stale": remote.last_seen_at != latest.get(remote.site_id),
                "attached_category_id": category_id,
                "attached_category_name": category_name,
                "sources": sources,
                "samples": samples,
            }
        )
    return items


async def refresh_site_remote_categories(db: AsyncSession, site: Site) -> dict:
    """拉取 ac=list 并 upsert 远程分类快照；不删除仍被挂载的旧行。"""
    from app.services.source_client import SourceClient

    async with SourceClient(
        site_id=site.id, base_url=site.base_url, name=site.name
    ) as client:
        data = await client._get({"ac": "list"})
    class_list = data.get("class", [])
    if not isinstance(class_list, list):
        raise ValueError("资源站未返回 class 分类列表")

    parents: dict[str, str] = {}
    for raw in class_list:
        if not isinstance(raw, dict):
            continue
        type_pid = raw.get("type_pid")
        if type_pid in (0, "0"):
            parent_id = str(raw.get("type_id") or raw.get("id") or "")
            parent_name = str(raw.get("type_name") or raw.get("name") or "")
            if parent_id:
                parents[parent_id] = parent_name

    now = _utcnow()
    existing_rows = (
        await db.execute(
            select(SiteRemoteCategory).where(SiteRemoteCategory.site_id == site.id)
        )
    ).scalars().all()
    existing = {row.remote_id: row for row in existing_rows}
    added = updated = 0
    seen_ids: set[str] = set()
    for index, raw in enumerate(class_list):
        if not isinstance(raw, dict):
            continue
        type_pid = raw.get("type_pid")
        if type_pid in (0, "0"):
            continue
        remote_id = str(raw.get("type_id") or raw.get("id") or "")
        name = str(raw.get("type_name") or raw.get("name") or "").strip()
        if not remote_id or not name:
            continue
        parent_remote_id = str(type_pid) if type_pid is not None else None
        parent_name = parents.get(parent_remote_id or "")
        seen_ids.add(remote_id)
        row = existing.get(remote_id)
        if row is None:
            db.add(
                SiteRemoteCategory(
                    site_id=site.id,
                    remote_id=remote_id,
                    name=name,
                    parent_remote_id=parent_remote_id,
                    parent_name=parent_name,
                    sort=index,
                    last_seen_at=now,
                )
            )
            added += 1
        else:
            row.name = name
            row.parent_remote_id = parent_remote_id
            row.parent_name = parent_name
            row.sort = index
            row.last_seen_at = now
            updated += 1

    # 本次未返回、且没有被挂载的旧行没有展示价值；直接清掉。
    if existing_rows:
        await db.execute(
            delete(SiteRemoteCategory).where(
                SiteRemoteCategory.site_id == site.id,
                SiteRemoteCategory.remote_id.notin_(list(seen_ids)),
                ~exists(
                    select(SiteCategoryLink.id).where(
                        SiteCategoryLink.site_id == SiteRemoteCategory.site_id,
                        SiteCategoryLink.remote_id == SiteRemoteCategory.remote_id,
                    )
                ),
            )
        )
    await db.commit()
    return {"added": added, "updated": updated, "total": len(seen_ids)}


async def attach_links(
    db: AsyncSession,
    items: list[dict],
) -> list[tuple[int, str]]:
    """批量挂载；同一 (site_id, remote_id) 已存在时改指，返回受影响键。"""
    if not items:
        return []
    category_ids = {int(item["system_category_id"]) for item in items}
    categories = (
        await db.execute(
            select(SystemCategory).where(SystemCategory.id.in_(category_ids))
        )
    ).scalars().all()
    by_id = {cat.id: cat for cat in categories}
    for category_id in category_ids:
        category = by_id.get(category_id)
        if category is None:
            raise ValueError(f"系统分类 {category_id} 不存在")
        if category.parent_id is None:
            raise ValueError("只能挂到小类，不能挂到大类")

    remote_names = {
        (row.site_id, row.remote_id): row.name
        for row in (
            await db.execute(
                select(SiteRemoteCategory).where(
                    SiteRemoteCategory.site_id.in_({int(i["site_id"]) for i in items})
                )
            )
        ).scalars().all()
    }

    values = []
    touched: list[tuple[int, str]] = []
    for item in items:
        site_id = int(item["site_id"])
        remote_id = str(item["remote_id"])
        category_id = int(item["system_category_id"])
        values.append(
            {
                "site_id": site_id,
                "remote_id": remote_id,
                "remote_name": remote_names.get((site_id, remote_id)),
                "system_category_id": category_id,
            }
        )
        touched.append((site_id, remote_id))
    stmt = pg_insert(SiteCategoryLink).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["site_id", "remote_id"],
        set_={
            "system_category_id": stmt.excluded.system_category_id,
            "remote_name": stmt.excluded.remote_name,
        },
    )
    await db.execute(stmt)
    await db.flush()
    return touched


async def detach_links(db: AsyncSession, items: list[dict]) -> list[tuple[int, str]]:
    touched: list[tuple[int, str]] = []
    for item in items:
        site_id = int(item["site_id"])
        remote_id = str(item["remote_id"])
        result = await db.execute(
            delete(SiteCategoryLink).where(
                SiteCategoryLink.site_id == site_id,
                SiteCategoryLink.remote_id == remote_id,
            )
        )
        if result.rowcount:
            touched.append((site_id, remote_id))
    await db.flush()
    return touched


async def attach_affected_videos(db: AsyncSession, touched: list[tuple[int, str]]) -> int:
    """按站点分组重算受影响视频。"""
    by_site: dict[int, list[str]] = {}
    for site_id, remote_id in touched:
        by_site.setdefault(site_id, []).append(remote_id)
    total = 0
    for site_id, remote_ids in by_site.items():
        total += await recompute_videos_for_site_remotes(db, site_id, remote_ids)
    return total
