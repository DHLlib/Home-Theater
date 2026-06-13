"""视频资源定时刮削器。

架构：
- 首次全量：遍历所有站点的所有分类的所有页，list + 批量 videolist
- 日常增量：从第一页开始扫，遇旧即停，只处理新增/变更记录
- 5分钟检测：查各站第一页，有新内容则自动触发增量
- 状态持久化：AppConfig key="crawler_state"
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from datetime import datetime, timezone

from app.models import _utcnow
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.dialects.postgresql import insert as insert_cls

from app.constants import (
    CRAWLER_BATCH_INSERT_SIZE,
    CRAWLER_BATCH_VIDEOLIST_SIZE,
    CRAWLER_PAGE_CONCURRENCY,
    CRAWLER_PAGE_SIZE_THRESHOLD,
    CRAWLER_SITE_CONCURRENCY,
    CRAWLER_VIDEOLIST_BATCH_SIZE,
    RETRY_BASE_DELAY_SECONDS,
    RETRY_MAX_ATTEMPTS,
)
from app.models import AggregatedVideoV3, AppConfig, Site, VideoCache
from app.services.aggregator import normalize_title, refresh_aggregated_view
from app.services.category_mapping import get_site_category_mappings
from app.services.source_client import SourceClient

logger = logging.getLogger(__name__)


class Crawler:
    """资源站定时刮削器。

    状态机（每个站点独立，内存中的瞬态标记）：
        idle → full_crawling → idle
        idle → incremental_running → idle
    """

    STATE_KEY = "crawler_state"
    STATS_KEY = "crawler_stats"
    BATCH_SIZE = 2000
    PAGE_CONCURRENCY = CRAWLER_PAGE_CONCURRENCY

    def __init__(self, db_factory):
        self._db_factory = db_factory
        self._site_status: dict[int, str] = {}  # site_id -> status
        self._running = False
        self._logs: deque[dict] = deque(maxlen=50)
        self._pending_norm_titles: set[str] = set()
        self._refresh_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # 公开接口
    # ------------------------------------------------------------------

    async def start(self):
        """启动时检查是否需要刮削。

        触发条件：
        1. 首次启动：VideoCache 为空且有已启用站点
        2. 冷启动补全：有已启用站点从未被刮削过（如新添加的站点）
        3. 无站点时跳过（刮削无意义）
        """
        self._running = True

        async with self._db_factory() as db:
            sites = await self._get_enabled_sites(db)
            if not sites:
                logger.info("暂无站点配置，跳过刮削")
                return

            # 获取已有缓存的站点 ID
            result = await db.execute(select(VideoCache.site_id).distinct())
            cached_site_ids = {row[0] for row in result.all()}

            if not cached_site_ids:
                # 完全首次启动
                logger.info("首次启动检测到 %d 个站点，启动全量刮削", len(sites))
                await self.run_full_crawl()
                return

            # 检查是否有新站点（从未刮削过）
            new_sites = [s for s in sites if s.id not in cached_site_ids]
            if new_sites:
                logger.info(
                    "检测到 %d 个新站点，启动全量刮削", len(new_sites)
                )
                await self._run_full_crawl_for_sites(new_sites)

    async def trigger_full_crawl(self, site_id: int) -> None:
        """触发单个站点的全量刮削（用于新站点添加/启用时即时补全）。"""
        if not self._running:
            logger.debug("crawler 未运行，跳过触发")
            return
        if self._site_status.get(site_id) in ("full_crawling", "incremental_running"):
            logger.info("站点 %d 正在刮削中，跳过重复触发", site_id)
            return
        async with self._db_factory() as db:
            site = await db.get(Site, site_id)
        if site:
            logger.info("触发站点 %s 全量刮削", site.name)
            await self._crawl_site_full(site)

    async def run_full_crawl(self):
        """首次全量刮削所有站点（站点间并发，最多 2 个同时）。"""
        async with self._db_factory() as db:
            sites = await self._get_enabled_sites(db)
        await self._run_full_crawl_for_sites(sites)

    async def _run_full_crawl_for_sites(self, sites: list[Site]) -> None:
        """对指定站点列表执行全量刮削（站点间并发，最多 2 个同时）。"""
        if not sites:
            return
        semaphore = asyncio.Semaphore(2)

        async def _crawl_one(site: Site):
            if not self._running:
                return
            async with semaphore:
                await self._crawl_site_full(site)

        await asyncio.gather(*[_crawl_one(s) for s in sites])

    async def run_incremental(self, site_id: int):
        """对指定站点执行增量更新。"""
        if self._site_status.get(site_id) in ("full_crawling", "incremental_running"):
            return

        self._site_status[site_id] = "incremental_running"
        try:
            async with self._db_factory() as db:
                site_result = await db.execute(select(Site).where(Site.id == site_id))
                site = site_result.scalar_one_or_none()

            if not site:
                return

            await self._crawl_site_incremental(site)
        except Exception as exc:
            logger.warning("增量更新站点 %s 失败: %s", site_id, exc)
        finally:
            self._site_status[site_id] = "idle"

    async def check_one_site(self, site: Site) -> bool:
        """检测单个站点是否有更新。返回 True 表示需要刮削。"""
        if not self._running:
            return False
        if self._site_status.get(site.id) in ("full_crawling", "incremental_running"):
            return False

        state = await self._load_state()
        try:
            client = SourceClient(
                site_id=site.id, base_url=site.base_url, name=site.name
            )
            items = await self._fetch_list_page(
                client, None, 1, op="crawler_check"
            )
            await client.aclose()

            if not items:
                return False

            first_vod_time = items[0].get("updated_at")
            site_state = state.get("sites", {}).get(str(site.id), {})
            last_vod_time = site_state.get("last_vod_time")

            return bool(
                not last_vod_time or (first_vod_time and first_vod_time > last_vod_time)
            )
        except Exception as exc:
            logger.warning("检测站点 %s 更新失败: %s", site.name, exc)
            return False

    async def check_updates(self):
        """并发检测所有站点（兼容旧调用，由 scheduler 调用）。"""
        async with self._db_factory() as db:
            sites = await self._get_enabled_sites(db)

        results = await asyncio.gather(
            *[self.check_one_site(s) for s in sites], return_exceptions=True
        )
        return [
            site.id for site, has_update in zip(sites, results)
            if has_update is True
        ]

    def get_status(self) -> dict[str, Any]:
        """返回各站点刮削状态。"""
        return {
            "site_status": dict(self._site_status),
            "overall": "running" if self._running else "stopped",
        }

    def get_logs(self) -> list[dict]:
        """返回最近 50 条刮削日志。"""
        return list(self._logs)

    async def stop(self):
        self._running = False

    # ------------------------------------------------------------------
    # 全量刮削（单站点）
    # ------------------------------------------------------------------

    async def _crawl_site_full(self, site: Site):
        if self._site_status.get(site.id) in ("full_crawling", "incremental_running"):
            return

        self._site_status[site.id] = "full_crawling"
        client = SourceClient(
            site_id=site.id, base_url=site.base_url, name=site.name
        )
        affected_norm_titles: set[str] = set()

        try:
            state = await self._load_state()
            site_state = state.setdefault("sites", {}).setdefault(str(site.id), {})
            cat_states = site_state.setdefault("categories", {})

            async with self._db_factory() as db:
                categories = await self._get_site_categories(db, site)
            if not categories:
                categories = [None]

            need_videolist: list[dict] = []
            batch_entries: list[dict] = []

            for cat_id in categories:
                cat_key = str(cat_id) if cat_id else "__all__"
                page = 1
                last_vod_time = None

                while self._running:
                    start_time = time.time()
                    # 并发拉取多页，减少等待时间
                    tasks = [
                        self._fetch_list_page(client, cat_id, p, op="crawler_full")
                        for p in range(page, page + self.PAGE_CONCURRENCY)
                    ]
                    results = await asyncio.gather(*tasks)

                    reached_end = False
                    page_items_count = 0
                    for items in results:
                        if not items:
                            reached_end = True
                            break

                        page_items_count += len(items)
                        for item in items:
                            entry = self._build_list_entry(site.id, item)
                            batch_entries.append(entry)
                            # 全量时统一后补 videolist
                            need_videolist.append(entry)

                        # 批量 upsert list 字段（每 100 条一刷）
                        if len(batch_entries) >= CRAWLER_BATCH_INSERT_SIZE:
                            async with self._db_factory() as db:
                                affected_norm_titles.update(await self._batch_upsert_list_fields(db, batch_entries))
                            batch_entries = []

                        last_vod_time = items[-1].get("updated_at")

                        # 页末检测：返回不足一页说明已到末尾
                        if len(items) < CRAWLER_PAGE_SIZE_THRESHOLD:
                            reached_end = True
                            break

                        # 避免内存无限堆积
                        if len(need_videolist) >= CRAWLER_BATCH_VIDEOLIST_SIZE:
                            await self._batch_videolist(site, client, need_videolist, op="crawler_full")
                            need_videolist = []

                    # 记录本页日志（全量）
                    await self._add_log(
                        site=site,
                        category=cat_id,
                        page=page,
                        crawl_type="full",
                        items_count=page_items_count,
                        new_count=0,
                        update_count=0,
                        duration_ms=int((time.time() - start_time) * 1000),
                    )

                    if reached_end:
                        break

                    page += self.PAGE_CONCURRENCY

                # 分类结束：刷新剩余 batch_entries
                if batch_entries:
                    async with self._db_factory() as db:
                        affected_norm_titles.update(await self._batch_upsert_list_fields(db, batch_entries))
                    batch_entries = []

                cat_states[cat_key] = {"last_vod_time": last_vod_time}

            if need_videolist:
                affected_norm_titles.update(
                    await self._batch_videolist(site, client, need_videolist, op="crawler_full")
                )

            site_state["status"] = "idle"
            site_state["last_full_crawl"] = datetime.now(timezone.utc).isoformat()
            site_state["last_incremental"] = datetime.now(timezone.utc).isoformat()
            # 全局 last_vod_time 取各分类最大值
            all_times = [
                cs.get("last_vod_time")
                for cs in cat_states.values()
                if cs.get("last_vod_time")
            ]
            if all_times:
                site_state["last_vod_time"] = max(all_times)

            await self._save_state(state)

        except Exception as exc:
            logger.warning("全量刮削站点 %s 失败: %s", site.name, exc)
        finally:
            self._site_status[site.id] = "idle"
            await client.aclose()
            await self._update_stats_cache()
            await self._refresh_aggregated_cache(affected_norm_titles=affected_norm_titles)

    # ------------------------------------------------------------------
    # 增量刮削（单站点）
    # ------------------------------------------------------------------

    async def _crawl_site_incremental(self, site: Site):
        state = await self._load_state()
        site_state = state.setdefault("sites", {}).setdefault(str(site.id), {})
        cat_states = site_state.setdefault("categories", {})

        client = SourceClient(
            site_id=site.id, base_url=site.base_url, name=site.name
        )

        affected_norm_titles: set[str] = set()

        async with self._db_factory() as db:
            categories = await self._get_site_categories(db, site)
        if not categories:
            categories = [None]

        need_videolist: list[dict] = []
        batch_entries: list[dict] = []

        try:
            for cat_id in categories:
                cat_key = str(cat_id) if cat_id else "__all__"
                last_vod_time = cat_states.get(cat_key, {}).get("last_vod_time")

                page = 1
                stopped = False
                new_last_vod_time = None

                while self._running and not stopped:
                    start_time = time.time()
                    items = await self._fetch_list_page(
                        client, cat_id, page, op="crawler_incremental"
                    )
                    if not items:
                        break

                    # 1. 先过滤：遇旧即停
                    page_items: list[dict] = []
                    for item in items:
                        item_vod_time = item.get("updated_at")
                        if (
                            last_vod_time
                            and item_vod_time
                            and item_vod_time <= last_vod_time
                        ):
                            stopped = True
                            break
                        page_items.append(item)

                    page_items_count = len(page_items)
                    new_count = 0
                    update_count = 0

                    # 2. 批量查缓存（一页只查一次数据库）
                    original_ids = [
                        item.get("original_id")
                        for item in page_items
                        if item.get("original_id")
                    ]
                    async with self._db_factory() as db:
                        existing_map = await self._batch_get_cached_items(
                            db, site.id, original_ids
                        )

                    # 3. 逐条判断新增 / 更新 / 跳过
                    for item in page_items:
                        entry = self._build_list_entry(site.id, item)
                        existing = existing_map.get(entry["original_id"])
                        item_vod_time = item.get("updated_at")

                        if not existing:
                            new_count += 1
                            batch_entries.append(entry)
                            need_videolist.append(entry)
                        elif existing.source_updated_at != item_vod_time:
                            update_count += 1
                            batch_entries.append(entry)
                            need_videolist.append(entry)
                        # 已有且未变化：跳过，不更新 cached_at

                        # 批量 upsert list 字段（每 100 条一刷）
                        if len(batch_entries) >= CRAWLER_BATCH_INSERT_SIZE:
                            async with self._db_factory() as db:
                                affected_norm_titles.update(
                                    await self._batch_upsert_list_fields(
                                        db, batch_entries
                                    )
                                )
                            batch_entries = []

                    # 记录本页日志（增量）
                    await self._add_log(
                        site=site,
                        category=cat_id,
                        page=page,
                        crawl_type="incremental",
                        items_count=page_items_count,
                        new_count=new_count,
                        update_count=update_count,
                        duration_ms=int((time.time() - start_time) * 1000),
                    )

                    if not stopped:
                        new_last_vod_time = items[-1].get("updated_at")
                        if len(items) < CRAWLER_PAGE_SIZE_THRESHOLD:
                            break
                        page += 1

                        if len(need_videolist) >= CRAWLER_BATCH_VIDEOLIST_SIZE:
                            await self._batch_videolist(site, client, need_videolist, op="crawler_incremental")
                            need_videolist = []

                # 分类结束：刷新剩余 batch_entries
                if batch_entries:
                    async with self._db_factory() as db:
                        affected_norm_titles.update(await self._batch_upsert_list_fields(db, batch_entries))
                    batch_entries = []

                if new_last_vod_time:
                    cat_states[cat_key] = {"last_vod_time": new_last_vod_time}

            if need_videolist:
                affected_norm_titles.update(
                    await self._batch_videolist(site, client, need_videolist, op="crawler_incremental")
                )

            site_state["last_incremental"] = datetime.now(timezone.utc).isoformat()
            all_times = [
                cs.get("last_vod_time")
                for cs in cat_states.values()
                if cs.get("last_vod_time")
            ]
            if all_times:
                site_state["last_vod_time"] = max(all_times)

            await self._save_state(state)

        finally:
            await client.aclose()
            await self._update_stats_cache()
            await self._refresh_aggregated_cache(affected_norm_titles=affected_norm_titles)

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    async def _get_enabled_sites(self, db: AsyncSession) -> list[Site]:
        result = await db.execute(
            select(Site).where(Site.enabled.is_(True)).order_by(Site.sort)
        )
        return list(result.scalars().all())

    async def _get_site_categories(self, db: AsyncSession, site: Site) -> list:
        """获取站点的分类 remote_id 列表（中间表优先）。"""
        mappings = await get_site_category_mappings(db, site.id)
        if not mappings:
            return []
        cats = []
        for c in mappings:
            rid = c.get("remote_id")
            if rid is not None:
                cats.append(rid)
        return cats

    async def _fetch_list_page(
        self, client: SourceClient, cat_id, page: int, op: str = "unknown"
    ) -> list[dict]:
        """请求单页 list，带重试。"""
        for attempt in range(RETRY_MAX_ATTEMPTS):
            try:
                t = cat_id if cat_id is not None else None
                items = await client.list(t=t, pg=page, op=op)
                return items
            except Exception:
                if attempt < RETRY_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** attempt))
                continue
        return []

    async def _batch_videolist(
        self, site: Site, client: SourceClient, entries: list[dict], op: str = "unknown"
    ) -> set[str]:
        """批量 videolist 补充 detail 字段。"""
        affected: set[str] = set()
        for i in range(0, len(entries), self.BATCH_SIZE):
            batch = entries[i : i + self.BATCH_SIZE]
            ids = [e["original_id"] for e in batch]

            try:
                details = await client.videolist(ids=ids, op=op)
                detail_map = {str(d.get("original_id", "")): d for d in details}

                detail_entries = []
                for entry in batch:
                    d = detail_map.get(entry["original_id"])
                    if not d:
                        continue
                    detail_entry = self._build_detail_entry(site.id, d)
                    # 保留 list 阶段的分类信息（videolist 接口不返回 type_id）
                    detail_entry["type_id"] = entry.get("type_id")
                    detail_entry["type_name"] = entry.get("type_name")
                    detail_entries.append(detail_entry)

                if detail_entries:
                    async with self._db_factory() as db:
                        batch_affected = await self._batch_upsert_detail_fields(db, detail_entries)
                        affected.update(batch_affected)

            except Exception as exc:
                logger.warning("批量 videolist 站点 %s 失败: %s", site.name, exc)
        return affected

    async def _get_cached_item(
        self, db: AsyncSession, site_id: int, original_id: str
    ) -> VideoCache | None:
        result = await db.execute(
            select(VideoCache).where(
                VideoCache.site_id == site_id,
                VideoCache.original_id == original_id,
            )
        )
        return result.scalar_one_or_none()

    async def _batch_get_cached_items(
        self, db: AsyncSession, site_id: int, original_ids: list[str]
    ) -> dict[str, VideoCache]:
        """批量查询缓存记录，返回 original_id -> VideoCache 的映射。"""
        if not original_ids:
            return {}
        result = await db.execute(
            select(VideoCache).where(
                VideoCache.site_id == site_id,
                VideoCache.original_id.in_(original_ids),
            )
        )
        return {r.original_id: r for r in result.scalars().all()}

    # ------------------------------------------------------------------
    # 缓存淘汰（write-time eviction，上限 5000）
    # ------------------------------------------------------------------

    async def _evict_if_overflow(self, db: AsyncSession) -> None:
        """取消 LRU 淘汰：本机/局域网部署，磁盘空间不是瓶颈，完整保留刮削数据。"""
        pass

    # ------------------------------------------------------------------
    # 数据构建
    # ------------------------------------------------------------------

    @staticmethod
    def _build_list_entry(site_id: int, item: dict) -> dict:
        title = item.get("title", "")
        return {
            "site_id": site_id,
            "original_id": item.get("original_id", ""),
            "title": title,
            "norm_title": normalize_title(title),
            "year": item.get("year"),
            "type_id": item.get("type_id"),
            "type_name": item.get("type"),
            "remarks": item.get("remarks"),
            "play_from": item.get("play_from"),
            "source_updated_at": item.get("updated_at"),
            "cached_at": _utcnow(),
        }

    @staticmethod
    def _build_detail_entry(site_id: int, item: dict) -> dict:
        title = item.get("title", "")
        return {
            "site_id": site_id,
            "original_id": item.get("original_id", ""),
            "title": title,
            "norm_title": normalize_title(title),
            "year": item.get("year"),
            "poster_url": item.get("poster_url"),
            "intro": item.get("intro"),
            "area": item.get("area"),
            "actors": item.get("actors"),
            "director": item.get("director"),
            "play_url_raw": item.get("play_url_raw", ""),
            "source_updated_at": item.get("updated_at"),
            "has_detail": True,
            "cached_at": _utcnow(),
        }

    # ------------------------------------------------------------------
    # DB upsert（list / detail 分开，避免互覆）
    # ------------------------------------------------------------------

    async def _upsert_list_fields(self, db: AsyncSession, entry: dict):
        stmt = insert_cls(VideoCache).values(**entry)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": entry.get("title"),
                "norm_title": entry.get("norm_title"),
                "year": entry.get("year"),
                "type_id": entry.get("type_id"),
                "type_name": entry.get("type_name"),
                "remarks": entry.get("remarks"),
                "play_from": entry.get("play_from"),
                "source_updated_at": entry.get("source_updated_at"),
                "cached_at": entry.get("cached_at"),
            },
        )
        await db.execute(stmt)
        await db.commit()

    async def _upsert_detail_fields(self, db: AsyncSession, entry: dict):
        stmt = insert_cls(VideoCache).values(**entry)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": entry.get("title"),
                "norm_title": entry.get("norm_title"),
                "year": entry.get("year"),
                "poster_url": entry.get("poster_url"),
                "intro": entry.get("intro"),
                "area": entry.get("area"),
                "actors": entry.get("actors"),
                "director": entry.get("director"),
                "play_url_raw": entry.get("play_url_raw"),
                "source_updated_at": entry.get("source_updated_at"),
                "has_detail": True,
                "cached_at": entry.get("cached_at"),
            },
        )
        await db.execute(stmt)
        await db.commit()

    # ------------------------------------------------------------------
    # 批量 upsert（减少事务开销）
    # ------------------------------------------------------------------

    async def _batch_upsert_list_fields(self, db: AsyncSession, entries: list[dict]) -> set[str]:
        affected: set[str] = set()
        if not entries:
            return affected
        for e in entries:
            nt = e.get("norm_title")
            if nt:
                affected.add(nt)
        batch_size = 2000
        if len(entries) >= batch_size:
            for i in range(0, len(entries), batch_size):
                batch = entries[i : i + batch_size]
                try:
                    stmt = insert_cls(VideoCache).values(batch)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["site_id", "original_id"],
                        set_={
                            "title": stmt.excluded.title,
                            "norm_title": stmt.excluded.norm_title,
                            "year": stmt.excluded.year,
                            "type_id": stmt.excluded.type_id,
                            "type_name": stmt.excluded.type_name,
                            "remarks": stmt.excluded.remarks,
                            "play_from": stmt.excluded.play_from,
                            "source_updated_at": stmt.excluded.source_updated_at,
                            "cached_at": stmt.excluded.cached_at,
                        },
                    )
                    await db.execute(stmt)
                    await db.commit()
                    await self._evict_if_overflow(db)
                    await asyncio.sleep(0)
                except Exception:
                    logger.exception(
                        "列表字段批量写入失败 batch=%d/%d", i // batch_size + 1,
                        (len(entries) + batch_size - 1) // batch_size
                    )
            return affected
        stmt = insert_cls(VideoCache).values(entries)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": stmt.excluded.title,
                "norm_title": stmt.excluded.norm_title,
                "year": stmt.excluded.year,
                "type_id": stmt.excluded.type_id,
                "type_name": stmt.excluded.type_name,
                "remarks": stmt.excluded.remarks,
                "play_from": stmt.excluded.play_from,
                "source_updated_at": stmt.excluded.source_updated_at,
                "cached_at": stmt.excluded.cached_at,
            },
        )
        await db.execute(stmt)
        await db.commit()
        await self._evict_if_overflow(db)
        # 主动让出，避免刮削任务独占事件循环
        await asyncio.sleep(0)
        return affected

    async def _batch_upsert_detail_fields(self, db: AsyncSession, entries: list[dict]) -> set[str]:
        affected: set[str] = set()
        if not entries:
            return affected
        for e in entries:
            nt = e.get("norm_title")
            if nt:
                affected.add(nt)
        batch_size = 2000
        if len(entries) >= batch_size:
            for i in range(0, len(entries), batch_size):
                batch = entries[i : i + batch_size]
                try:
                    stmt = insert_cls(VideoCache).values(batch)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["site_id", "original_id"],
                        set_={
                            "title": stmt.excluded.title,
                            "norm_title": stmt.excluded.norm_title,
                            "year": stmt.excluded.year,
                            "poster_url": stmt.excluded.poster_url,
                            "intro": stmt.excluded.intro,
                            "area": stmt.excluded.area,
                            "actors": stmt.excluded.actors,
                            "director": stmt.excluded.director,
                            "play_url_raw": stmt.excluded.play_url_raw,
                            "has_detail": stmt.excluded.has_detail,
                            # 保留 list 阶段分类信息（videolist 不返回 type_id）
                            "type_id": stmt.excluded.type_id,
                            "type_name": stmt.excluded.type_name,
                            # 不覆盖 source_updated_at：list 阶段已写入，避免 videolist
                            # 未返回 updated_at 时将其刷为 None
                            "cached_at": stmt.excluded.cached_at,
                        },
                    )
                    await db.execute(stmt)
                    await db.commit()
                    await self._evict_if_overflow(db)
                    await asyncio.sleep(0)
                except Exception:
                    logger.exception(
                        "详情字段批量写入失败 batch=%d/%d", i // batch_size + 1,
                        (len(entries) + batch_size - 1) // batch_size
                    )
                    # 单 batch 失败不阻断后续批次
            return affected
        stmt = insert_cls(VideoCache).values(entries)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": stmt.excluded.title,
                "norm_title": stmt.excluded.norm_title,
                "year": stmt.excluded.year,
                "poster_url": stmt.excluded.poster_url,
                "intro": stmt.excluded.intro,
                "area": stmt.excluded.area,
                "actors": stmt.excluded.actors,
                "director": stmt.excluded.director,
                "play_url_raw": stmt.excluded.play_url_raw,
                "has_detail": stmt.excluded.has_detail,
                # 保留 list 阶段分类信息（videolist 不返回 type_id）
                "type_id": stmt.excluded.type_id,
                "type_name": stmt.excluded.type_name,
                # 不覆盖 source_updated_at：list 阶段已写入，避免 videolist
                # 未返回 updated_at 时将其刷为 None
                "cached_at": stmt.excluded.cached_at,
            },
        )
        await db.execute(stmt)
        await db.commit()
        await self._evict_if_overflow(db)
        # 主动让出，避免刮削任务独占事件循环
        await asyncio.sleep(0)
        return affected

    # ------------------------------------------------------------------
    # 日志
    # ------------------------------------------------------------------

    async def _add_log(
        self,
        *,
        site: Site,
        category: str | int | None,
        page: int,
        crawl_type: str,
        items_count: int,
        new_count: int,
        update_count: int,
        duration_ms: int,
    ):
        """记录单页刮削日志，内存保留最近 50 条。"""
        # 解析分类名称（中间表优先）
        type_name = "全部"
        if category is not None:
            async with self._db_factory() as db:
                mappings = await get_site_category_mappings(db, site.id)
                for c in mappings:
                    rid = c.get("remote_id")
                    if str(rid) == str(category):
                        type_name = c.get("name") or "全部"
                        break

        self._logs.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "site_id": site.id,
            "site_name": site.name,
            "category": type_name,
            "page": page,
            "crawl_type": crawl_type,
            "items_count": items_count,
            "new_count": new_count,
            "update_count": update_count,
            "duration_ms": duration_ms,
        })

    # ------------------------------------------------------------------
    # 状态持久化
    # ------------------------------------------------------------------

    async def _load_state(self) -> dict:
        async with self._db_factory() as db:
            result = await db.execute(
                select(AppConfig).where(AppConfig.key == self.STATE_KEY)
            )
            row = result.scalar_one_or_none()
            if row:
                return json.loads(row.value)
            return {}

    async def _update_stats_cache(self):
        """将统计结果预计算并写入 AppConfig，供看板 O(1) 读取。

        控制策略：
        - 每 15 分钟最多计算一次，避免频繁查询
        - 每次计算时追加一个历史快照到 crawler_stats_history
        """
        from sqlalchemy import func, case

        async with self._db_factory() as db:
            # --- 15 分钟间隔控制 ---
            MIN_INTERVAL_SECONDS = 15 * 60
            cache_result = await db.execute(
                select(AppConfig).where(AppConfig.key == self.STATS_KEY)
            )
            cache_row = cache_result.scalar_one_or_none()
            if cache_row:
                try:
                    old = json.loads(cache_row.value)
                    computed_at = old.get("computed_at")
                    if computed_at:
                        last = datetime.fromisoformat(computed_at)
                        if (_utcnow() - last).total_seconds() < MIN_INTERVAL_SECONDS:
                            return  # 不到 15 分钟，跳过
                except (json.JSONDecodeError, ValueError):
                    pass

            # 站点分组统计
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
            site_map = {}
            if site_ids:
                sites_result = await db.execute(
                    select(Site.id, Site.name).where(Site.id.in_(site_ids))
                )
                site_map = {sid: name for sid, name in sites_result.all()}

            by_site = [
                {
                    "site_id": r.site_id,
                    "site_name": site_map.get(r.site_id, f"站点 {r.site_id}"),
                    "count": r.cnt,
                    "with_detail": int(r.detail_cnt or 0),
                    "without_detail": r.cnt - int(r.detail_cnt or 0),
                }
                for r in site_rows
            ]

            # 全局统计
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

            # 聚合后视频数
            aggregated_count_result = await db.execute(
                select(func.count()).select_from(AggregatedVideoV3)
            )
            aggregated_count = aggregated_count_result.scalar_one() or 0

            total = global_row.total or 0
            with_detail = int(global_row.with_detail or 0)
            without_detail = total - with_detail

            stats = {
                "total": total,
                "by_site": by_site,
                "with_detail": with_detail,
                "without_detail": without_detail,
                "aggregated_count": aggregated_count,
                "last_updated_at": global_row.last_updated,
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }

            # --- 保存当前 stats ---
            stmt = insert_cls(AppConfig).values(
                key=self.STATS_KEY,
                value=json.dumps(stats),
                updated_at=_utcnow(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={
                    "value": json.dumps(stats),
                    "updated_at": _utcnow(),
                },
            )
            await db.execute(stmt)

            # --- 保存历史快照（同一事务） ---
            await self._append_history_snapshot(
                db, global_row.total or 0, int(global_row.with_detail or 0)
            )

            await db.commit()

    async def _append_history_snapshot(self, db, total: int, with_detail: int):
        """向 crawler_stats_history 追加一个快照，保留最近 30 天。

        每个快照：{ts: ISO时间, total: 总刮削数, with_detail: 已补全数}
        每天最多 96 个点（15 分钟间隔），30 天 ≈ 2880 条记录。
        """
        HISTORY_KEY = "crawler_stats_history"
        MAX_HISTORY_DAYS = 30
        MAX_POINTS = MAX_HISTORY_DAYS * 24 * 4  # 30天 * 每天96个点

        now_iso = datetime.now(timezone.utc).isoformat()
        new_point = {"ts": now_iso, "total": total, "with_detail": with_detail}

        # 读取现有历史
        result = await db.execute(
            select(AppConfig).where(AppConfig.key == HISTORY_KEY)
        )
        row = result.scalar_one_or_none()
        history = []
        if row:
            try:
                history = json.loads(row.value)
                if not isinstance(history, list):
                    history = []
            except json.JSONDecodeError:
                history = []

        # 追加新点，去重（同一天同一小时只保留最新的，避免重复计算）
        # 简单策略：直接追加，然后按时间排序截断
        history.append(new_point)
        history.sort(key=lambda x: x["ts"])

        # 截断：只保留最近 MAX_POINTS 条
        if len(history) > MAX_POINTS:
            history = history[-MAX_POINTS:]

        stmt = insert_cls(AppConfig).values(
            key=HISTORY_KEY,
            value=json.dumps(history),
            updated_at=_utcnow(),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["key"],
            set_={
                "value": json.dumps(history),
                "updated_at": _utcnow(),
            },
        )
        await db.execute(stmt)
        # commit 由调用方 _update_stats_cache 统一执行

    # ------------------------------------------------------------------
    # 预聚合缓存刷新（双缓冲）
    # ------------------------------------------------------------------

    async def _refresh_aggregated_cache(self, affected_norm_titles: set[str] | None = None):
        """刷新预聚合缓存：增量刷新，带 60 秒防抖。"""
        if affected_norm_titles:
            self._pending_norm_titles.update(affected_norm_titles)

        MIN_REFRESH_INTERVAL = 60
        async with self._refresh_lock:
            async with self._db_factory() as db:
                result = await db.execute(
                    select(AppConfig).where(AppConfig.key == "aggregated_cache_computed_at")
                )
                row = result.scalar_one_or_none()
                if row and row.value:
                    try:
                        last = datetime.fromisoformat(row.value)
                        if (_utcnow() - last).total_seconds() < MIN_REFRESH_INTERVAL:
                            return
                    except ValueError:
                        pass

                to_refresh = self._pending_norm_titles
                self._pending_norm_titles = set()
                ok = await refresh_aggregated_view(
                    db, affected_norm_titles=to_refresh if to_refresh else None
                )
                if ok:
                    now = _utcnow()
                    stmt = insert_cls(AppConfig).values(
                        key="aggregated_cache_computed_at",
                        value=now.isoformat(),
                        updated_at=now,
                    )
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["key"],
                        set_={"value": now.isoformat(), "updated_at": now},
                    )
                    await db.execute(stmt)
                    await db.commit()
                    await db.commit()

    async def _save_state(self, state: dict):
        async with self._db_factory() as db:
            stmt = insert_cls(AppConfig).values(
                key=self.STATE_KEY,
                value=json.dumps(state),
                updated_at=_utcnow(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={
                    "value": json.dumps(state),
                    "updated_at": _utcnow(),
                },
            )
            await db.execute(stmt)
            await db.commit()
