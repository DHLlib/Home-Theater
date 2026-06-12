import asyncio
import logging
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import AGGREGATION_RAW_LIMIT_MULTIPLIER
from app.db import get_db
from sqlalchemy.dialects.postgresql import insert as insert_cls
from app.models import (
    _utcnow,
    AggregatedVideo as AggregatedVideoMV,
    AggregatedVideoV3,
    AppConfig,
    RecommendedVideo,
    Site,
    SystemCategory,
    VideoCache,
)
from app.schemas import (
    AggregatedListResponse,
    AggregatedVideo,
    CrawlerLog,
    CrawlerLogsResponse,
    CrawlerStatsResponse,
    DetailRequest,
    DetailResponse,
    FailedSource,
    SiteStat,
    SourceRef,
)
from app.services.aggregator import normalize_title
from app.services.category_mapping import (
    get_site_category_mappings,
    load_all_site_mappings,
)
from app.services.parser import Episode as EpisodeDataclass, parse_episodes
from app.services.resolver import resolve_feifan
import app.services.scheduler as scheduler_module
from app.services.source_client import SourceClient

router = APIRouter(prefix="/videos", tags=["videos"])
logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# 分类禁用过滤：全局缓存（物化视图查询用）
# ------------------------------------------------------------------

_category_filter_cache: tuple[dict, dict, dict] | None = None
_category_filter_cache_ts: float = 0.0
_CATEGORY_FILTER_CACHE_TTL = 60  # 秒


async def _load_category_filter_maps(db: AsyncSession) -> tuple[dict, dict, dict]:
    """加载系统分类和站点分类映射数据用于首页"全部"过滤。

    返回 (system_by_name, system_by_id, site_mappings)。
    结果缓存 60 秒，避免每次分页查询都查 DB。
    """
    global _category_filter_cache, _category_filter_cache_ts
    now = time.monotonic()
    if _category_filter_cache is not None and (now - _category_filter_cache_ts) < _CATEGORY_FILTER_CACHE_TTL:
        return _category_filter_cache

    # 系统分类
    result = await db.execute(select(SystemCategory))
    system_by_name: dict[str, dict] = {}
    system_by_id: dict[int, dict] = {}
    for c in result.scalars().all():
        info = {"id": c.id, "enabled": c.enabled, "parent_id": c.parent_id}
        system_by_name[c.name] = info
        system_by_id[c.id] = info

    # 站点分类映射（中间表优先，带 60 秒缓存）
    site_mappings = await load_all_site_mappings(db)

    _category_filter_cache = (system_by_name, system_by_id, site_mappings)
    _category_filter_cache_ts = now
    return _category_filter_cache


def _video_has_enabled_source(
    sources: list[SourceRef],
    system_by_name: dict[str, dict],
    system_by_id: dict[int, dict],
    site_mappings: dict[int, dict[str, dict]],
) -> bool:
    """检查聚合视频是否至少有一个 source 映射到启用的分类。

    规则（保守策略——无法判断时保留）：
    1. source.type_id 为 None → 保留
    2. 该站点无此 remote_id 的映射 → 保留
    3. 映射 enabled=False → 过滤掉此 source
    4. 映射指向的系统分类不存在 → 保留
    5. 系统分类 enabled=False → 过滤掉此 source
    6. 系统分类的父分类 enabled=False → 过滤掉此 source
    7. 至少一个 source 保留 → 视频保留
    """
    for s in sources:
        type_id = getattr(s, "type_id", None)
        if type_id is None:
            return True

        mappings = site_mappings.get(s.site_id, {})
        mapping = mappings.get(str(type_id))
        if mapping is None:
            return True

        if mapping.get("enabled") is False:
            continue

        sys_cat = system_by_name.get(mapping.get("system_name", ""))
        if sys_cat is None:
            return True

        if sys_cat.get("enabled") is False:
            continue

        parent_id = sys_cat.get("parent_id")
        if parent_id is not None:
            parent = system_by_id.get(parent_id)
            if parent is not None and parent.get("enabled") is False:
                continue

        return True

    return False

# ------------------------------------------------------------------
# 字段过滤 + 移动端检测 + 分页（AC-023）
# ------------------------------------------------------------------

ALLOWED_FIELDS = {"title", "year", "poster_url", "sources"}
MAX_PAGE_SIZE = 100
DEFAULT_DESKTOP_PAGE_SIZE = 20
DEFAULT_MOBILE_PAGE_SIZE = 12


def _filter_fields(items: list[dict], fields: str | None) -> list[dict]:
    """白名单字段过滤。fields 为逗号分隔字段名，非法字段静默忽略。
    无有效字段时返回完整字段（防御性处理）。"""
    if not fields:
        return items

    requested = {f.strip() for f in fields.split(",")}
    valid = requested & ALLOWED_FIELDS
    if not valid:
        return items

    return [{k: v for k, v in item.items() if k in valid} for item in items]


def _detect_mobile(request: Request) -> bool:
    """双轨检测移动端：User-Agent 解析 + device 查询参数。"""
    ua = request.headers.get("User-Agent", "")
    device_param = request.query_params.get("device", "")
    return (
        device_param == "mobile"
        or "Mobile" in ua
        or "Android" in ua
        or "iPhone" in ua
        or "iPad" in ua
    )


def _get_page_size(request: Request, pg_size: int | None) -> int:
    """计算每页条数。pg_size 显式传值优先，其次按设备类型取默认值。"""
    if pg_size is not None:
        return min(max(pg_size, 1), MAX_PAGE_SIZE)
    if _detect_mobile(request):
        return DEFAULT_MOBILE_PAGE_SIZE
    return DEFAULT_DESKTOP_PAGE_SIZE


# ------------------------------------------------------------------
# 分类解析（复用现有逻辑）
# ------------------------------------------------------------------

async def _resolve_remote_categories(
    db: AsyncSession, site: Site, category: str | None
) -> list[str | int]:
    """把统一分类名转回该站点的 remote_id 列表；找不到返回空列表。

    跳过 enabled=False 的映射条目，优先读中间表。
    """
    if not category:
        return []
    results = []
    mappings = await get_site_category_mappings(db, site.id)
    for c in mappings:
        if c.get("enabled") is False:
            continue
        if c.get("name") == category:
            rid = c.get("remote_id")
            if rid is not None:
                results.append(rid)
    return results


# ------------------------------------------------------------------
# 集数后缀归一化（复用现有逻辑）
# ------------------------------------------------------------------

async def _normalize_episode_suffixes(episodes: list[dict]) -> list[dict]:
    """把 feifan 解析为真实 m3u8，360zy 统一为 ffm3u8，与 play.py 保持一致。"""
    if not episodes:
        return episodes

    has_feifan = any(ep.get("suffix") == "feifan" for ep in episodes)
    has_360zy = any(ep.get("suffix") == "360zy" for ep in episodes)

    if not has_feifan and not has_360zy:
        return episodes

    eps = [
        EpisodeDataclass(ep["ep_name"], ep["url"], ep["suffix"], ep["index"])
        for ep in episodes
    ]

    if has_feifan:
        feifan_indices = [i for i, e in enumerate(eps) if e.suffix == "feifan"]
        resolved = await asyncio.gather(
            *[resolve_feifan(eps[i].url) for i in feifan_indices],
            return_exceptions=True,
        )
        for idx, real_url in zip(feifan_indices, resolved):
            if isinstance(real_url, str) and real_url:
                eps[idx] = replace(eps[idx], url=real_url, suffix="ffm3u8")

    for i, e in enumerate(eps):
        if e.suffix == "360zy":
            eps[i] = replace(eps[i], suffix="ffm3u8")

    return [
        {"ep_name": e.ep_name, "url": e.url, "suffix": e.suffix, "index": e.index}
        for e in eps
    ]


# ------------------------------------------------------------------
# 公共查询 + 聚合 + 分页
# ------------------------------------------------------------------

async def _query_and_aggregate(
    db: AsyncSession,
    filters: list[tuple[int, int | None]],
    wd: str | None,
    mode: str,
    pg: int | None = 1,
    per_page: int = DEFAULT_DESKTOP_PAGE_SIZE,
) -> AggregatedListResponse:
    """Query VideoCache with filters/keyword, aggregate dedup, and paginate."""
    if not filters:
        return AggregatedListResponse(items=[], failed_sources=[])

    conditions = []
    for site_id, type_id in filters:
        if type_id is not None:
            conditions.append(
                (VideoCache.site_id == site_id) & (VideoCache.type_id == type_id)
            )
        else:
            conditions.append(VideoCache.site_id == site_id)

    query = select(VideoCache).where(or_(*conditions))
    if wd:
        keyword = wd.strip()
        # ILIKE 搜索：中文友好，无需 tsvector（避免 180 万条数据回填超时）
        query = query.where(VideoCache.title.ilike(f"%{keyword}%"))
    # 按资源站实际更新时间排序（而非缓存写入时间），避免详情回源或
    # 增量刷新导致首页顺序抖动。null 值自然排到最后。
    query = query.order_by(desc(VideoCache.source_updated_at), desc(VideoCache.id))

    # 限制原始记录数，避免全表加载到内存做聚合。
    # 同一视频可能在多站点出现，放大后保证聚合后有足够结果。
    page = pg or 1
    raw_limit = per_page * AGGREGATION_RAW_LIMIT_MULTIPLIER
    raw_offset = (page - 1) * raw_limit
    query = query.limit(raw_limit).offset(raw_offset)

    result = await db.execute(query)
    records = result.scalars().all()

    # 聚合去重（两阶段：先分组，再回填 year=None）
    from collections import Counter

    bucket: dict[tuple[str, int | None], dict] = {}
    latest_update: dict[tuple[str, int | None], str] = {}
    year_counter: dict[str, Counter] = {}

    for r in records:
        norm = normalize_title(r.title)
        key = (norm, r.year)
        if key not in bucket:
            bucket[key] = {
                "title": r.title,
                "year": r.year,
                "poster_url": r.poster_url,
                "sources": [],
            }
            latest_update[key] = r.source_updated_at or ""
        else:
            if r.source_updated_at and r.source_updated_at > latest_update[key]:
                latest_update[key] = r.source_updated_at
            # 同一视频多来源时，优先保留非空封面
            if not bucket[key]["poster_url"] and r.poster_url:
                bucket[key]["poster_url"] = r.poster_url
        source_ref = {
            "site_id": r.site_id,
            "original_id": r.original_id,
            "type": r.type_name,
            "type_id": r.type_id,
            "remarks": r.remarks,
            "updated_at": r.source_updated_at,
        }
        bucket[key]["sources"].append(source_ref)

        if norm not in year_counter:
            year_counter[norm] = Counter()
        if r.year is not None:
            year_counter[norm][r.year] += 1

    # 回填 year=None 的桶
    null_keys = [k for k in bucket if k[1] is None]
    for key in null_keys:
        norm = key[0]
        item = bucket.pop(key)
        lu = latest_update.pop(key)
        best_year = None
        if norm in year_counter and year_counter[norm]:
            best_year = year_counter[norm].most_common(1)[0][0]
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

    # 按资源站最新更新时间倒序排列（与查询 ORDER BY 一致）
    aggregated = sorted(
        bucket.values(),
        key=lambda item: latest_update.get(
            (normalize_title(item["title"]), item["year"]), ""
        ),
        reverse=True,
    )

    # 聚合后取前 per_page 条即可；原始记录的分页已在查询层面完成
    page_items = aggregated[:per_page]

    if mode == "source":
        raw_items = []
        for r in records[:per_page]:
            raw_items.append({
                "title": r.title,
                "year": r.year,
                "poster_url": r.poster_url,
                "sources": [{
                    "site_id": r.site_id,
                    "original_id": r.original_id,
                    "type": r.type_name,
                    "remarks": r.remarks,
                    "updated_at": r.source_updated_at,
                }],
            })
        return AggregatedListResponse(
            items=[AggregatedVideo(**item) for item in raw_items],
            failed_sources=[],
        )

    return AggregatedListResponse(
        items=[AggregatedVideo(**item) for item in page_items],
        failed_sources=[],
    )


# ------------------------------------------------------------------
# 预聚合表双缓冲查询
# ------------------------------------------------------------------

async def _query_aggregated_cache(
    db: AsyncSession,
    pg: int | None = 1,
    per_page: int = DEFAULT_DESKTOP_PAGE_SIZE,
    site_id: int | None = None,
) -> AggregatedListResponse | None:
    """从中间表 aggregated_videos / aggregated_sources 读取预聚合缓存。

    若表为空（首次启动未初始化），返回 None 让调用方 fallback。
    """
    try:
        # 加载分类禁用映射（缓存 60 秒）
        system_by_name, system_by_id, site_mappings = await _load_category_filter_maps(db)

        base_query = select(AggregatedVideoV3)
        count_query = select(func.count()).select_from(AggregatedVideoV3)

        if site_id is not None:
            subq = (
                select(AggregatedSource.aggregated_video_id)
                .where(AggregatedSource.site_id == site_id)
                .subquery()
            )
            base_query = base_query.where(AggregatedVideoV3.id.in_(subq))
            count_query = count_query.where(AggregatedVideoV3.id.in_(subq))

        count_result = await db.execute(count_query)
        count = count_result.scalar_one()
        if count == 0:
            return None

        page = pg or 1
        offset = (page - 1) * per_page

        result = await db.execute(
            base_query.order_by(
                desc(AggregatedVideoV3.latest_updated_at),
                desc(AggregatedVideoV3.id),
            )
            .limit(per_page * 5)
            .offset(offset)
            .options(selectinload(AggregatedVideoV3.sources_rel))
        )
        rows = result.scalars().all()

        items = []
        for r in rows:
            sources = [
                SourceRef(
                    site_id=s.site_id,
                    site_name=s.site_name,
                    original_id=s.original_id,
                    type=s.type_name,
                    type_id=s.type_id,
                    category=None,
                    remarks=s.remarks,
                    updated_at=s.updated_at,
                )
                for s in r.sources_rel
            ]

            # AC-031: 分类禁用过滤——所有 source 都被禁用时整体过滤
            if not _video_has_enabled_source(
                sources, system_by_name, system_by_id, site_mappings
            ):
                continue

            # site_id 已在 SQL 层过滤，这里做双重保险
            if site_id is not None:
                sources = _filter_sources_by_site_id(sources, site_id)

            items.append(
                AggregatedVideo(
                    title=r.title,
                    year=r.year,
                    poster_url=r.poster_url,
                    sources=sources,
                    source_count=len(sources),
                )
            )
            if len(items) >= per_page:
                break

        return AggregatedListResponse(items=items, failed_sources=[])
    except Exception:
        # 表未初始化或异常时 fallback
        return None


# ------------------------------------------------------------------
# JSONB sources 按 site_id 过滤
# ------------------------------------------------------------------

def _filter_sources_by_site_id(sources: list[SourceRef], site_id: int | None) -> list[SourceRef]:
    """Python 端按 site_id 过滤 sources（双重保险）。"""
    if site_id is None:
        return sources
    return [s for s in sources if s.site_id == site_id]


# ------------------------------------------------------------------
# 列表 API（改为本地查询）
# ------------------------------------------------------------------

@router.get("")
async def list_videos(
    request: Request,
    t: int | str | None = None,
    pg: int | None = 1,
    by: str | None = None,
    category: str | None = None,
    mode: str = "aggregated",
    fields: str | None = None,
    pg_size: int | None = None,
    site_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """从本地 VideoCache 查询并按分类聚合去重。"""
    start = time.monotonic()
    is_mobile = _detect_mobile(request)
    per_page = _get_page_size(request, pg_size)
    logger.info("api_list_videos category=%s pg=%s mode=%s mobile=%s per_page=%s", category, pg, mode, is_mobile, per_page)

    # 无分类 / 无 t / 聚合模式：优先走预聚合缓存表（O(1) 查询）
    if not category and t is None and mode == "aggregated":
        agg_response = await _query_aggregated_cache(db, pg, per_page, site_id)
        if agg_response is not None:
            # fields 字段过滤
            raw_items = [item.model_dump() for item in agg_response.items]
            filtered = _filter_fields(raw_items, fields)
            agg_response.items = [AggregatedVideo(**item) for item in filtered]
            elapsed = time.monotonic() - start
            logger.info("api_list_videos_agg items=%d elapsed=%.3fs", len(agg_response.items), elapsed)
            return agg_response
        # 预聚合表为空（首次启动未初始化），fallback 到原路径

    result = await db.execute(
        select(Site).where(Site.enabled.is_(True)).order_by(Site.sort)
    )
    sites = result.scalars().all()

    # 分类回退：若子分类无映射，尝试查找其父分类的映射
    fallback_category: str | None = None
    if category:
        parent_result = await db.execute(
            select(SystemCategory.parent_id).where(SystemCategory.name == category)
        )
        parent_id = parent_result.scalar_one_or_none()
        if parent_id:
            parent_name_result = await db.execute(
                select(SystemCategory.name).where(SystemCategory.id == parent_id)
            )
            fallback_category = parent_name_result.scalar_one_or_none()

    # 构建 (site_id, type_id) 过滤条件
    filters = []
    for site in sites:
        if category:
            remote_cats = await _resolve_remote_categories(db, site, category)
            # 子分类无映射时回退到父分类
            if not remote_cats and fallback_category:
                remote_cats = await _resolve_remote_categories(db, site, fallback_category)
            if not remote_cats:
                continue
            for rid in remote_cats:
                filters.append((site.id, int(rid) if isinstance(rid, str) and rid.isdigit() else rid))
        elif t is not None:
            filters.append((site.id, int(t) if isinstance(t, str) and t.isdigit() else t))
        else:
            # 不指定分类：该站点全部
            filters.append((site.id, None))

    response = await _query_and_aggregate(db, filters, None, mode, pg, per_page)

    # fields 字段过滤（AC-023）
    raw_items = [item.model_dump() for item in response.items]
    filtered = _filter_fields(raw_items, fields)
    response.items = [AggregatedVideo(**item) for item in filtered]

    elapsed = time.monotonic() - start
    logger.info("api_list_videos_done items=%d elapsed=%.2fs", len(response.items), elapsed)
    return response


# ------------------------------------------------------------------
# 推荐视频 API
# ------------------------------------------------------------------

@router.get("/recommended")
async def recommended_videos(db: AsyncSession = Depends(get_db)) -> AggregatedListResponse:
    """推荐视频：从预计算推荐中间表读取 6+3+3+3 条。"""
    try:
        result = await db.execute(
            select(RecommendedVideo).order_by(RecommendedVideo.id)
        )
        rows = result.scalars().all()
    except Exception as exc:
        logger.warning("recommended_videos query failed: %s", exc)
        return AggregatedListResponse(items=[], failed_sources=[])

    items = []
    for r in rows:
        sources = [SourceRef(**s) for s in (r.sources or [])]
        items.append(
            AggregatedVideo(
                title=r.title,
                year=r.year,
                poster_url=r.poster_url,
                sources=sources,
                source_count=r.source_count,
            )
        )

    # 兜底：对 poster_url 为空的记录，从 video_cache 补充非空封面
    missing_posters = [
        (i, item.title, item.year)
        for i, item in enumerate(items)
        if not item.poster_url
    ]
    if missing_posters:
        titles = list({t for _, t, _ in missing_posters})
        poster_result = await db.execute(
            select(VideoCache.title, VideoCache.year, VideoCache.poster_url).where(
                VideoCache.title.in_(titles),
                VideoCache.poster_url.isnot(None),
                VideoCache.poster_url != "",
            )
        )
        poster_map: dict[tuple[str, int | None], str] = {}
        for pr in poster_result.all():
            key = (pr.title, pr.year)
            if key not in poster_map:
                poster_map[key] = pr.poster_url

        for i, title, year in missing_posters:
            poster = poster_map.get((title, year))
            if not poster:
                for (t, _), p in poster_map.items():
                    if t == title:
                        poster = p
                        break
            if poster:
                items[i] = AggregatedVideo(
                    title=items[i].title,
                    year=items[i].year,
                    poster_url=poster,
                    sources=items[i].sources,
                    source_count=items[i].source_count,
                )

    return AggregatedListResponse(items=items, failed_sources=[])


# ------------------------------------------------------------------
# 搜索 API（改为本地 LIKE）
# ------------------------------------------------------------------

@router.get("/search")
async def search_videos(
    request: Request,
    wd: str,
    pg: int | None = 1,
    category: str | None = None,
    mode: str = "aggregated",
    fields: str | None = None,
    pg_size: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """本地 VideoCache LIKE 搜索。"""
    start = time.monotonic()
    if not wd or not wd.strip():
        raise HTTPException(status_code=400, detail="搜索词不能为空")

    per_page = _get_page_size(request, pg_size)
    logger.info("api_search_videos wd=%s category=%s pg=%s mode=%s per_page=%s", wd, category, pg, mode, per_page)

    result = await db.execute(
        select(Site).where(Site.enabled.is_(True)).order_by(Site.sort)
    )
    sites = result.scalars().all()

    # 分类过滤（同 list_videos）
    filters = []
    for site in sites:
        if category:
            remote_cats = await _resolve_remote_categories(db, site, category)
            if not remote_cats:
                continue
            for rid in remote_cats:
                filters.append((site.id, int(rid) if isinstance(rid, str) and rid.isdigit() else rid))
        else:
            filters.append((site.id, None))

    response = await _query_and_aggregate(db, filters, wd, mode, pg, per_page)

    # fields 字段过滤（AC-023）
    raw_items = [item.model_dump() for item in response.items]
    filtered = _filter_fields(raw_items, fields)
    response.items = [AggregatedVideo(**item) for item in filtered]

    elapsed = time.monotonic() - start
    logger.info("api_search_videos_done items=%d elapsed=%.2fs", len(response.items), elapsed)
    return response


# ------------------------------------------------------------------
# 详情 API（优先读缓存，未命中再实时请求）
# ------------------------------------------------------------------

@router.post("/detail")
async def video_detail(
    req: DetailRequest,
    db: AsyncSession = Depends(get_db),
    site_id: int | None = None,
):
    start = time.monotonic()

    # 回退：sources 为空时按 title+year 查 VideoCache 补全
    sources = req.sources
    if not sources and req.title:
        cache_q = select(VideoCache).where(VideoCache.title == req.title)
        if req.year is not None:
            cache_q = cache_q.where(VideoCache.year == req.year)
        # AC-033: 如有 site_id 过滤需求，在查询层面过滤
        if site_id is not None:
            cache_q = cache_q.where(VideoCache.site_id == site_id)
        cache_result = await db.execute(cache_q)
        sources = [
            SourceRef(site_id=r.site_id, original_id=r.original_id)
            for r in cache_result.scalars().all()
        ]

    # AC-033: 对传入的 sources 也支持按 site_id 过滤
    sources = _filter_sources_by_site_id(sources, site_id)

    logger.info("api_video_detail title=%s year=%s sources=%d", req.title, req.year, len(sources))

    result = await db.execute(
        select(Site).where(Site.id.in_([s.site_id for s in sources]))
    )
    sites = {s.id: s for s in result.scalars().all()}

    # 缓存过期时间：7 天
    CACHE_TTL_DAYS = 7
    expire_threshold = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=CACHE_TTL_DAYS)

    async def fetch_one(source_ref):
        site = sites.get(source_ref.site_id)
        if not site:
            return None, None, FailedSource(
                site_id=source_ref.site_id,
                site_name=None,
                error="site not found",
            )

        # 1. 查缓存
        cached_result = await db.execute(
            select(VideoCache).where(
                VideoCache.site_id == source_ref.site_id,
                VideoCache.original_id == source_ref.original_id,
            )
        )
        cached = cached_result.scalar_one_or_none()

        # 缓存有效条件：有 play_url_raw 且未过期
        cache_valid = (
            cached
            and cached.play_url_raw
            and cached.cached_at
            and cached.cached_at > expire_threshold
        )

        if cache_valid:
            episodes = []
            try:
                parsed = parse_episodes(cached.play_url_raw)
                episodes = [
                    {"ep_name": e.ep_name, "url": e.url, "suffix": e.suffix, "index": e.index}
                    for e in parsed
                ]
            except ValueError:
                pass
            return {
                "site_id": cached.site_id,
                "site_name": site.name,
                "original_id": cached.original_id,
                "title": cached.title,
                "year": cached.year,
                "poster_url": cached.poster_url,
                "intro": cached.intro,
                "area": cached.area,
                "actors": cached.actors,
                "director": cached.director,
                "episodes": episodes,
            }, None, None

        # 2. 缓存未命中或过期，实时请求
        async with SourceClient(
            site_id=site.id, base_url=site.base_url, name=site.name
        ) as client:
            try:
                items = await client.videolist(ids=[source_ref.original_id], op="detail_resolve")
                if not items:
                    return None, None, FailedSource(
                        site_id=site.id,
                        site_name=site.name,
                        error="empty detail response",
                    )
                item = items[0]
                play_raw = item.get("play_url_raw", "")
                episodes = []
                if play_raw:
                    try:
                        episodes = parse_episodes(play_raw)
                    except ValueError as exc:
                        return None, None, FailedSource(
                            site_id=site.id,
                            site_name=site.name,
                            error=f"parse error: {exc}",
                        )

                data = {
                    "site_id": site.id,
                    "site_name": site.name,
                    "original_id": source_ref.original_id,
                    "title": item.get("title", ""),
                    "year": item.get("year"),
                    "poster_url": item.get("poster_url"),
                    "intro": item.get("intro"),
                    "area": item.get("area"),
                    "actors": item.get("actors"),
                    "director": item.get("director"),
                    "episodes": [
                        {"ep_name": e.ep_name, "url": e.url, "suffix": e.suffix, "index": e.index}
                        for e in episodes
                    ],
                }
                cache_entry = {
                    "site_id": site.id,
                    "original_id": source_ref.original_id,
                    "title": item.get("title", ""),
                    "year": item.get("year"),
                    "poster_url": item.get("poster_url"),
                    "intro": item.get("intro"),
                    "area": item.get("area"),
                    "actors": item.get("actors"),
                    "director": item.get("director"),
                    "play_url_raw": play_raw,
                    "source_updated_at": item.get("updated_at"),
                    "cached_at": _utcnow(),
                    "has_detail": True,
                }
                return data, cache_entry, None
            except Exception as exc:
                return None, None, FailedSource(
                    site_id=site.id,
                    site_name=site.name,
                    error=str(exc),
                )

    tasks = [fetch_one(s) for s in sources]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    sources = []
    cache_entries = []
    failed_sources = []
    for raw in results:
        if isinstance(raw, Exception):
            continue
        data, cache_entry, error = raw
        if error:
            failed_sources.append(error.model_dump())
        if data:
            if data.get("episodes"):
                data["episodes"] = await _normalize_episode_suffixes(data["episodes"])
            sources.append(data)
        if cache_entry:
            cache_entries.append(cache_entry)

    # 统一写入缓存（upsert）
    for entry in cache_entries:
        stmt = insert_cls(VideoCache).values(**entry)
        set_ = {
            "title": entry["title"],
            "year": entry["year"],
            "poster_url": entry["poster_url"],
            "intro": entry["intro"],
            "area": entry["area"],
            "actors": entry["actors"],
            "director": entry["director"],
            "play_url_raw": entry["play_url_raw"],
            "cached_at": entry["cached_at"],
            "has_detail": True,
        }
        # 避免 videolist 未返回 updated_at 时把已有值覆盖为 None
        if entry.get("source_updated_at"):
            set_["source_updated_at"] = entry["source_updated_at"]
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_=set_,
        )
        await db.execute(stmt)
    if cache_entries:
        await db.commit()
        await _evict_video_cache_overflow(db)

    if not sources and failed_sources:
        raise HTTPException(status_code=502, detail="all sources failed")

    elapsed = time.monotonic() - start
    logger.info(
        "api_video_detail_done title=%s sources=%d failed=%d cached=%d elapsed=%.2fs",
        req.title, len(sources), len(failed_sources), len(cache_entries), elapsed,
    )
    return DetailResponse(
        title=req.title,
        year=req.year,
        sources=sources,
    )


# ------------------------------------------------------------------
# 刮削状态 API
# ------------------------------------------------------------------

@router.get("/crawler/status")
async def crawler_status():
    """返回刮削器当前状态。"""
    if scheduler_module.crawler is None:
        return {"running": False, "sites": {}}
    return scheduler_module.crawler.get_status()


# ------------------------------------------------------------------
# 手动触发全量/增量更新 API
# ------------------------------------------------------------------

@router.post("/crawler/full")
async def trigger_full():
    """手动触发所有站点的全量刮削。"""
    if scheduler_module.crawler is None:
        raise HTTPException(status_code=503, detail="刮削器未启动")
    asyncio.create_task(scheduler_module.crawler.run_full_crawl())
    return {"message": "全量刮削已启动"}


@router.post("/crawler/incremental/{site_id}")
async def trigger_incremental(site_id: int):
    """手动触发指定站点的增量更新。"""
    if scheduler_module.crawler is None:
        raise HTTPException(status_code=503, detail="刮削器未启动")
    asyncio.create_task(scheduler_module.crawler.run_incremental(site_id))
    return {"message": f"站点 {site_id} 增量更新已启动"}


# ------------------------------------------------------------------
# 刮削统计 API
# ------------------------------------------------------------------

@router.get("/crawler/stats")
async def crawler_stats(db: AsyncSession = Depends(get_db)) -> CrawlerStatsResponse:
    """返回刮削统计数据。优先读预计算缓存（O(1)），缓存不存在则实时计算。"""
    import json

    from app.models import AppConfig

    STATS_KEY = "crawler_stats"

    # 1. 先读预计算缓存
    cache_result = await db.execute(
        select(AppConfig).where(AppConfig.key == STATS_KEY)
    )
    cache_row = cache_result.scalar_one_or_none()
    if cache_row:
        try:
            data = json.loads(cache_row.value)
            by_site_raw = data.get("by_site", [])
            by_site = [
                SiteStat(
                    site_id=s["site_id"],
                    site_name=s["site_name"],
                    count=s["count"],
                    with_detail=s["with_detail"],
                    without_detail=s.get("without_detail", s["count"] - s["with_detail"]),
                )
                for s in by_site_raw
            ]

            # 读取历史趋势数据
            history_result = await db.execute(
                select(AppConfig).where(AppConfig.key == "crawler_stats_history")
            )
            history_row = history_result.scalar_one_or_none()
            history = []
            if history_row:
                try:
                    history_raw = json.loads(history_row.value)
                    if isinstance(history_raw, list):
                        history = [
                            {"ts": h["ts"], "total": h["total"], "with_detail": h["with_detail"]}
                            for h in history_raw
                        ]
                except (json.JSONDecodeError, KeyError):
                    pass

            return CrawlerStatsResponse(
                total=data.get("total", 0),
                by_site=by_site,
                with_detail=data.get("with_detail", 0),
                last_updated_at=data.get("last_updated_at"),
                history=history,
                computed_at=data.get("computed_at"),
            )
        except (json.JSONDecodeError, KeyError):
            pass  # 缓存损坏，fallback 到实时查询

    # 2. Fallback：实时计算（首次或缓存损坏时）
    from sqlalchemy import case, func

    site_result = await db.execute(
        select(
            VideoCache.site_id,
            func.count().label("cnt"),
            func.sum(case((VideoCache.has_detail.is_(True), 1), else_=0)).label(
                "detail_cnt"
            ),
        )
        .group_by(VideoCache.site_id)
    )
    site_rows = site_result.all()

    site_ids = [r.site_id for r in site_rows]
    site_map: dict[int, str] = {}
    if site_ids:
        sites_result = await db.execute(
            select(Site.id, Site.name).where(Site.id.in_(site_ids))
        )
        site_map = {sid: name for sid, name in sites_result.all()}

    by_site = [
        SiteStat(
            site_id=r.site_id,
            site_name=site_map.get(r.site_id, f"站点 {r.site_id}"),
            count=r.cnt,
            with_detail=int(r.detail_cnt or 0),
            without_detail=r.cnt - int(r.detail_cnt or 0),
        )
        for r in site_rows
    ]

    global_result = await db.execute(
        select(
            func.count().label("total"),
            func.sum(case((VideoCache.has_detail.is_(True), 1), else_=0)).label(
                "with_detail"
            ),
            func.max(VideoCache.source_updated_at).label("last_updated"),
        ).select_from(VideoCache)
    )
    global_row = global_result.one()

    # fallback 时也尝试读取历史数据
    history_result = await db.execute(
        select(AppConfig).where(AppConfig.key == "crawler_stats_history")
    )
    history_row = history_result.scalar_one_or_none()
    history = []
    if history_row:
        try:
            history_raw = json.loads(history_row.value)
            if isinstance(history_raw, list):
                history = [
                    {"ts": h["ts"], "total": h["total"], "with_detail": h["with_detail"]}
                    for h in history_raw
                ]
        except (json.JSONDecodeError, KeyError):
            pass

    return CrawlerStatsResponse(
        total=global_row.total or 0,
        by_site=by_site,
        with_detail=int(global_row.with_detail or 0),
        last_updated_at=global_row.last_updated,
        history=history,
        computed_at=datetime.now(timezone.utc).isoformat(),
    )


# ------------------------------------------------------------------
# 刮削日志 API
# ------------------------------------------------------------------

@router.get("/crawler/logs")
async def crawler_logs() -> CrawlerLogsResponse:
    """返回最近 50 条刮削日志。"""
    if scheduler_module.crawler is None:
        return CrawlerLogsResponse(logs=[])
    raw_logs = scheduler_module.crawler.get_logs()
    logs = [CrawlerLog(**log) for log in raw_logs]
    return CrawlerLogsResponse(logs=logs)


async def _evict_video_cache_overflow(db) -> None:
    """取消 LRU 淘汰：本机/局域网部署，磁盘空间不是瓶颈，完整保留刮削数据。"""
    pass


# ------------------------------------------------------------------
# 清除失效资源（videolist 验证返回 total=0）
# ------------------------------------------------------------------

@router.post("/cleanup-expired")
async def cleanup_expired(
    site_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """清除失效视频缓存：向资源站 videolist 验证，返回 total=0 的视频视为已失效。

    限制：每个站点最多检查 2000 条，避免超时。
    """
    import httpx
    from app.services.aggregator import refresh_aggregated_view

    if site_id:
        site_result = await db.execute(select(Site).where(Site.id == site_id))
    else:
        site_result = await db.execute(select(Site).where(Site.enabled.is_(True)))
    sites = site_result.scalars().all()

    total_deleted = 0
    total_checked = 0
    by_site = []

    BATCH_SIZE = 20
    MAX_PER_SITE = 2000

    async with httpx.AsyncClient(timeout=30) as client:
        for site in sites:
            video_result = await db.execute(
                select(VideoCache.original_id)
                .where(VideoCache.site_id == site.id)
                .order_by(VideoCache.id)
                .limit(MAX_PER_SITE)
            )
            ids = [r[0] for r in video_result.all()]
            if not ids:
                continue

            expired_ids = []
            for i in range(0, len(ids), BATCH_SIZE):
                batch = ids[i : i + BATCH_SIZE]
                ids_str = ",".join(str(x) for x in batch)
                url = f"{site.base_url.rstrip('/')}?ac=videolist&ids={ids_str}"
                try:
                    resp = await client.get(url)
                    data = resp.json()
                    returned_ids = {
                        str(item.get("vod_id", "")) for item in data.get("list", [])
                    }
                    for vid in batch:
                        if str(vid) not in returned_ids:
                            expired_ids.append(str(vid))
                except Exception:
                    continue

            if expired_ids:
                await db.execute(
                    delete(VideoCache).where(
                        VideoCache.site_id == site.id,
                        VideoCache.original_id.in_(expired_ids),
                    )
                )
                await db.commit()
                total_deleted += len(expired_ids)

            total_checked += len(ids)
            by_site.append(
                {
                    "site_id": site.id,
                    "site_name": site.name,
                    "checked": len(ids),
                    "deleted": len(expired_ids),
                }
            )

    if total_deleted > 0:
        await refresh_aggregated_view(db)

    return {"deleted": total_deleted, "checked": total_checked, "by_site": by_site}


# ------------------------------------------------------------------
# 清理缓存 API（保留）
# ------------------------------------------------------------------

@router.delete("/cache")
async def clear_video_cache(db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(VideoCache))
    await db.commit()
    return {"deleted": result.rowcount}
