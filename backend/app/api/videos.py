import asyncio
import logging
import time
from dataclasses import replace
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from app.errors import crawler_not_running, validation_error
from sqlalchemy import delete, desc, exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import AGGREGATION_RAW_LIMIT_MULTIPLIER
from app.db import async_session_factory, get_db
from sqlalchemy.dialects.postgresql import insert as insert_cls
from app.models import (
    _utcnow,
    AggregatedSource,
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
    FillVideolistRequest,
    FillVideolistResponse,
    SiteStat,
    SourceRef,
)
from app.services.aggregator import _aggregate_records, normalize_title, refresh_aggregated_view
from app.services.category_alias import (
    load_aliases,
    normalize_category_name,
    resolve_remote_names,
)
from app.services.smart_matcher import _is_adult, _match_one
from app.services.category_mapping import (
    get_site_category_mappings,
    load_all_site_mappings,
)
from app.services.parser import Episode as EpisodeDataclass, parse_episodes
from app.services.resolver import resolve_share_page
import app.services.scheduler as scheduler_module
from app.services.source_client import SourceClient

router = APIRouter(prefix="/videos", tags=["videos"])
logger = logging.getLogger(__name__)

# 伪分类名：视频级分类为空（没有任何来源命中别名）时使用
UNCATEGORIZED_CATEGORY = "未分类"


async def _disabled_site_ids(db: AsyncSession) -> list[int]:
    """被禁用的站点 id（禁用即从分类/首页隐藏其内容）。"""
    result = await db.execute(select(Site.id).where(Site.enabled.is_(False)))
    return [row[0] for row in result.all()]


def _hidden_video_subquery(disabled_ids: list[int]):
    """只能由禁用站点提供的视频子查询。"""
    from sqlalchemy.orm import aliased

    other = aliased(AggregatedSource)
    return (
        select(AggregatedSource.aggregated_video_id)
        .where(AggregatedSource.site_id.in_(disabled_ids))
        .where(
            ~exists(
                select(other.id).where(
                    other.aggregated_video_id == AggregatedSource.aggregated_video_id,
                    other.site_id.notin_(disabled_ids),
                )
            )
        )
        .distinct()
    )


# 隐藏集合缓存：禁用/启用站点时主动失效，另有 60 秒兜底 TTL
_hidden_cache: tuple[float, list[int]] | None = None
_HIDDEN_CACHE_TTL = 60.0
# 超过这个数量就退回子查询，避免 IN (...) 参数过多
_HIDDEN_ID_LIMIT = 10_000


def invalidate_hidden_video_cache() -> None:
    global _hidden_cache
    _hidden_cache = None


async def _hidden_video_filter(db: AsyncSession):
    """禁用站点的隐藏过滤条件：id 列表（有缓存）或子查询；无禁用站点返回 None。"""
    global _hidden_cache

    disabled_ids = await _disabled_site_ids(db)
    if not disabled_ids:
        _hidden_cache = None
        return None

    now = time.monotonic()
    if _hidden_cache is not None and (now - _hidden_cache[0]) < _HIDDEN_CACHE_TTL:
        hidden_ids = _hidden_cache[1]
    else:
        result = await db.execute(_hidden_video_subquery(disabled_ids))
        hidden_ids = [row[0] for row in result.all()]
        _hidden_cache = (now, hidden_ids)

    if not hidden_ids:
        return None
    if len(hidden_ids) <= _HIDDEN_ID_LIMIT:
        return hidden_ids
    return _hidden_video_subquery(disabled_ids)

# ------------------------------------------------------------------
# 分类禁用过滤：全局缓存（物化视图查询用）
# ------------------------------------------------------------------

_category_filter_cache: tuple[dict, dict, dict] | None = None
_category_filter_cache_ts: float = 0.0
_CATEGORY_FILTER_CACHE_TTL = 60  # 秒


# 分类计数缓存：分类栏每次挂载都会请求，全表 GROUP BY 需要 120ms
_category_stats_cache: dict | None = None
_category_stats_cache_ts: float = 0.0
_CATEGORY_STATS_TTL = 60.0


def invalidate_category_stats_cache() -> None:
    global _category_stats_cache, _category_stats_cache_ts
    _category_stats_cache = None
    _category_stats_cache_ts = 0.0

def invalidate_category_filter_cache() -> None:
    """立即作废分类过滤缓存。系统分类变更后由 system_categories 调用。

    注意：缓存全局变量定义在本模块，跨模块清缓存必须经由本函数（或模块引用
    赋值），不能在其它模块用 `global _category_filter_cache` —— 那只会在该
    模块命名空间新建同名变量，碰不到这里的真正缓存。
    """
    global _category_filter_cache, _category_filter_cache_ts
    _category_filter_cache = None
    _category_filter_cache_ts = 0.0
    invalidate_category_stats_cache()



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


async def _enrich_poster_urls(
    db: AsyncSession, items: list[AggregatedVideo]
) -> None:
    """为聚合结果补充多源封面 URL 列表，用于前端 fallback。"""
    if not items:
        return

    titles = list({item.title for item in items})
    result = await db.execute(
        select(VideoCache.title, VideoCache.poster_url).where(
            VideoCache.title.in_(titles),
            VideoCache.poster_url.isnot(None),
            VideoCache.poster_url != "",
        )
    )

    poster_map: dict[str, list[str]] = {}
    for title, poster_url in result.all():
        if title not in poster_map:
            poster_map[title] = []
        if poster_url not in poster_map[title]:
            poster_map[title].append(poster_url)

    for item in items:
        urls = poster_map.get(item.title, [])
        item.poster_urls = urls
        # 若主 poster_url 为空，取第一个可用 fallback
        if urls and not item.poster_url:
            item.poster_url = urls[0]


# ------------------------------------------------------------------
# 分类解析（复用现有逻辑）
# ------------------------------------------------------------------

async def _resolve_category_aliases(
    db: AsyncSession, category: str, expand_children: bool = True
) -> tuple[set[str], list[str]]:
    """系统分类名 → (启用的系统分类名集合, 远程类名列表)。

    与旧的 _resolve_remote_categories 不同：别名是**全局**的，不区分站点。
    实测 98 个远程类名覆盖了 21 个站点的 805 条映射，新站点命中别名即自动生效。
    """
    target = {category}
    if expand_children:
        parent_id = (
            await db.execute(
                select(SystemCategory.id).where(
                    SystemCategory.name == category,
                    SystemCategory.parent_id.is_(None),
                )
            )
        ).scalar_one_or_none()
        if parent_id is not None:
            children = await db.execute(
                select(SystemCategory.name).where(
                    SystemCategory.parent_id == parent_id,
                    SystemCategory.enabled.is_(True),
                )
            )
            target |= {row[0] for row in children.all()}

    enabled_rows = await db.execute(
        select(SystemCategory.name).where(
            SystemCategory.name.in_(target),
            SystemCategory.enabled.is_(True),
        )
    )
    enabled = {row[0] for row in enabled_rows.all()}
    if not enabled:
        return set(), []

    return enabled, await resolve_remote_names(db, enabled)


async def _resolve_remote_categories(
    db: AsyncSession, site: Site, category: str | None, expand_children: bool = True
) -> list[str | int]:
    """把统一分类名转回该站点的 remote_id 列表；找不到返回空列表。

    跳过 enabled=False 的映射条目，优先读中间表。
    如果 category 是父分类（如"电影"）且 expand_children=True，自动展开为其所有启用的子分类名进行匹配。
    当 expand_children=False 时，即使 category 是父分类也只匹配其本身，不展开子分类。
    """
    if not category:
        return []
    target_names = {category}
    # 若 category 是父分类且允许展开，展开为其所有启用的子分类名
    if expand_children:
        parent_result = await db.execute(
            select(SystemCategory.id).where(SystemCategory.name == category, SystemCategory.parent_id.is_(None))
        )
        parent_id = parent_result.scalar_one_or_none()
        if parent_id is not None:
            child_result = await db.execute(
                select(SystemCategory.name).where(
                    SystemCategory.parent_id == parent_id,
                    SystemCategory.enabled.is_(True),
                )
            )
            target_names.update({row[0] for row in child_result.all()})

    results = []
    mappings = await get_site_category_mappings(db, site.id)
    for c in mappings:
        if c.get("enabled") is False:
            continue
        if c.get("name") in target_names:
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
            *[resolve_share_page(eps[i].url) for i in feifan_indices],
            return_exceptions=True,
        )
        for idx, real_url in zip(feifan_indices, resolved):
            if isinstance(real_url, str) and real_url:
                eps[idx] = replace(eps[idx], url=real_url, suffix="ffm3u8")

    if has_360zy:
        zy_indices = [i for i, e in enumerate(eps) if e.suffix == "360zy"]
        resolved = await asyncio.gather(
            *[resolve_share_page(eps[i].url) for i in zy_indices],
            return_exceptions=True,
        )
        for idx, real_url in zip(zy_indices, resolved):
            if isinstance(real_url, str) and real_url:
                eps[idx] = replace(eps[idx], url=real_url, suffix="ffm3u8")
            elif isinstance(real_url, Exception):
                logger.warning("360zy_resolve_failed url=%s error=%s", eps[idx].url, real_url)

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

def _normalize_sort(sort: str | None) -> str:
    return sort if sort in {"updated", "year"} else "updated"


async def _query_and_aggregate(
    db: AsyncSession,
    filters: list[tuple[int, int | None]],
    wd: str | None,
    mode: str,
    pg: int | None = 1,
    per_page: int = DEFAULT_DESKTOP_PAGE_SIZE,
    sort: str = "updated",
) -> AggregatedListResponse:
    """Query VideoCache with filters/keyword, aggregate dedup, and paginate."""
    if not filters:
        return AggregatedListResponse(items=[], failed_sources=[])

    # 构建分类过滤集合，用于过滤 sources
    filter_set: set[tuple[int, int | None]] = set(filters)

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
    # 按指定字段排序：更新时间（默认）或年份；null 值自然排到最后。
    if sort == "year":
        query = query.order_by(
            VideoCache.year.is_(None).asc(),
            desc(VideoCache.year),
            desc(VideoCache.id),
        )
    else:
        query = query.order_by(desc(VideoCache.source_updated_at), desc(VideoCache.id))

    # 限制原始记录数，避免全表加载到内存做聚合。
    # 同一视频可能在多站点出现，放大后保证聚合后有足够结果。
    page = pg or 1
    raw_limit = per_page * AGGREGATION_RAW_LIMIT_MULTIPLIER
    raw_offset = (page - 1) * raw_limit
    query = query.limit(raw_limit).offset(raw_offset)

    result = await db.execute(query)
    records = result.scalars().all()

    # 聚合去重（含 year=None 回填）
    sorted_items = _aggregate_records(records)

    # 按请求字段做最终排序，保证同一聚合桶内多来源合并后的顺序正确。
    if sort == "year":
        ordered = [item for _, _, item, _ in sorted_items]
        aggregated = sorted(
            ordered,
            key=lambda item: (
                item["year"] is None,
                -(item["year"] or 0),
            ),
        )
    else:
        aggregated = [item for _, _, item, _ in sorted_items]

    # 分类过滤：只保留符合当前分类的 sources
    if filter_set and not wd:
        filtered_aggregated = []
        for item in aggregated:
            filtered_sources = [
                s for s in item["sources"]
                if (s["site_id"], s.get("type_id")) in filter_set
            ]
            if filtered_sources:
                item["sources"] = filtered_sources
                filtered_aggregated.append(item)
        aggregated = filtered_aggregated

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
        response = AggregatedListResponse(
            items=[AggregatedVideo(**item) for item in raw_items],
            failed_sources=[],
        )
        await _enrich_poster_urls(db, response.items)
        return response

    response = AggregatedListResponse(
        items=[AggregatedVideo(**item) for item in page_items],
        failed_sources=[],
    )
    await _enrich_poster_urls(db, response.items)
    return response


# ------------------------------------------------------------------
# 预聚合表双缓冲查询
# ------------------------------------------------------------------

def _like_escaped(value: str) -> str:
    """转义 LIKE 元字符，用户输入按字面匹配（\\ % _）。"""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _doubled_keyword(value: str) -> str:
    """关键字「每字符重复两次」，与 _doubled_title_column() 的标题变换对齐。"""
    return "".join(ch * 2 for ch in value.lower())


def _doubled_title_column():
    """标题「每字符重复两次」表达式，配合 trigram 索引服务 2 字子串搜索。

    必须与 main.py 的 ix_aggregated_videos_title_doubled_trgm 索引表达式一致。
    """
    return func.regexp_replace(
        func.lower(AggregatedVideoV3.title), "(.)", r"\1\1", "g"
    )


async def _query_aggregated_cache(
    db: AsyncSession,
    pg: int | None = 1,
    per_page: int = DEFAULT_DESKTOP_PAGE_SIZE,
    site_id: int | None = None,
    sort: str = "updated",
    category: str | None = None,
    fallback_category: str | None = None,
    sites: list[Site] | None = None,
    keyword: str | None = None,
    substring: bool = False,
) -> AggregatedListResponse | None:
    """从中间表 aggregated_videos / aggregated_sources 读取预聚合缓存。

    若表为空（首次启动未初始化），返回 None 让调用方 fallback。

    当 category 非空时，按各站点该分类的 (site_id, type_id) 过滤；所有站点都
    无该分类映射时返回空响应（非 None），避免误触发 fallback 到实时聚合路径。
    """
    try:
        # 加载分类禁用映射（缓存 60 秒）
        system_by_name, system_by_id, site_mappings = await _load_category_filter_maps(db)

        base_query = select(AggregatedVideoV3)

        # 禁用站点即隐藏：排除只由禁用站点提供的视频
        hidden = await _hidden_video_filter(db)
        if hidden is not None:
            base_query = base_query.where(AggregatedVideoV3.id.notin_(hidden))

        if site_id is not None:
            subq = (
                select(AggregatedSource.aggregated_video_id)
                .where(AggregatedSource.site_id == site_id)
                .subquery()
            )
            base_query = base_query.where(AggregatedVideoV3.id.in_(subq))

        # 分类过滤：视频级 system_category（聚合时按来源别名多数票算出）。
        # 未分类 = 没有任何来源命中别名，system_category 为 NULL。
        cat_sources: set[str] = set()
        if category:
            if category == UNCATEGORIZED_CATEGORY:
                base_query = base_query.where(
                    AggregatedVideoV3.system_category.is_(None)
                )
            else:
                system_names, remote_names = await _resolve_category_aliases(
                    db, category
                )
                # 该分类一个远程类名都没解析出来 → 回退父分类（不展开子分类）
                if not remote_names and fallback_category:
                    system_names, remote_names = await _resolve_category_aliases(
                        db, fallback_category, expand_children=False
                    )
                # 该分类没有任何别名 → 空结果（不 fallback 到实时路径）
                if not system_names:
                    return AggregatedListResponse(items=[], failed_sources=[])
                cat_sources = set(remote_names)
                base_query = base_query.where(
                    AggregatedVideoV3.system_category.in_(system_names)
                )

        kw = keyword.strip() if keyword else ""
        if kw:
            if len(kw) < 3 and not substring:
                # pg_trgm 只对 3 字以上生效；1–2 字改用前缀匹配，走 lower(title)
                # 的 text_pattern_ops 索引，避免全表扫描（321ms → 毫秒级）
                base_query = base_query.where(
                    func.lower(AggregatedVideoV3.title).like(
                        f"{_like_escaped(kw.lower())}%"
                    )
                )
            elif len(kw) < 3:
                # 2 字子串：pg_trgm 从 2 字模式里提取不出 trigram，直接 ILIKE 会退化成
                # 18 万行顺序扫描（实测 276ms，冷缓存 1.2s）。这里改走「字符加倍」表达式
                # 索引：标题与关键字都把每个字符重复一次（'白蛇' → '白白蛇蛇'），
                # 4 个字符足以提取 trigram，GIN 索引可用（实测 1ms）。
                # 表达式必须与 main.py 建索引时完全一致，否则用不上索引。
                doubled = _doubled_keyword(kw)
                base_query = base_query.where(
                    _doubled_title_column().like(f"%{_like_escaped(doubled)}%")
                )
            else:
                base_query = base_query.where(
                    AggregatedVideoV3.title.ilike(f"%{_like_escaped(kw)}%")
                )

        # 只判断「有没有数据」：count(*) 在 18 万行上要 110ms，EXISTS 取 1 行即可
        probe = await db.execute(
            base_query.with_only_columns(AggregatedVideoV3.id).limit(1)
        )
        if probe.first() is None:
            # 分类过滤下 0 条是合法结果（例如「未分类」暂时为空），不能 fallback
            # 到实时路径——那条路还在用旧的逐站点映射，会给出不一致的结果。
            if category:
                return AggregatedListResponse(items=[], failed_sources=[])
            return None

        page = pg or 1
        # 扫描窗口放大 5 倍用于分类禁用过滤的缓冲；offset 必须按同一窗口步进，
        # 否则相邻页 [offset, offset+window) 大面积重叠 → 跨页返回重复视频。
        scan_window = per_page * 5
        # offset 必须按「输出条数」步进：按扫描窗口步进会让相邻页之间整段跳空
        # （per_page=24 时第 2 页实际从第 121 行开始，中间 96 条永远翻不到）。
        offset = (page - 1) * per_page

        if sort == "year":
            # 必须写成 `year DESC NULLS LAST`，不能写 `(year IS NULL) ASC, year DESC`：
            # 后者是个表达式，用不上 (year DESC NULLS LAST, id DESC) 索引，18 万行
            # 要整表排序（实测 136ms）；改写后走 index-only scan，0.5ms。
            order_by = [
                AggregatedVideoV3.year.desc().nullslast(),
                desc(AggregatedVideoV3.id),
            ]
        else:
            order_by = [desc(AggregatedVideoV3.latest_updated_at), desc(AggregatedVideoV3.id)]

        result = await db.execute(
            base_query.order_by(*order_by)
            .limit(scan_window)
            .offset(offset)
            .options(selectinload(AggregatedVideoV3.sources_rel))
        )
        rows = result.scalars().all()

        # 构建分类过滤集合，用于过滤 sources
        cat_filter_set: set[str] = cat_sources if category else set()

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

            # 分类过滤：只保留符合当前分类的 sources
            if cat_filter_set:
                sources = [
                    s for s in sources
                    if s.type in cat_filter_set
                ]

            # AC-031: 分类禁用过滤——所有 source 都被禁用时整体过滤
            if not _video_has_enabled_source(
                sources, system_by_name, system_by_id, site_mappings
            ):
                continue

            # site_id 已在 SQL 层过滤，这里做双重保险
            if site_id is not None:
                sources = _filter_sources_by_site_id(sources, site_id)

            # 过滤后无来源则跳过
            if not sources:
                continue

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

        response = AggregatedListResponse(items=items, failed_sources=[])
        await _enrich_poster_urls(db, response.items)
        return response
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
    sort: str = "updated",
    db: AsyncSession = Depends(get_db),
):
    """从本地 VideoCache 查询并按分类聚合去重。"""
    sort = _normalize_sort(sort)
    start = time.monotonic()
    is_mobile = _detect_mobile(request)
    per_page = _get_page_size(request, pg_size)
    logger.info("api_list_videos category=%s pg=%s mode=%s sort=%s mobile=%s per_page=%s", category, pg, mode, sort, is_mobile, per_page)

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

    # 聚合模式 + 无 t：优先走预聚合缓存表（O(1) 查询），含分类场景。
    # 在"已聚合"的表上分页，从根上不重不漏；分类则按 (site_id, type_id) 过滤。
    if t is None and mode == "aggregated":
        agg_response = await _query_aggregated_cache(
            db, pg, per_page, site_id, sort=sort,
            category=category, fallback_category=fallback_category, sites=sites,
        )
        if agg_response is not None:
            # fields 字段过滤
            raw_items = [item.model_dump() for item in agg_response.items]
            filtered = _filter_fields(raw_items, fields)
            agg_response.items = [AggregatedVideo(**item) for item in filtered]
            elapsed = time.monotonic() - start
            logger.info("api_list_videos_agg items=%d elapsed=%.3fs", len(agg_response.items), elapsed)
            return agg_response
        # 预聚合表为空（首次启动未初始化），fallback 到原实时路径

    # 构建 (site_id, type_id) 过滤条件
    filters = []
    for site in sites:
        if category:
            remote_cats = await _resolve_remote_categories(db, site, category)
            # 子分类无映射时回退到父分类，但不展开子分类避免匹配过宽
            if not remote_cats and fallback_category:
                remote_cats = await _resolve_remote_categories(db, site, fallback_category, expand_children=False)
            if not remote_cats:
                continue
            for rid in remote_cats:
                filters.append((site.id, int(rid) if isinstance(rid, str) and rid.isdigit() else rid))
        elif t is not None:
            filters.append((site.id, int(t) if isinstance(t, str) and t.isdigit() else t))
        else:
            # 不指定分类：该站点全部
            filters.append((site.id, None))

    response = await _query_and_aggregate(db, filters, None, mode, pg, per_page, sort=sort)

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

    # 禁用站点即隐藏：只保留至少一个启用来源的推荐
    disabled_ids = await _disabled_site_ids(db)
    if disabled_ids:
        disabled_set = set(disabled_ids)
        items = [
            item
            for item in items
            if any(s.site_id not in disabled_set for s in item.sources)
        ]

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

    response = AggregatedListResponse(items=items, failed_sources=[])
    await _enrich_poster_urls(db, response.items)
    return response


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
    sort: str = "updated",
    db: AsyncSession = Depends(get_db),
):
    """本地 VideoCache LIKE 搜索。"""
    sort = _normalize_sort(sort)
    start = time.monotonic()
    if not wd or not wd.strip():
        raise validation_error("搜索词不能为空")

    per_page = _get_page_size(request, pg_size)
    logger.info("api_search_videos wd=%s category=%s pg=%s mode=%s sort=%s per_page=%s", wd, category, pg, mode, sort, per_page)

    result = await db.execute(
        select(Site).where(Site.enabled.is_(True)).order_by(Site.sort)
    )
    sites = result.scalars().all()

    # 优先走聚合表：video_cache 上有 2.3M 行冗余，ILIKE 全表扫描要 1.4 秒
    if mode != "realtime":

        async def _agg_search(substring: bool):
            return await _query_aggregated_cache(
                db,
                pg=pg,
                per_page=per_page,
                category=category,
                sites=sites,
                keyword=wd,
                substring=substring,
                sort=sort,
            )

        short = len(wd.strip()) < 3
        agg_response = await _agg_search(False)
        # 1–2 字：前缀没结果（或根本没有命中）时退回子串扫描，保证不漏结果
        if short and (agg_response is None or not agg_response.items):
            agg_response = await _agg_search(True)

        if agg_response is None:
            # 只有「聚合表本身为空」（首次启动未初始化）才落到实时路径，
            # 关键字没命中时直接返回空，避免又去扫 2.3M 行的 video_cache
            probe = await db.execute(select(AggregatedVideoV3.id).limit(1))
            if probe.first() is not None:
                agg_response = AggregatedListResponse(items=[], failed_sources=[])

        if agg_response is not None:
            raw_items = [item.model_dump() for item in agg_response.items]
            filtered = _filter_fields(raw_items, fields)
            agg_response.items = [AggregatedVideo(**item) for item in filtered]
            logger.info(
                "api_search_videos_agg wd=%s items=%d",
                wd,
                len(agg_response.items),
            )
            return agg_response

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

    response = await _query_and_aggregate(db, filters, wd, mode, pg, per_page, sort=sort)

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

# 缓存过期时后台刷新的在途集合，避免同一来源被反复刷新
_DETAIL_REFRESH_INFLIGHT: set[tuple[int, str]] = set()


def _schedule_detail_refresh(site: Site, original_id: str) -> None:
    """缓存过期不影响本次响应：先返回旧数据，后台再更新。"""
    key = (site.id, original_id)
    if key in _DETAIL_REFRESH_INFLIGHT:
        return
    _DETAIL_REFRESH_INFLIGHT.add(key)
    asyncio.create_task(
        _detail_refresh_bg(site.id, site.base_url, site.name, original_id, key)
    )


async def _detail_refresh_bg(
    site_id: int, base_url: str, site_name: str, original_id: str, key: tuple[int, str]
) -> None:
    try:
        async with SourceClient(
            site_id=site_id, base_url=base_url, name=site_name
        ) as client:
            items = await client.videolist(ids=[original_id], op="detail_refresh")
        if not items:
            return
        item = items[0]
        play_raw = item.get("play_url_raw") or ""
        if not play_raw:
            return
        async with async_session_factory() as db:
            stmt = insert_cls(VideoCache).values(
                site_id=site_id,
                original_id=original_id,
                title=item.get("title", ""),
                year=item.get("year"),
                poster_url=item.get("poster_url"),
                intro=item.get("intro"),
                area=item.get("area"),
                actors=item.get("actors"),
                director=item.get("director"),
                play_url_raw=play_raw,
                type_id=item.get("type_id"),
                type_name=item.get("type_name") or item.get("type"),
                source_updated_at=item.get("updated_at"),
                cached_at=_utcnow(),
                has_detail=True,
            ).on_conflict_do_update(
                index_elements=["site_id", "original_id"],
                set_={
                    "play_url_raw": play_raw,
                    "cached_at": _utcnow(),
                    "has_detail": True,
                },
            )
            await db.execute(stmt)
            await db.commit()
        logger.info(
            "detail_cache_refreshed site=%s original_id=%s", site_name, original_id
        )
    except Exception as exc:
        logger.warning(
            "detail_cache_refresh_failed site=%s original_id=%s error=%s",
            site_name,
            original_id,
            exc,
        )
    finally:
        _DETAIL_REFRESH_INFLIGHT.discard(key)

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
    expire_threshold = _utcnow() - timedelta(days=CACHE_TTL_DAYS)

    # 一次性批量读缓存：AsyncSession 不能并发使用，fetch_one 里再查库会与
    # gather 的其他任务竞争同一个 session（多源时表现为卡住/超时）。
    cache_map: dict[tuple[int, str], VideoCache] = {}
    if sources:
        pairs = [(s.site_id, s.original_id) for s in sources]
        cached_rows = await db.execute(
            select(VideoCache).where(
                tuple_(VideoCache.site_id, VideoCache.original_id).in_(pairs)
            )
        )
        cache_map = {
            (row.site_id, row.original_id): row
            for row in cached_rows.scalars().all()
        }

    async def fetch_one(source_ref):
        site = sites.get(source_ref.site_id)
        if not site:
            return None, None, FailedSource(
                site_id=source_ref.site_id,
                site_name=None,
                error="site not found",
            )

        # 1. 查缓存（已在上面批量取好，这里不再碰数据库）
        cached = cache_map.get((source_ref.site_id, source_ref.original_id))

        # 有缓存就先返回：过期了也只做后台刷新，不让用户等网络
        cache_valid = (
            cached
            and cached.play_url_raw
            and cached.cached_at
            and cached.cached_at > expire_threshold
        )

        if cached is not None and cached.play_url_raw:
            if not cache_valid:
                _schedule_detail_refresh(site, source_ref.original_id)
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
                "type_name": cached.type_name,
                "episodes": episodes,
            }, None, None

        # 2. 完全没有缓存才实时请求：交互路径只给 4 秒、不重试，避免一次卡顿
        #    被 3 次重试放大成 27 秒（用户看到的「加载源信息」很久）
        async with SourceClient(
            site_id=site.id,
            base_url=site.base_url,
            name=site.name,
            timeout=4.0,
            max_attempts=1,
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
                    "type_name": item.get("type_name") or item.get("type"),
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
                    "type_id": item.get("type_id"),
                    "type_name": item.get("type_name") or item.get("type"),
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

    requested = list(sources)
    tasks = [asyncio.wait_for(fetch_one(s), timeout=6) for s in requested]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    sources = []
    cache_entries = []
    failed_sources = []
    for ref, raw in zip(requested, results):
        if isinstance(raw, Exception):
            site = sites.get(ref.site_id)
            failed_sources.append(
                FailedSource(
                    site_id=ref.site_id,
                    site_name=site.name if site else None,
                    error="timeout" if isinstance(raw, asyncio.TimeoutError) else str(raw),
                ).model_dump()
            )
            continue
        data, cache_entry, error = raw
        if error:
            failed_sources.append(error.model_dump())
        if data:
            sources.append(data)
        if cache_entry:
            cache_entries.append(cache_entry)

    # 分享页解析（feifan/360zy → 真实 m3u8）要发网络请求：多个来源并发处理，
    # 并设总预算，超时就先返回未解析的地址，避免详情弹窗超过前端 30 秒超时。
    pending = [d for d in sources if d.get("episodes")]
    if pending:
        try:
            normalized = await asyncio.wait_for(
                asyncio.gather(
                    *[_normalize_episode_suffixes(d["episodes"]) for d in pending]
                ),
                timeout=6,
            )
            for data, episodes in zip(pending, normalized):
                data["episodes"] = episodes
        except asyncio.TimeoutError:
            logger.warning(
                "detail_normalize_timeout title=%s sources=%d",
                req.title,
                len(pending),
            )

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
        # 避免 videolist 未返回分类信息时把已有值覆盖为 None
        if entry.get("type_id") is not None:
            set_["type_id"] = entry["type_id"]
        if entry.get("type_name") is not None:
            set_["type_name"] = entry["type_name"]
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
    # 视频级系统分类：详情页据此展示「系统把它归到哪一类」
    system_category = None
    if req.title:
        cat_query = select(AggregatedVideoV3.system_category).where(
            AggregatedVideoV3.norm_title == normalize_title(req.title)
        )
        if req.year is None:
            cat_query = cat_query.where(AggregatedVideoV3.year.is_(None))
        else:
            cat_query = cat_query.where(AggregatedVideoV3.year == req.year)
        system_category = (await db.execute(cat_query.limit(1))).scalar_one_or_none()

    return DetailResponse(
        title=req.title,
        year=req.year,
        sources=sources,
        system_category=system_category,
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
        raise crawler_not_running()
    asyncio.create_task(scheduler_module.crawler.run_full_crawl())
    return {"message": "全量刮削已启动"}


@router.post("/crawler/incremental/{site_id}")
async def trigger_incremental(site_id: int):
    """手动触发指定站点的增量更新。"""
    if scheduler_module.crawler is None:
        raise crawler_not_running()
    asyncio.create_task(scheduler_module.crawler.run_incremental(site_id))
    return {"message": f"站点 {site_id} 增量更新已启动"}


@router.post("/crawler/fill-videolist")
async def fill_videolist(
    req: FillVideolistRequest,
) -> FillVideolistResponse:
    """按站点分组批量补全缺失的 videolist 详情。

    后台运行，立即返回任务已启动。补全完成后会自动刷新聚合缓存与看板统计。
    """
    if scheduler_module.crawler is None:
        raise crawler_not_running()

    site_id = req.site_id
    asyncio.create_task(scheduler_module.crawler.fill_missing_videolist(site_id))
    message = (
        f"站点 {site_id} 补全任务已启动"
        if site_id is not None
        else "全站 videolist 补全任务已启动"
    )
    return FillVideolistResponse(message=message, site_id=site_id)


async def _get_aggregated_count(db: AsyncSession) -> int:
    """获取聚合后视频数。优先查 aggregated_videos 表，不存在则回退到 mv_aggregated_videos 物化视图。"""
    try:
        result = await db.execute(select(func.count()).select_from(AggregatedVideoV3))
        count = result.scalar_one() or 0
        if count:
            return count
    except Exception:
        pass
    try:
        result = await db.execute(select(func.count()).select_from(AggregatedVideoMV))
        return result.scalar_one() or 0
    except Exception as exc:
        logger.warning("读取聚合视图数量失败: %s", exc)
        return 0


# ------------------------------------------------------------------
# 刮削统计 API
# ------------------------------------------------------------------

@router.get("/crawler/stats")
async def crawler_stats(db: AsyncSession = Depends(get_db)) -> CrawlerStatsResponse:
    """返回刮削统计数据。优先读预计算缓存（O(1)），缓存不存在则实时计算。"""
    import json


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

            # 旧缓存可能缺少 aggregated_count，实时补一次（COUNT 很快）
            aggregated_count = data.get("aggregated_count", 0)
            if not aggregated_count:
                aggregated_count = await _get_aggregated_count(db)

            return CrawlerStatsResponse(
                total=data.get("total", 0),
                by_site=by_site,
                with_detail=data.get("with_detail", 0),
                without_detail=data.get(
                    "without_detail", data.get("total", 0) - data.get("with_detail", 0)
                ),
                aggregated_count=aggregated_count,
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

    aggregated_count = await _get_aggregated_count(db)

    total = global_row.total or 0
    with_detail = int(global_row.with_detail or 0)
    without_detail = total - with_detail

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
        total=total,
        by_site=by_site,
        with_detail=with_detail,
        without_detail=without_detail,
        aggregated_count=aggregated_count,
        last_updated_at=global_row.last_updated,
        history=history,
        computed_at=_utcnow().isoformat(),
    )


# ------------------------------------------------------------------
# 刮削日志 API
# ------------------------------------------------------------------

@router.get("/crawler/logs")
async def crawler_logs() -> CrawlerLogsResponse:
    """返回当天刮削日志（最多 50 条）。"""
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
async def cleanup_expired(site_id: int | None = None, dry_run: bool = False):
    """启动「清除失效资源」后台任务，立即返回；用 status 接口查进度。

    以前是同步跑完再返回：21 个站点 × 每站 2000 条 ÷ 每批 20 ≈ 2100 次外部
    请求，前端 30 秒必超时。现在改成后台任务，前端轮询进度。
    """
    global _CLEANUP_TASK
    if _CLEANUP_STATE["running"]:
        return {"started": False, **_CLEANUP_STATE}

    _reset_cleanup_state()
    _CLEANUP_STATE["running"] = True
    _CLEANUP_STATE["dry_run"] = dry_run
    _CLEANUP_STATE["started_at"] = time.time()
    _CLEANUP_TASK = asyncio.create_task(_cleanup_worker(site_id, dry_run))
    logger.info("cleanup_expired_started site_id=%s dry_run=%s", site_id, dry_run)
    return {"started": True, **_CLEANUP_STATE}


@router.get("/cleanup-expired/status")
async def cleanup_expired_status():
    return _CLEANUP_STATE


# 后台清理任务状态（进程内；单进程部署）
_CLEANUP_STATE: dict = {
    "running": False,
    "dry_run": False,
    "started_at": None,
    "finished_at": None,
    "checked": 0,
    "deleted": 0,
    "sites_total": 0,
    "sites_done": 0,
    "by_site": [],
    "error": None,
}
_CLEANUP_TASK: asyncio.Task | None = None

CLEANUP_BATCH = 20
CLEANUP_MAX_PER_SITE = 2000
CLEANUP_BATCH_CONCURRENCY = 5
CLEANUP_SITE_CONCURRENCY = 4
# 单个站点的预算：站点不可达时别把全局预算吃光
CLEANUP_SITE_SECONDS = 120
# 单次清理的总预算：超过就不再开始新批次，避免跑一晚上
CLEANUP_MAX_SECONDS = 600


def _reset_cleanup_state() -> None:
    _CLEANUP_STATE.update(
        {
            "running": False,
            "dry_run": False,
            "started_at": None,
            "finished_at": None,
            "checked": 0,
            "deleted": 0,
            "sites_total": 0,
            "sites_done": 0,
            "by_site": [],
            "error": None,
        }
    )


async def _cleanup_one_site(
    site: tuple[int, str, str], deadline: float, dry_run: bool = False
) -> tuple[dict, set[str]]:
    """验证并删除单个站点的失效缓存，返回 (统计, 受影响的归一化标题)。"""
    site_id, name, base_url = site
    checked = 0
    expired_ids: list[str] = []
    affected: set[str] = set()

    async with async_session_factory() as db:
        rows = (
            await db.execute(
                select(VideoCache.original_id)
                .where(VideoCache.site_id == site_id)
                .order_by(VideoCache.id)
                .limit(CLEANUP_MAX_PER_SITE)
            )
        ).all()
        ids = [row[0] for row in rows]
        checked = len(ids)
        if not ids:
            return {"site_id": site_id, "site_name": name, "checked": 0, "deleted": 0}, affected

        sem = asyncio.Semaphore(CLEANUP_BATCH_CONCURRENCY)
        # 单站预算：站点不可达时不要拿满全局预算
        site_deadline = min(deadline, time.monotonic() + CLEANUP_SITE_SECONDS + 30)

        async with SourceClient(
            site_id=site_id, base_url=base_url, name=name, timeout=10
        ) as client:

            async def run_batch(batch: list) -> list[str]:
                if time.monotonic() > site_deadline:
                    return []
                async with sem:
                    try:
                        items = await client.videolist(ids=batch, op="cleanup_expired")
                    except Exception:
                        # 失败也算「检查过」，否则不可达站点的进度永远不动
                        _CLEANUP_STATE["checked"] += len(batch)
                        return []
                    _CLEANUP_STATE["checked"] += len(batch)
                    returned = {item["original_id"] for item in items}
                    return [str(vid) for vid in batch if str(vid) not in returned]

            batches = [
                ids[i : i + CLEANUP_BATCH]
                for i in range(0, len(ids), CLEANUP_BATCH)
            ]
            for result in await asyncio.gather(*(run_batch(b) for b in batches)):
                expired_ids.extend(result)

        if expired_ids and dry_run:
            logger.info(
                "cleanup_expired_dry_run site=%s would_delete=%d",
                site_id,
                len(expired_ids),
            )
        if expired_ids and not dry_run:
            norm_rows = (
                await db.execute(
                    select(VideoCache.norm_title).where(
                        VideoCache.site_id == site_id,
                        VideoCache.original_id.in_(expired_ids),
                    )
                )
            ).all()
            affected.update(row[0] for row in norm_rows if row[0])
            await db.execute(
                delete(VideoCache).where(
                    VideoCache.site_id == site_id,
                    VideoCache.original_id.in_(expired_ids),
                )
            )
            await db.commit()

    return (
        {
            "site_id": site_id,
            "site_name": name,
            "checked": checked,
            "deleted": len(expired_ids),
        },
        affected,
    )


async def _cleanup_worker(site_id: int | None, dry_run: bool = False) -> None:
    deadline = time.monotonic() + CLEANUP_MAX_SECONDS
    try:
        async with async_session_factory() as db:
            if site_id:
                rows = (
                    await db.execute(
                        select(Site.id, Site.name, Site.base_url).where(
                            Site.id == site_id
                        )
                    )
                ).all()
            else:
                rows = (
                    await db.execute(
                        select(Site.id, Site.name, Site.base_url).where(
                            Site.enabled.is_(True)
                        )
                    )
                ).all()
        sites = [(row[0], row[1], row[2]) for row in rows]
        _CLEANUP_STATE["sites_total"] = len(sites)

        sem = asyncio.Semaphore(CLEANUP_SITE_CONCURRENCY)
        affected: set[str] = set()

        async def run(site: tuple[int, str, str]) -> None:
            async with sem:
                stat, site_affected = await _cleanup_one_site(site, deadline, dry_run)
            affected.update(site_affected)
            # checked 已按批次累加，这里只汇总删除数与站点进度
            _CLEANUP_STATE["deleted"] += stat["deleted"]
            _CLEANUP_STATE["sites_done"] += 1
            _CLEANUP_STATE["by_site"].append(stat)

        await asyncio.gather(*(run(site) for site in sites))

        if affected:
            async with async_session_factory() as db:
                await refresh_aggregated_view(db, affected_norm_titles=affected)
                invalidate_category_filter_cache()

        logger.info(
            "cleanup_expired_done sites=%d checked=%d deleted=%d",
            len(sites),
            _CLEANUP_STATE["checked"],
            _CLEANUP_STATE["deleted"],
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("cleanup_expired_failed")
        _CLEANUP_STATE["error"] = str(exc)
    finally:
        _CLEANUP_STATE["running"] = False
        _CLEANUP_STATE["finished_at"] = time.time()


# ------------------------------------------------------------------
# 清理缓存 API（保留）
# ------------------------------------------------------------------

@router.delete("/cache")
async def clear_video_cache(db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(VideoCache))
    await db.commit()
    return {"deleted": result.rowcount}

@router.get("/categories/stats")
async def category_stats(db: AsyncSession = Depends(get_db)):
    """视频级分类计数：分类栏只展示有内容的分类，并给出未分类数量。"""
    global _category_stats_cache, _category_stats_cache_ts
    now = time.monotonic()
    if (
        _category_stats_cache is not None
        and (now - _category_stats_cache_ts) < _CATEGORY_STATS_TTL
    ):
        return _category_stats_cache

    hidden = await _hidden_video_filter(db)

    counts_query = (
        select(AggregatedVideoV3.system_category, func.count())
        .where(AggregatedVideoV3.system_category.isnot(None))
        .group_by(AggregatedVideoV3.system_category)
    )
    uncategorized_query = (
        select(func.count())
        .select_from(AggregatedVideoV3)
        .where(AggregatedVideoV3.system_category.is_(None))
    )
    if hidden is not None:
        counts_query = counts_query.where(AggregatedVideoV3.id.notin_(hidden))
        uncategorized_query = uncategorized_query.where(
            AggregatedVideoV3.id.notin_(hidden)
        )

    rows = await db.execute(counts_query)
    counts = {name: count for name, count in rows.all()}
    uncategorized = (await db.execute(uncategorized_query)).scalar_one()
    payload = {
        "counts": counts,
        "uncategorized": uncategorized,
        "total": sum(counts.values()) + uncategorized,
    }
    _category_stats_cache = payload
    _category_stats_cache_ts = now
    return payload


# 未分类归因：每个来源为什么没算进系统分类
_UNCATEGORIZED_REASON = {
    "no_type_name": "来源没有给分类名",
    "no_alias": "这个类名还没有对应系统分类",
    "adult_blocked": "类名命中成人词库，被自动归类跳过",
    "alias_disabled": "类名的别名被停用了",
    "alias_mismatch": "有别名但视频级分类为空（可重算一次）",
}


@router.get("/uncategorized")
async def list_uncategorized(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """未分类内容 + 归因。

    对每条未分类视频逐个来源说明「为什么没归类」，并给出可一键采纳的候选
    （来源类名 + 建议系统分类），前端点一下即可把类名补成别名并重算。
    """
    total = (
        await db.execute(
            select(func.count())
            .select_from(AggregatedVideoV3)
            .where(AggregatedVideoV3.system_category.is_(None))
        )
    ).scalar_one()

    rows = (
        await db.execute(
            select(AggregatedVideoV3)
            .where(AggregatedVideoV3.system_category.is_(None))
            .order_by(
                AggregatedVideoV3.latest_updated_at.desc().nullslast(),
                AggregatedVideoV3.id.desc(),
            )
            .limit(max(1, min(limit, 500)))
            .options(selectinload(AggregatedVideoV3.sources_rel))
        )
    ).scalars().all()

    aliases = await load_aliases(db)
    items = []
    for video in rows:
        sources = []
        name_votes: dict[str, int] = {}
        for src in video.sources_rel:
            raw = (src.type_name or "").strip()
            key = normalize_category_name(raw)
            info = aliases.get(key) if key else None
            if not raw:
                reason = "no_type_name"
            elif info is not None and not info["enabled"]:
                reason = "alias_disabled"
            elif info is not None:
                reason = "alias_mismatch"
            elif _is_adult(raw):
                reason = "adult_blocked"
            else:
                reason = "no_alias"

            if raw:
                name_votes[raw] = name_votes.get(raw, 0) + 1

            sources.append(
                {
                    "site_id": src.site_id,
                    "site_name": src.site_name,
                    "type_name": raw or None,
                    "reason": reason,
                    "reason_text": _UNCATEGORIZED_REASON[reason],
                    "alias_system": info["system_name"] if info else None,
                }
            )

        candidate_name = None
        candidate_system = None
        if name_votes:
            candidate_name = max(name_votes, key=lambda name: name_votes[name])
            suggested, confidence = _match_one(candidate_name)
            candidate_system = suggested if confidence >= 0.6 else None

        items.append(
            {
                "title": video.title,
                "year": video.year,
                "poster_url": video.poster_url,
                "sources": sources,
                "candidate_name": candidate_name,
                "candidate_system": candidate_system,
            }
        )

    return {"total": total, "items": items}
