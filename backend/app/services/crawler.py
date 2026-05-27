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
        """首次全量刮削所有站点。"""
        async with self._db_factory() as db:
            sites = await self._get_enabled_sites(db)

        for site in sites:
            if not self._running:
                break
            await self._crawl_site_full(site)

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

            for cat_id in categories:
                cat_key = str(cat_id) if cat_id else "__all__"
                page = 1
                last_vod_time = None

                while self._running:
                    items = await self._fetch_list_page(client, cat_id, page)
                    if not items:
                        break

                    for item in items:
                        entry = self._build_list_entry(site.id, item)
                        async with self._db_factory() as db:
                            await self._upsert_list_fields(db, entry)

                        # 全量时统一后补 videolist
                        need_videolist.append(entry)

                    last_vod_time = items[-1].get("updated_at")

                    # 页末检测：返回不足一页说明已到末尾
                    if len(items) < 20:
                        break

                    page += 1

                    # 避免内存无限堆积
                    if len(need_videolist) >= 200:
                        await self._batch_videolist(site, client, need_videolist)
                        need_videolist = []

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

        try:
            for cat_id in categories:
                cat_key = str(cat_id) if cat_id else "__all__"
                last_vod_time = cat_states.get(cat_key, {}).get("last_vod_time")

                page = 1
                stopped = False
                new_last_vod_time = None

                while self._running and not stopped:
                    items = await self._fetch_list_page(client, cat_id, page)
                    if not items:
                        break

                    for item in items:
                        item_vod_time = item.get("updated_at")

                        # 遇旧即停
                        if last_vod_time and item_vod_time and item_vod_time <= last_vod_time:
                            stopped = True
                            break

                        # 判断是否需要 videolist
                        async with self._db_factory() as db:
                            existing = await self._get_cached_item(
                                db, site.id, item.get("original_id")
                            )

                        entry = self._build_list_entry(site.id, item)
                        async with self._db_factory() as db:
                            await self._upsert_list_fields(db, entry)

                        if not existing or existing.source_updated_at != item_vod_time:
                            need_videolist.append(entry)

                    if not stopped:
                        new_last_vod_time = items[-1].get("updated_at")
                        if len(items) < 20:
                            break
                        page += 1

                        if len(need_videolist) >= 200:
                            await self._batch_videolist(site, client, need_videolist)
                            need_videolist = []

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

                for entry in batch:
                    d = detail_map.get(entry["original_id"])
                    if not d:
                        continue

                    detail_entry = self._build_detail_entry(site.id, d)
                    async with self._db_factory() as db:
                        await self._upsert_detail_fields(db, detail_entry)

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
