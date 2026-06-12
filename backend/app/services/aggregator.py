"""按 (归一title, year) 聚合多源列表（硬契约）。

归一规则：去 《 》 / 首尾空白 / casefold()。
不接 DB；调用方喂数据进来。
"""
from __future__ import annotations

import asyncio
import logging
from collections import Counter
from typing import Any, Iterable

from sqlalchemy import bindparam, delete, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    RecommendedVideo,
    Site,
    SystemCategory,
    VideoCache,
    _utcnow,
)

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
# 聚合中间表重建
# ------------------------------------------------------------------

_INSERT_BATCH = 2000
_INCREMENTAL_FALLBACK_THRESHOLD = 10000

_aggregated_refresh_lock = asyncio.Lock()


async def migrate_video_cache_norm_title(db: AsyncSession) -> None:
    """为 video_cache 添加 norm_title 列并回填（增量聚合前置迁移）。"""
    try:
        from sqlalchemy import inspect as sa_inspect

        cols = await db.run_sync(
            lambda session: [
                c["name"] for c in sa_inspect(session.bind).get_columns("video_cache")
            ]
        )
        if "norm_title" not in cols:
            logger.info("video_cache 缺少 norm_title 列，执行迁移...")
            await db.execute(text("ALTER TABLE video_cache ADD COLUMN norm_title VARCHAR"))
            await db.commit()
            try:
                await db.execute(text("CREATE INDEX ix_video_cache_norm_title ON video_cache(norm_title)"))
                await db.commit()
            except Exception:
                logger.warning("norm_title 索引可能已存在")
        else:
            # 列已存在但可能无索引
            indexes = await db.run_sync(
                lambda session: {
                    idx["name"] for idx in sa_inspect(session.bind).get_indexes("video_cache")
                }
            )
            if "ix_video_cache_norm_title" not in indexes:
                try:
                    await db.execute(text("CREATE INDEX ix_video_cache_norm_title ON video_cache(norm_title)"))
                    await db.commit()
                except Exception:
                    pass

        # 先用 SQL 表达式批量回填 norm_title（比 Python 循环快得多）
        null_count_result = await db.execute(
            select(func.count())
            .select_from(VideoCache)
            .where(VideoCache.norm_title.is_(None))
        )
        null_count = null_count_result.scalar_one()
        if null_count:
            logger.info("video_cache 有 %d 条 norm_title 为空，执行 SQL 批量回填", null_count)
            cleaned = func.trim(
                func.lower(
                    func.replace(
                        func.replace(
                            func.replace(func.replace(VideoCache.title, "《", ""), "》", ""),
                            "<",
                            "",
                        ),
                        ">",
                        "",
                    )
                )
            )
            await db.execute(
                VideoCache.__table__.update()
                .where(VideoCache.__table__.c.norm_title.is_(None))
                .values(norm_title=cleaned)
            )
            await db.commit()

        # 兜底：分批回填 SQL 无法处理的剩余行
        total = 0
        while True:
            rows = await db.execute(
                select(VideoCache.id, VideoCache.title)
                .where(VideoCache.norm_title.is_(None))
                .limit(5000)
            )
            updates = []
            for r in rows.all():
                updates.append({"b_id": r.id, "b_norm_title": normalize_title(r.title)})
            if not updates:
                break
            await db.execute(
                VideoCache.__table__.update()
                .where(VideoCache.__table__.c.id == bindparam("b_id"))
                .values(norm_title=bindparam("b_norm_title")),
                updates,
            )
            await db.commit()
            total += len(updates)
            if len(updates) < 5000:
                break
        if total:
            logger.info("video_cache norm_title 回填完成: %d 条", total)
    except Exception as exc:
        logger.exception("video_cache norm_title 迁移失败: %s", exc)


async def _clear_aggregated_tables(db: AsyncSession) -> None:
    await db.execute(delete(AggregatedSource))
    await db.execute(delete(AggregatedVideoV3))
    await db.commit()


async def _rebuild_aggregated_tables_pg(db: AsyncSession) -> bool:
    """PostgreSQL 优化路径：用 INSERT ... SELECT + CTE 全量重建。

    复用 mv_aggregated_videos 的聚合逻辑，但写入普通表。
    """
    await _clear_aggregated_tables(db)

    now = _utcnow()

    # PostgreSQL 优化器在大量数据聚合时可能触发 mergejoin bug，先禁用
    await db.execute(text("SET LOCAL enable_mergejoin = off"))

    # 1. 重建 aggregated_videos
    sql_videos = text("""
        INSERT INTO aggregated_videos
            (title, year, poster_url, norm_title, latest_updated_at, source_count, cached_at)
        WITH
        norm AS (
            SELECT
                title,
                year,
                poster_url,
                site_id,
                original_id,
                type_name,
                type_id,
                remarks,
                source_updated_at,
                LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')) AS norm_title
            FROM video_cache
        ),
        raw_agg AS (
            SELECT
                title,
                year,
                MAX(poster_url) AS poster_url,
                jsonb_agg(
                    jsonb_build_object(
                        'site_id', site_id,
                        'original_id', original_id,
                        'type', type_name,
                        'type_id', type_id,
                        'remarks', remarks,
                        'updated_at', source_updated_at
                    )
                ) AS sources,
                MAX(source_updated_at) AS latest_updated_at,
                COUNT(*) AS source_count,
                norm_title
            FROM norm
            GROUP BY norm_title, year, title
        ),
        year_freq AS (
            SELECT
                LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')) AS norm_title,
                year,
                COUNT(*) AS freq,
                ROW_NUMBER() OVER (
                    PARTITION BY LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g'))
                    ORDER BY COUNT(*) DESC, year DESC
                ) AS rn
            FROM video_cache
            WHERE year IS NOT NULL
            GROUP BY LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')), year
        ),
        best_year AS (
            SELECT norm_title, year AS best_year
            FROM year_freq
            WHERE rn = 1
        ),
        combined AS (
            SELECT
                a.title,
                COALESCE(a.year, byw.best_year) AS year,
                a.poster_url,
                a.norm_title,
                a.latest_updated_at,
                a.source_count
            FROM raw_agg a
            LEFT JOIN best_year byw ON a.norm_title = byw.norm_title
            WHERE a.year IS NOT NULL OR byw.best_year IS NOT NULL

            UNION ALL

            SELECT
                a.title,
                NULL AS year,
                a.poster_url,
                a.norm_title,
                a.latest_updated_at,
                a.source_count
            FROM raw_agg a
            LEFT JOIN best_year byw ON a.norm_title = byw.norm_title
            WHERE a.year IS NULL AND byw.best_year IS NULL
        )
        SELECT
            title,
            year,
            poster_url,
            norm_title,
            latest_updated_at,
            source_count,
            :cached_at AS cached_at
        FROM combined
    """)
    await db.execute(sql_videos, {"cached_at": now})
    await db.commit()

    # 2. 重建 aggregated_sources：通过 (norm_title, year) 回关联 video_cache
    await db.execute(text("SET LOCAL enable_mergejoin = off"))
    sql_sources = text(f"""
        INSERT INTO aggregated_sources
            (aggregated_video_id, site_id, original_id, site_name, type_name, type_id, remarks, updated_at)
        WITH
        year_freq AS (
            SELECT
                LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')) AS norm_title,
                year,
                COUNT(*) AS freq,
                ROW_NUMBER() OVER (
                    PARTITION BY LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g'))
                    ORDER BY COUNT(*) DESC, year DESC
                ) AS rn
            FROM video_cache
            WHERE year IS NOT NULL
            GROUP BY LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')), year
        ),
        best_year AS (
            SELECT norm_title, year AS best_year
            FROM year_freq
            WHERE rn = 1
        ),
        matched AS (
            SELECT
                av.id AS aggregated_video_id,
                vc.site_id,
                vc.original_id,
                s.name AS site_name,
                vc.type_name,
                vc.type_id,
                vc.remarks,
                vc.source_updated_at AS updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY av.id, vc.site_id, vc.original_id
                    ORDER BY vc.source_updated_at DESC NULLS LAST
                ) AS rn
            FROM video_cache vc
            JOIN aggregated_videos av
                ON LOWER(REGEXP_REPLACE(TRIM(vc.title), '[《》<>]', '', 'g')) = av.norm_title
            JOIN sites s ON s.id = vc.site_id
            LEFT JOIN best_year byw
                ON byw.norm_title = av.norm_title
            WHERE
                (vc.year IS NOT NULL AND av.year = vc.year)
                OR (vc.year IS NULL AND av.year = byw.best_year)
                OR (vc.year IS NULL AND av.year IS NULL AND byw.best_year IS NULL)
        )
        SELECT
            aggregated_video_id,
            site_id,
            original_id,
            site_name,
            type_name,
            type_id,
            remarks,
            updated_at
        FROM matched
        WHERE rn = 1
    """)
    await db.execute(sql_sources)
    await db.commit()

    return True


async def _rebuild_aggregated_tables_python(db: AsyncSession) -> bool:
    """SQLite / 通用路径：Python 流式聚合，按 norm_title 首字符分区控制内存。"""
    await _clear_aggregated_tables(db)

    # 加载站点名称用于来源反规范化
    site_result = await db.execute(select(Site.id, Site.name))
    site_name_map: dict[int, str | None] = {r.id: r.name for r in site_result.all()}

    # 1. 先全局统计 year 频率（轻量，仅 Counter）
    year_counter: dict[str, Counter] = {}
    result = await db.stream(
        select(VideoCache.title, VideoCache.year).order_by(VideoCache.id)
    )
    async for row in result.scalars():
        norm = normalize_title(row.title)
        if norm not in year_counter:
            year_counter[norm] = Counter()
        if row.year is not None:
            year_counter[norm][row.year] += 1
    await result.close()

    def _backfilled_year(norm: str) -> int | None:
        c = year_counter.get(norm)
        return c.most_common(1)[0][0] if c else None

    # 2. 按 norm_title 首字符分区聚合写入
    #    中文字符：按 Unicode 码点分 16 个桶
    def _partition(norm: str) -> int:
        if not norm:
            return 0
        return ord(norm[0]) % 16

    agg_table = AggregatedVideoV3.__table__
    src_table = AggregatedSource.__table__
    now = _utcnow()

    for part in range(16):
        bucket: dict[tuple[str, int | None], dict] = {}
        latest_update: dict[tuple[str, int | None], str] = {}

        result = await db.stream(
            select(VideoCache).order_by(VideoCache.id)
        )
        async for row in result.scalars():
            norm = normalize_title(row.title)
            if _partition(norm) != part:
                continue

            year = row.year
            key = (norm, year)
            if key not in bucket:
                bucket[key] = {
                    "title": row.title,
                    "year": year,
                    "poster_url": row.poster_url,
                    "sources": [],
                }
                latest_update[key] = row.source_updated_at or ""
            else:
                if row.source_updated_at and row.source_updated_at > latest_update[key]:
                    latest_update[key] = row.source_updated_at
                if not bucket[key]["poster_url"] and row.poster_url:
                    bucket[key]["poster_url"] = row.poster_url

            bucket[key]["sources"].append({
                "site_id": row.site_id,
                "site_name": site_name_map.get(row.site_id),
                "original_id": row.original_id,
                "type": row.type_name,
                "type_id": row.type_id,
                "remarks": row.remarks,
                "updated_at": row.source_updated_at,
            })
        await result.close()

        # 回填 year=None
        null_keys = [k for k in bucket if k[1] is None]
        for key in null_keys:
            norm = key[0]
            item = bucket.pop(key)
            lu = latest_update.pop(key)
            best_year = _backfilled_year(norm)
            if best_year is not None:
                new_key = (norm, best_year)
                if new_key not in bucket:
                    bucket[new_key] = {
                        "title": item["title"],
                        "year": best_year,
                        "poster_url": item["poster_url"],
                        "sources": [],
                    }
                    latest_update[new_key] = lu
                else:
                    if lu > latest_update.get(new_key, ""):
                        latest_update[new_key] = lu
                    if not bucket[new_key]["poster_url"] and item["poster_url"]:
                        bucket[new_key]["poster_url"] = item["poster_url"]
                bucket[new_key]["sources"].extend(item["sources"])
            else:
                bucket[key] = item
                latest_update[key] = lu

        # 写入 aggregated_videos
        sorted_items = sorted(
            bucket.items(),
            key=lambda kv: latest_update.get(kv[0], ""),
            reverse=True,
        )

        id_map: dict[tuple[str, int | None], int] = {}
        for i in range(0, len(sorted_items), _INSERT_BATCH):
            batch = sorted_items[i : i + _INSERT_BATCH]
            video_rows = []
            for (norm, year), item in batch:
                video_rows.append({
                    "title": item["title"],
                    "year": item["year"],
                    "poster_url": item["poster_url"],
                    "norm_title": norm,
                    "latest_updated_at": latest_update.get((norm, year)),
                    "source_count": len(item["sources"]),
                    "cached_at": now,
                })
            await db.execute(agg_table.insert(), video_rows)
            await db.commit()

            # 取回 id
            norms = list({norm for (norm, _), _ in batch})
            rows = await db.execute(
                select(AggregatedVideoV3.id, AggregatedVideoV3.norm_title, AggregatedVideoV3.year)
                .where(AggregatedVideoV3.norm_title.in_(norms))
            )
            for r in rows.all():
                id_map[(r.norm_title, r.year)] = r.id

        # 写入 sources
        source_rows = []
        for (norm, year), item in sorted_items:
            vid = id_map.get((norm, year))
            if vid is None:
                continue
            for s in item["sources"]:
                source_rows.append({
                    "aggregated_video_id": vid,
                    "site_id": s["site_id"],
                    "original_id": s["original_id"],
                    "site_name": s.get("site_name"),
                    "type_name": s.get("type"),
                    "type_id": s.get("type_id"),
                    "remarks": s.get("remarks"),
                    "updated_at": s.get("updated_at"),
                })
                if len(source_rows) >= _INSERT_BATCH:
                    await db.execute(src_table.insert(), source_rows)
                    await db.commit()
                    source_rows = []
        if source_rows:
            await db.execute(src_table.insert(), source_rows)
            await db.commit()

        logger.info("聚合中间表分区 %d/16 完成", part + 1)

    return True


async def incrementally_update_aggregated_tables(
    db: AsyncSession, affected_norm_titles: set[str]
) -> bool:
    """增量更新聚合中间表：只重算受影响的 norm_title 组。"""
    if not affected_norm_titles:
        return True

    logger.info("开始增量更新聚合中间表，受影响 norm_title 数量: %d", len(affected_norm_titles))

    try:
        site_result = await db.execute(select(Site.id, Site.name))
        site_name_map: dict[int, str | None] = {r.id: r.name for r in site_result.all()}
        now = _utcnow()
        agg_table = AggregatedVideoV3.__table__
        src_table = AggregatedSource.__table__

        # 1. 删除已有聚合行（级联删 sources）
        await db.execute(
            delete(AggregatedVideoV3).where(
                AggregatedVideoV3.norm_title.in_(list(affected_norm_titles))
            )
        )
        await db.commit()

        # 2. 查询这些 norm_title 的原始记录
        result = await db.execute(
            select(VideoCache).where(VideoCache.norm_title.in_(list(affected_norm_titles)))
        )
        records = result.scalars().all()
        if not records:
            logger.info("增量聚合无对应原始记录，跳过")
            return True

        # 3. 统计 year 频率（用于回填）
        year_counter: dict[str, Counter] = {}
        for r in records:
            norm = r.norm_title
            if norm not in year_counter:
                year_counter[norm] = Counter()
            if r.year is not None:
                year_counter[norm][r.year] += 1

        def _backfilled_year(norm: str) -> int | None:
            c = year_counter.get(norm)
            return c.most_common(1)[0][0] if c else None

        # 4. 按 (norm_title, year) 分组聚合
        bucket: dict[tuple[str, int | None], dict] = {}
        latest_update: dict[tuple[str, int | None], str] = {}
        for r in records:
            norm = r.norm_title
            year = r.year
            key = (norm, year)
            if key not in bucket:
                bucket[key] = {
                    "title": r.title,
                    "year": year,
                    "poster_url": r.poster_url,
                    "sources": [],
                }
                latest_update[key] = r.source_updated_at or ""
            else:
                if r.source_updated_at and r.source_updated_at > latest_update[key]:
                    latest_update[key] = r.source_updated_at
                if not bucket[key]["poster_url"] and r.poster_url:
                    bucket[key]["poster_url"] = r.poster_url

            bucket[key]["sources"].append({
                "site_id": r.site_id,
                "site_name": site_name_map.get(r.site_id),
                "original_id": r.original_id,
                "type": r.type_name,
                "type_id": r.type_id,
                "remarks": r.remarks,
                "updated_at": r.source_updated_at,
            })

        # 5. 回填 year=None 的桶
        null_keys = [k for k in bucket if k[1] is None]
        for key in null_keys:
            norm = key[0]
            item = bucket.pop(key)
            lu = latest_update.pop(key)
            best_year = _backfilled_year(norm)
            if best_year is not None:
                new_key = (norm, best_year)
                if new_key not in bucket:
                    bucket[new_key] = {
                        "title": item["title"],
                        "year": best_year,
                        "poster_url": item["poster_url"],
                        "sources": [],
                    }
                    latest_update[new_key] = lu
                else:
                    if lu > latest_update.get(new_key, ""):
                        latest_update[new_key] = lu
                    if not bucket[new_key]["poster_url"] and item["poster_url"]:
                        bucket[new_key]["poster_url"] = item["poster_url"]
                bucket[new_key]["sources"].extend(item["sources"])
            else:
                bucket[key] = item
                latest_update[key] = lu

        # 6. 插入 aggregated_videos，用 RETURNING 取回 id
        sorted_items = sorted(
            bucket.items(),
            key=lambda kv: latest_update.get(kv[0], ""),
            reverse=True,
        )

        id_map: dict[tuple[str, int | None], int] = {}
        for i in range(0, len(sorted_items), _INSERT_BATCH):
            batch = sorted_items[i : i + _INSERT_BATCH]
            video_rows = []
            for (norm, year), item in batch:
                video_rows.append({
                    "title": item["title"],
                    "year": item["year"],
                    "poster_url": item["poster_url"],
                    "norm_title": norm,
                    "latest_updated_at": latest_update.get((norm, year)),
                    "source_count": len(item["sources"]),
                    "cached_at": now,
                })

            stmt = agg_table.insert().returning(
                agg_table.c.id, agg_table.c.norm_title, agg_table.c.year
            )
            rows_result = await db.execute(stmt, video_rows)
            await db.commit()
            for row in rows_result.all():
                id_map[(row.norm_title, row.year)] = row.id

        # 7. 插入 aggregated_sources
        source_rows = []
        for (norm, year), item in sorted_items:
            vid = id_map.get((norm, year))
            if vid is None:
                continue
            for s in item["sources"]:
                source_rows.append({
                    "aggregated_video_id": vid,
                    "site_id": s["site_id"],
                    "original_id": s["original_id"],
                    "site_name": s.get("site_name"),
                    "type_name": s.get("type"),
                    "type_id": s.get("type_id"),
                    "remarks": s.get("remarks"),
                    "updated_at": s.get("updated_at"),
                })
                if len(source_rows) >= _INSERT_BATCH:
                    await db.execute(src_table.insert(), source_rows)
                    await db.commit()
                    source_rows = []
        if source_rows:
            await db.execute(src_table.insert(), source_rows)
            await db.commit()

        logger.info("增量聚合完成: videos=%d, sources=%d", len(sorted_items), sum(len(item["sources"]) for _, item in sorted_items))
        return True

    except Exception as exc:
        logger.exception("增量聚合失败: %s", exc)
        return False


async def rebuild_aggregated_tables(db: AsyncSession) -> bool:
    """全量重建 aggregated_videos / aggregated_sources 中间表。

    PostgreSQL 使用 INSERT ... SELECT CTE 优化；SQLite 使用 Python 分区聚合。
    """
    try:
        logger.info("开始重建聚合中间表...")

        if _is_postgres(db):
            ok = await _rebuild_aggregated_tables_pg(db)
        else:
            ok = await _rebuild_aggregated_tables_python(db)

        if ok:
            logger.info("聚合中间表重建完成")
        return ok

    except Exception as exc:
        logger.exception("聚合中间表重建失败: %s", exc)
        return False


async def rebuild_recommended_videos(db: AsyncSession) -> bool:
    """轻量重建 recommended_videos 预计算推荐表。

    按父分类分批取 Top N，不再加载全表。
    """
    try:
        logger.info("开始重建推荐中间表...")

        # 获取目标父分类
        parent_result = await db.execute(
            select(SystemCategory.name, SystemCategory.id)
            .where(SystemCategory.parent_id.is_(None))
            .where(SystemCategory.name.in_(["电影", "连续剧", "综艺", "动漫"]))
        )
        parent_info = {r[0]: r[1] for r in parent_result.all()}
        parent_names = list(parent_info.keys())
        if not parent_names:
            logger.warning("未找到目标父分类，跳过推荐表重建")
            return False

        # 子分类 -> 父分类 ID 映射
        child_result = await db.execute(
            select(SystemCategory.name, SystemCategory.parent_id)
            .where(SystemCategory.parent_id.isnot(None))
        )
        child_to_parent_id = {r[0]: r[1] for r in child_result.all()}

        # 按父分类聚合子分类名
        parent_child_names: dict[str, list[str]] = {p: [] for p in parent_names}
        for child_name, parent_id in child_to_parent_id.items():
            for pname, pid in parent_info.items():
                if parent_id == pid:
                    parent_child_names[pname].append(child_name)
                    break

        limits = {"电影": 6, "连续剧": 3, "综艺": 3, "动漫": 3}
        parent_order = {"电影": 1, "连续剧": 2, "综艺": 3, "动漫": 4}

        await db.execute(delete(RecommendedVideo))
        await db.commit()

        insert_rows = []
        for parent_name in sorted(parent_names, key=lambda p: parent_order.get(p, 99)):
            child_names = parent_child_names.get(parent_name, [])
            if not child_names:
                continue
            limit = limits.get(parent_name, 3)

            # 只取该父分类下最新更新的聚合视频（留 2 倍余量过滤）
            subq = (
                select(AggregatedSource.aggregated_video_id)
                .where(AggregatedSource.type_name.in_(child_names))
                .subquery()
            )
            videos = await db.execute(
                select(AggregatedVideoV3)
                .where(AggregatedVideoV3.id.in_(subq))
                .order_by(desc(AggregatedVideoV3.latest_updated_at))
                .limit(limit * 2)
                .options(selectinload(AggregatedVideoV3.sources_rel))
            )

            items: list[dict] = []
            seen: set[tuple[str, str]] = set()
            for v in videos.scalars():
                has_parent = any(
                    child_to_parent_id.get(s.type_name) == parent_info[parent_name]
                    for s in v.sources_rel
                    if s.type_name
                )
                if not has_parent:
                    continue
                key = (v.title, parent_name)
                if key in seen:
                    continue
                seen.add(key)
                items.append({
                    "title": v.title,
                    "year": v.year,
                    "poster_url": v.poster_url,
                    "latest_updated_at": v.latest_updated_at,
                    "source_count": v.source_count,
                    "sources": [
                        {
                            "site_id": s.site_id,
                            "site_name": s.site_name,
                            "original_id": s.original_id,
                            "type": s.type_name,
                            "type_id": s.type_id,
                            "remarks": s.remarks,
                            "updated_at": s.updated_at,
                        }
                        for s in v.sources_rel
                    ],
                    "parent_name": parent_name,
                })
                if len(items) >= limit:
                    break

            for rn, item in enumerate(items, start=1):
                insert_rows.append({
                    "title": item["title"],
                    "year": item["year"],
                    "poster_url": item["poster_url"],
                    "latest_updated_at": item["latest_updated_at"],
                    "source_count": item["source_count"],
                    "sources": item["sources"],
                    "parent_name": item["parent_name"],
                    "rn": rn,
                })

        if insert_rows:
            await db.execute(RecommendedVideo.__table__.insert(), insert_rows)
            await db.commit()

        logger.info("推荐中间表重建完成: items=%d", len(insert_rows))
        return True

    except Exception as exc:
        logger.exception("推荐中间表重建失败: %s", exc)
        return False


# ------------------------------------------------------------------
# 兼容入口：crawler / cleanup 仍调用 refresh_aggregated_view
# ------------------------------------------------------------------

async def refresh_aggregated_view(
    db: AsyncSession, affected_norm_titles: set[str] | None = None
) -> bool:
    """刷新聚合缓存。

    传入 affected_norm_titles 时做增量更新，否则全量重建。
    同一时间只允许一个刷新任务执行。
    """
    async with _aggregated_refresh_lock:
        try:
            if affected_norm_titles:
                if len(affected_norm_titles) >= _INCREMENTAL_FALLBACK_THRESHOLD:
                    logger.info(
                        "受影响 norm_title 数量 %d 超过阈值 %d，降级为全量重建",
                        len(affected_norm_titles),
                        _INCREMENTAL_FALLBACK_THRESHOLD,
                    )
                    ok1 = await rebuild_aggregated_tables(db)
                else:
                    ok1 = await incrementally_update_aggregated_tables(db, affected_norm_titles)
            else:
                ok1 = await rebuild_aggregated_tables(db)

            if not ok1:
                return False
            ok2 = await rebuild_recommended_videos(db)
            return ok2
        except Exception as exc:
            logger.exception("刷新聚合缓存失败: %s", exc)
            return False


# ------------------------------------------------------------------
# 物化视图刷新（fallback，保留兼容）
# ------------------------------------------------------------------

async def refresh_materialized_views(db) -> bool:
    """刷新 PostgreSQL 物化视图 mv_aggregated_videos / mv_recommended_videos。

    当新表逻辑不可用时作为 fallback。
    """
    try:
        # 禁用 mergejoin 避免 PostgreSQL 优化器 bug（"mergejoin input data is out of order"）
        await db.execute(text("SET LOCAL enable_mergejoin = off"))
        await db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_aggregated_videos"))
        await db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_recommended_videos"))
        await db.commit()
        logger.info("物化视图刷新完成")
        return True
    except Exception as exc:
        logger.warning("物化视图并发刷新失败: %s", exc)
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
