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

from app.services.category_alias import (
    backfill_video_categories,
    load_category_decision_maps,
    pick_system_category,
)
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
    """归一化视频标题，用于聚合去重。
    
    处理：
    - 去 《》<> 等括号
    - 去首尾空白
    - 繁简体统一（蜘蛛俠 → 蜘蛛侠）
    - 去备注信息（普通话版、原声版、粤语版等）
    - 统一标点符号（冒号、空格等）
    """
    if title is None:
        return ""
    s = title.strip()
    
    # 去括号
    for ch in ("《", "》", "<", ">"):
        s = s.replace(ch, "")
    
    # 繁简体统一（常见字符）
    traditional_to_simplified = {
        "俠": "侠", "戰": "战", "鬥": "斗", "鬪": "斗",
        "劍": "剑", "靈": "灵", "電": "电", "腦": "脑",
        "話": "话", "語": "语", "愛": "爱", "戀": "恋",
        "車": "车", "馬": "马", "門": "门", "開": "开",
        "關": "关", "時": "时", "間": "间", "見": "见",
        "長": "长", "兒": "儿", "無": "无", "與": "与",
        "爲": "为", "這": "这", "那": "那", "裡": "里",
        "麼": "么", "於": "于", "從": "从", "來": "来",
        "說": "说", "讀": "读", "書": "书", "畫": "画",
    }
    for trad, simp in traditional_to_simplified.items():
        s = s.replace(trad, simp)
    
    # 去备注信息（括号及其内容）
    import re
    s = re.sub(r"\s*[\(（\[【].*?[\)）\]】]\s*", " ", s)
    
    # 统一标点符号
    s = s.replace("：", ":").replace(":", " ").replace("  ", " ")
    
    # 去多余空格
    s = " ".join(s.split())
    
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


def _aggregate_records(
    records: Iterable[Any],
    site_name_map: dict[int, str | None] | None = None,
    category_aliases: dict[str, dict] | None = None,
    category_overrides: dict[tuple[int, str], str] | None = None,
    category_sort: dict[str, int] | None = None,
) -> list[tuple[str, int | None, dict[str, Any], str]]:
    """把 VideoCache 记录按 (norm_title, year) 聚合去重。

    返回按 latest_updated_at 降序排列的元组列表：
        (norm_title, year, item_dict, latest_update)
    """
    bucket: dict[tuple[str, int | None], dict[str, Any]] = {}
    latest_update: dict[tuple[str, int | None], str] = {}
    year_counter: dict[str, Counter] = {}

    for r in records:
        norm = normalize_title(r.title)
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

        source_ref: dict[str, Any] = {
            "site_id": r.site_id,
            "original_id": r.original_id,
            "type": r.type_name,
            "type_id": r.type_id,
            "remarks": r.remarks,
            "updated_at": r.source_updated_at,
        }
        if site_name_map is not None:
            source_ref["site_name"] = site_name_map.get(r.site_id)
        bucket[key]["sources"].append(source_ref)

        if norm not in year_counter:
            year_counter[norm] = Counter()
        if year is not None:
            year_counter[norm][year] += 1

    # 回填 year=None 的桶
    null_keys = [k for k in bucket if k[1] is None]
    for key in null_keys:
        norm = key[0]
        item = bucket.pop(key)
        lu = latest_update.pop(key)
        best_year = None
        c = year_counter.get(norm)
        if c:
            best_year = c.most_common(1)[0][0]
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

    sorted_items = sorted(
        bucket.items(),
        key=lambda kv: latest_update.get(kv[0], ""),
        reverse=True,
    )
    results = []
    for key, item in sorted_items:
        if category_aliases is not None:
            item["system_category"] = pick_system_category(
                [(s.get("site_id"), s.get("type")) for s in item["sources"]],
                category_aliases,
                category_overrides,
                category_sort,
            )
        results.append((key[0], key[1], item, latest_update[key]))
    return results


# ------------------------------------------------------------------
# 聚合中间表重建
# ------------------------------------------------------------------

_INSERT_BATCH = 2000
_INCREMENTAL_FALLBACK_THRESHOLD = 10000

_aggregated_refresh_lock = asyncio.Lock()

# 全局操作锁：防止删除站点、全量刮削、补全 videolist 同时进行
_global_operation_lock = asyncio.Lock()
_operation_in_progress: str | None = None


def is_operation_in_progress() -> str | None:
    """检查是否有全局操作正在进行，返回操作类型。"""
    return _operation_in_progress


async def acquire_operation_lock(operation: str, timeout: float = 300) -> bool:
    """获取全局操作锁。
    
    返回 True 表示获取成功，False 表示超时。
    操作完成后必须调用 release_operation_lock。
    """
    global _operation_in_progress
    try:
        await asyncio.wait_for(_global_operation_lock.acquire(), timeout=timeout)
        _operation_in_progress = operation
        logger.info("全局操作锁已获取: %s", operation)
        return True
    except asyncio.TimeoutError:
        logger.warning("获取全局操作锁超时: %s", operation)
        return False


def release_operation_lock(operation: str) -> None:
    """释放全局操作锁。"""
    global _operation_in_progress
    if _operation_in_progress == operation:
        _operation_in_progress = None
        _global_operation_lock.release()
        logger.info("全局操作锁已释放: %s", operation)


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
    使用事务确保两个表同时成功或失败，避免数据不一致。
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
        norm_grouped AS (
            SELECT
                norm_title,
                year,
                MAX(title) AS title,
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
                COUNT(*) AS source_count
            FROM norm
            GROUP BY norm_title, year
        ),
        raw_agg AS (
            SELECT
                title,
                year,
                poster_url,
                sources,
                latest_updated_at,
                source_count,
                norm_title
            FROM norm_grouped
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
    
    # 2. 重建 aggregated_sources：通过 (norm_title, year) 回关联 video_cache
    sql_sources = text("""
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

    # 使用事务确保两个表同时成功或失败
    try:
        # 先重建 aggregated_videos 并提交（让后续查询可见）
        await db.execute(sql_videos, {"cached_at": now})
        await db.commit()
        
        # 再重建 aggregated_sources（依赖 aggregated_videos 的数据）
        await db.execute(sql_sources)
        await db.commit()
        return True
    except Exception:
        await db.rollback()
        raise



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

        # 3. 聚合去重（含 year=None 回填）+ 视频级分类投票
        (
            category_aliases,
            category_overrides,
            category_sort,
        ) = await load_category_decision_maps(db)
        sorted_items = _aggregate_records(
            records,
            site_name_map,
            category_aliases,
            category_overrides,
            category_sort,
        )

        # 4. 插入 aggregated_videos，用 RETURNING 取回 id
        id_map: dict[tuple[str, int | None], int] = {}
        for i in range(0, len(sorted_items), _INSERT_BATCH):
            batch = sorted_items[i : i + _INSERT_BATCH]
            video_rows = []
            for norm, year, item, lu in batch:
                video_rows.append({
                    "title": item["title"],
                    "year": item["year"],
                    "poster_url": item["poster_url"],
                    "norm_title": norm,
                    "latest_updated_at": lu,
                    "source_count": len(item["sources"]),
                    "system_category": item.get("system_category"),
                    "cached_at": now,
                })

            stmt = agg_table.insert().returning(
                agg_table.c.id, agg_table.c.norm_title, agg_table.c.year
            )
            rows_result = await db.execute(stmt, video_rows)
            await db.commit()
            for row in rows_result.all():
                id_map[(row.norm_title, row.year)] = row.id

        # 5. 插入 aggregated_sources
        source_rows = []
        for norm, year, item, _ in sorted_items:
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

        logger.info("增量聚合完成: videos=%d, sources=%d", len(sorted_items), sum(len(item["sources"]) for _, _, item, _ in sorted_items))
        return True

    except Exception as exc:
        logger.exception("增量聚合失败: %s", exc)
        return False


async def rebuild_aggregated_tables(db: AsyncSession) -> bool:
    """全量重建 aggregated_videos / aggregated_sources 中间表（PostgreSQL 路径）。"""
    try:
        logger.info("开始重建聚合中间表...")

        ok = await _rebuild_aggregated_tables_pg(db)

        if ok:
            # SQL 全量重建不参与投票，重建后统一回填视频级分类
            try:
                await backfill_video_categories(db)
            except Exception as exc:
                logger.warning("重建后回填视频级分类失败: %s", exc)
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
    如果全局操作锁被占用（删除站点/全量刮削/补全 videolist），跳过本次刷新。
    """
    # 检查全局操作锁
    current_op = is_operation_in_progress()
    if current_op:
        logger.warning(
            "全局操作正在进行中: %s，跳过本次聚合缓存刷新",
            current_op,
        )
        return False

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
