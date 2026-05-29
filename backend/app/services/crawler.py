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
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppConfig, Site, VideoCache
from app.services.source_client import SourceClient


class Crawler:
    """资源站定时刮削器。

    状态机（每个站点独立，内存中的瞬态标记）：
        idle → full_crawling → idle
        idle → incremental_running → idle
    """

    STATE_KEY = "crawler_state"
    BATCH_SIZE = 20
    PAGE_CONCURRENCY = 5

    def __init__(self, db_factory):
        self._db_factory = db_factory
        self._site_status: dict[int, str] = {}  # site_id -> status
        self._running = False
        self._logs: deque[dict] = deque(maxlen=50)

    # ------------------------------------------------------------------
    # 公开接口
    # ------------------------------------------------------------------

    async def start(self):
        """启动时检查是否需要首次全量刮削。"""
        self._running = True

        async with self._db_factory() as db:
            result = await db.execute(select(VideoCache))
            count = len(result.scalars().all())

        if count == 0:
            await self.run_full_crawl()

    async def run_full_crawl(self):
        """首次全量刮削所有站点（站点间并发，最多 3 个同时）。"""
        async with self._db_factory() as db:
            sites = await self._get_enabled_sites(db)

        semaphore = asyncio.Semaphore(3)

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
            print(f"增量更新站点 {site_id} 失败: {exc}")
        finally:
            self._site_status[site_id] = "idle"

    async def check_updates(self):
        """5分钟检测：查各站第一页，有新内容则触发增量。"""
        async with self._db_factory() as db:
            sites = await self._get_enabled_sites(db)

        state = await self._load_state()

        for site in sites:
            if not self._running:
                break
            if self._site_status.get(site.id) in ("full_crawling", "incremental_running"):
                continue

            try:
                client = SourceClient(
                    site_id=site.id, base_url=site.base_url, name=site.name
                )
                items = await self._fetch_list_page(client, None, 1)
                await client.aclose()

                if not items:
                    continue

                first_vod_time = items[0].get("updated_at")
                site_state = state.get("sites", {}).get(str(site.id), {})
                last_vod_time = site_state.get("last_vod_time")

                if not last_vod_time or (first_vod_time and first_vod_time > last_vod_time):
                    await self.run_incremental(site.id)

            except Exception as exc:
                print(f"检测站点 {site.name} 更新失败: {exc}")

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

        try:
            state = await self._load_state()
            site_state = state.setdefault("sites", {}).setdefault(str(site.id), {})
            cat_states = site_state.setdefault("categories", {})

            categories = self._get_site_categories(site)
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
                        self._fetch_list_page(client, cat_id, p)
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
                        if len(batch_entries) >= 100:
                            async with self._db_factory() as db:
                                await self._batch_upsert_list_fields(db, batch_entries)
                            batch_entries = []

                        last_vod_time = items[-1].get("updated_at")

                        # 页末检测：返回不足一页说明已到末尾
                        if len(items) < 20:
                            reached_end = True
                            break

                        # 避免内存无限堆积
                        if len(need_videolist) >= 200:
                            await self._batch_videolist(site, client, need_videolist)
                            need_videolist = []

                    # 记录本页日志（全量）
                    self._add_log(
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
                        await self._batch_upsert_list_fields(db, batch_entries)
                    batch_entries = []

                cat_states[cat_key] = {"last_vod_time": last_vod_time}

            if need_videolist:
                await self._batch_videolist(site, client, need_videolist)

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
            print(f"全量刮削站点 {site.name} 失败: {exc}")
        finally:
            self._site_status[site.id] = "idle"
            await client.aclose()

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

        categories = self._get_site_categories(site)
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
                    items = await self._fetch_list_page(client, cat_id, page)
                    if not items:
                        break

                    page_items_count = 0
                    new_count = 0
                    update_count = 0

                    for item in items:
                        item_vod_time = item.get("updated_at")

                        # 遇旧即停
                        if last_vod_time and item_vod_time and item_vod_time <= last_vod_time:
                            stopped = True
                            break

                        page_items_count += 1

                        # 判断是否需要 videolist
                        async with self._db_factory() as db:
                            existing = await self._get_cached_item(
                                db, site.id, item.get("original_id")
                            )

                        entry = self._build_list_entry(site.id, item)

                        if not existing:
                            new_count += 1
                            batch_entries.append(entry)
                            need_videolist.append(entry)
                        elif existing.source_updated_at != item_vod_time:
                            update_count += 1
                            batch_entries.append(entry)
                            need_videolist.append(entry)
                        # 已有且未变化：跳过，不更新 cached_at，避免首页排序抖动

                        # 批量 upsert list 字段（每 100 条一刷）
                        if len(batch_entries) >= 100:
                            async with self._db_factory() as db:
                                await self._batch_upsert_list_fields(db, batch_entries)
                            batch_entries = []

                    # 记录本页日志（增量）
                    self._add_log(
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
                        if len(items) < 20:
                            break
                        page += 1

                        if len(need_videolist) >= 200:
                            await self._batch_videolist(site, client, need_videolist)
                            need_videolist = []

                # 分类结束：刷新剩余 batch_entries
                if batch_entries:
                    async with self._db_factory() as db:
                        await self._batch_upsert_list_fields(db, batch_entries)
                    batch_entries = []

                if new_last_vod_time:
                    cat_states[cat_key] = {"last_vod_time": new_last_vod_time}

            if need_videolist:
                await self._batch_videolist(site, client, need_videolist)

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

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    async def _get_enabled_sites(self, db: AsyncSession) -> list[Site]:
        result = await db.execute(
            select(Site).where(Site.enabled == True).order_by(Site.sort)
        )
        return list(result.scalars().all())

    def _get_site_categories(self, site: Site) -> list:
        """获取站点的分类 remote_id 列表。"""
        if not site.categories:
            return []
        cats = []
        for c in site.categories:
            rid = c.get("remote_id")
            if rid is not None:
                cats.append(rid)
        return cats

    async def _fetch_list_page(
        self, client: SourceClient, cat_id, page: int
    ) -> list[dict]:
        """请求单页 list，带重试。"""
        for attempt in range(3):
            try:
                t = cat_id if cat_id is not None else None
                items = await client.list(t=t, pg=page)
                return items
            except Exception:
                if attempt < 2:
                    await asyncio.sleep(1 * (2**attempt))
                continue
        return []

    async def _batch_videolist(
        self, site: Site, client: SourceClient, entries: list[dict]
    ):
        """批量 videolist 补充 detail 字段。"""
        for i in range(0, len(entries), self.BATCH_SIZE):
            batch = entries[i : i + self.BATCH_SIZE]
            ids = [e["original_id"] for e in batch]

            try:
                details = await client.videolist(ids=ids)
                detail_map = {str(d.get("original_id", "")): d for d in details}

                detail_entries = []
                for entry in batch:
                    d = detail_map.get(entry["original_id"])
                    if not d:
                        continue
                    detail_entries.append(self._build_detail_entry(site.id, d))

                if detail_entries:
                    async with self._db_factory() as db:
                        await self._batch_upsert_detail_fields(db, detail_entries)

            except Exception as exc:
                print(f"批量 videolist 站点 {site.name} 失败: {exc}")

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
        return {
            "site_id": site_id,
            "original_id": item.get("original_id", ""),
            "title": item.get("title", ""),
            "year": item.get("year"),
            "type_id": item.get("type_id"),
            "type_name": item.get("type"),
            "remarks": item.get("remarks"),
            "play_from": item.get("play_from"),
            "source_updated_at": item.get("updated_at"),
            "cached_at": datetime.now(timezone.utc),
        }

    @staticmethod
    def _build_detail_entry(site_id: int, item: dict) -> dict:
        return {
            "site_id": site_id,
            "original_id": item.get("original_id", ""),
            "title": item.get("title", ""),
            "year": item.get("year"),
            "poster_url": item.get("poster_url"),
            "intro": item.get("intro"),
            "area": item.get("area"),
            "actors": item.get("actors"),
            "director": item.get("director"),
            "play_url_raw": item.get("play_url_raw", ""),
            "source_updated_at": item.get("updated_at"),
            "has_detail": True,
            "cached_at": datetime.now(timezone.utc),
        }

    # ------------------------------------------------------------------
    # DB upsert（list / detail 分开，避免互覆）
    # ------------------------------------------------------------------

    async def _upsert_list_fields(self, db: AsyncSession, entry: dict):
        stmt = insert(VideoCache).values(**entry)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": entry.get("title"),
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
        stmt = insert(VideoCache).values(**entry)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": entry.get("title"),
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

    async def _batch_upsert_list_fields(self, db: AsyncSession, entries: list[dict]):
        if not entries:
            return
        stmt = insert(VideoCache).values(entries)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": stmt.excluded.title,
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

    async def _batch_upsert_detail_fields(self, db: AsyncSession, entries: list[dict]):
        if not entries:
            return
        stmt = insert(VideoCache).values(entries)
        stmt = stmt.on_conflict_do_update(
            index_elements=["site_id", "original_id"],
            set_={
                "title": stmt.excluded.title,
                "year": stmt.excluded.year,
                "poster_url": stmt.excluded.poster_url,
                "intro": stmt.excluded.intro,
                "area": stmt.excluded.area,
                "actors": stmt.excluded.actors,
                "director": stmt.excluded.director,
                "play_url_raw": stmt.excluded.play_url_raw,
                "has_detail": stmt.excluded.has_detail,
                # 不覆盖 source_updated_at：list 阶段已写入，避免 videolist
                # 未返回 updated_at 时将其刷为 None
                "cached_at": stmt.excluded.cached_at,
            },
        )
        await db.execute(stmt)
        await db.commit()
        await self._evict_if_overflow(db)

    # ------------------------------------------------------------------
    # 日志
    # ------------------------------------------------------------------

    def _add_log(
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
        # 解析分类名称
        type_name = "全部"
        if category is not None and site.categories:
            for c in site.categories:
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

    async def _save_state(self, state: dict):
        async with self._db_factory() as db:
            stmt = insert(AppConfig).values(
                key=self.STATE_KEY,
                value=json.dumps(state),
                updated_at=datetime.now(timezone.utc),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={
                    "value": json.dumps(state),
                    "updated_at": datetime.now(timezone.utc),
                },
            )
            await db.execute(stmt)
            await db.commit()
