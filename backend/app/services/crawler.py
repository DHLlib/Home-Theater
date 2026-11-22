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
from dataclasses import dataclass
from datetime import datetime, timezone, date

from app.models import _utcnow
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.dialects.postgresql import insert as insert_cls

from app.constants import (
    CRAWLER_BATCH_INSERT_SIZE,
    CRAWLER_BATCH_VIDEOLIST_SIZE,
    CRAWLER_INCREMENTAL_MAX_PAGES,
    CRAWLER_PAGE_CONCURRENCY,
    CRAWLER_PAGE_SIZE_THRESHOLD,
    CRAWLER_VIDEOLIST_BATCH_SIZE,
    RETRY_BASE_DELAY_SECONDS,
    RETRY_MAX_ATTEMPTS,
)
from app.models import AggregatedVideoV3, AppConfig, Site, VideoCache
from app.services import playback_guard
from app.services.aggregator import (
    acquire_operation_lock,
    is_operation_in_progress,
    normalize_title,
    refresh_aggregated_view,
    release_operation_lock,
)
from app.services.category_mapping import get_site_category_mappings
from app.services.fill_status import fill_status_tracker
from app.services.source_client import SourceClient, SourceHttpError

logger = logging.getLogger(__name__)


@dataclass
class BatchVideolistResult:
    """批量 videolist 结果。"""
    affected: set[str]
    filled: int


@dataclass
class FillChunkResult:
    """补全任务单批（200 条）处理结果。"""
    affected: set[str]
    filled: int
    failed: int
    blocked_error: str | None = None


# videolist 返回这些状态码时视为站点级封禁：重试无意义，直接熔断该站剩余批次
FILL_BLOCK_STATUS_CODES = (401, 403)


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
        self._fill_lock = asyncio.Lock()
        self._fill_active = False  # 补全任务是否在途（同步标记，避免重复启动竞态）
        self._fill_task: asyncio.Task | None = None

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
        """首次全量刮削所有站点（站点间并发，最多 2 个同时）。
        
        使用全局操作锁，防止与删除站点、补全 videolist 等操作冲突。
        """
        # 检查全局操作锁
        current_op = is_operation_in_progress()
        if current_op:
            logger.warning("全局操作正在进行中: %s，跳过全量刮削", current_op)
            return

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

    def try_start_fill(self, site_id: int | None = None) -> bool:
        """原子地尝试启动补全任务。

        已有补全任务在途或全局操作被占用时返回 False（调用方据此回 started=false）。
        检查与标记之间没有 await，单事件循环内不会和两个调用方同时通过。
        """
        if self._fill_active or self._fill_lock.locked():
            logger.info("fill_missing_videolist 已有任务在运行，跳过 site_id=%s", site_id)
            return False
        current_op = is_operation_in_progress()
        if current_op:
            logger.info("全局操作进行中 (%s)，跳过补全 site_id=%s", current_op, site_id)
            return False
        self._fill_active = True
        # 状态先于后台协程落地，前端紧接着轮询也能看到 running
        fill_status_tracker.begin()
        self._fill_task = asyncio.create_task(
            self.fill_missing_videolist(site_id, _begun=True)
        )
        return True

    async def fill_missing_videolist(
        self, site_id: int | None = None, _begun: bool = False
    ) -> dict:
        """按站点分组批量补全缺失的 videolist 详情。

        只处理已启用站点；可按 site_id 指定单个站点。
        站点间最多 2 个并发，每个站点内按 200 条/批次请求 videolist。
        使用全局操作锁，防止与删除站点、全量刮削等操作冲突。
        全程更新 fill_status_tracker：手动触发与每日定时任务共用同一条路径。
        """
        if not _begun:
            # 直接调用（测试/历史入口）也要经过单例闸门
            if self._fill_active:
                logger.info(
                    "fill_missing_videolist 已有任务在运行，跳过 site_id=%s", site_id
                )
                return fill_status_tracker.snapshot()
            self._fill_active = True
            fill_status_tracker.begin()

        lock_op = f"fill_videolist_{site_id or 'all'}"
        acquired = False
        affected_all: set[str] = set()
        # 总体终态只在收尾（聚合刷新 + 统计更新）完成后发布，先占位
        overall = "failed"
        overall_error: str | None = "任务未执行"
        try:
            if not await acquire_operation_lock(lock_op, timeout=60):
                current_op = is_operation_in_progress()
                logger.warning(
                    "fill_missing_videolist 全局操作锁被占用 (%s)，跳过 site_id=%s",
                    current_op, site_id,
                )
                fill_status_tracker.finish(
                    "failed", error=f"全局操作被占用：{current_op}"
                )
                await fill_status_tracker.persist(self._db_factory)
                self._fill_active = False
                return fill_status_tracker.snapshot()
            acquired = True

            async with self._fill_lock:
                logger.info("fill_missing_videolist started site_id=%s", site_id)

                async with self._db_factory() as db:
                    if site_id is not None:
                        site = await db.get(Site, site_id)
                        sites = [site] if site and site.enabled else []
                    else:
                        sites = await self._get_enabled_sites(db)

                fill_status_tracker.set_sites([(s.id, s.name) for s in sites])
                await fill_status_tracker.persist(self._db_factory)

                if not sites:
                    logger.info("fill_missing_videolist 无可用站点")
                    fill_status_tracker.finish("done")
                    await fill_status_tracker.persist(self._db_factory)
                    self._fill_active = False
                    return fill_status_tracker.snapshot()

                semaphore = asyncio.Semaphore(2)

                async def _fill_one(site: Site) -> None:
                    async with semaphore:
                        await self._fill_site(site, affected_all)

                outcomes = await asyncio.gather(
                    *[_fill_one(s) for s in sites], return_exceptions=True
                )
                # 单站抛出未预期异常不能丢掉整个摘要：标 failed 后继续汇总
                for site, outcome in zip(sites, outcomes):
                    if isinstance(outcome, Exception):
                        logger.warning(
                            "补全站点 %s 异常: %s", site.name, outcome
                        )
                        info = fill_status_tracker.snapshot()["sites"]
                        current = next(
                            (s for s in info if s["site_id"] == site.id), None
                        )
                        fill_status_tracker.site_finished(
                            site.id,
                            "failed",
                            filled=current["filled"] if current else 0,
                            failed=current["failed"] if current else 0,
                            skipped=current["skipped"] if current else 0,
                            error=str(outcome),
                        )
                await fill_status_tracker.persist(self._db_factory)

                site_snaps = fill_status_tracker.snapshot()["sites"]
                site_states = [s["state"] for s in site_snaps]
                if all(state == "done" for state in site_states):
                    overall = "done"
                elif any(state in ("done", "partial") for state in site_states):
                    overall = "partial"
                else:
                    overall = "failed"
                # 聚合非成功站点的错误（含站点名），保证 403 这类阻断原因
                # 在总体状态上可见，前端不会只拿到「未知错误」
                site_errors = [
                    f"{s['site_name']}：{s['error']}"
                    for s in site_snaps
                    if s["state"] != "done" and s["error"]
                ]
                overall_error = "；".join(site_errors) if site_errors else None
        except Exception as exc:
            logger.exception("fill_missing_videolist 任务异常")
            overall = "failed"
            overall_error = str(exc)
        finally:
            if acquired:
                release_operation_lock(lock_op)

        # 收尾：聚合刷新 + 统计更新。期间 status 保持 running、_fill_active 保持
        # True——终态发布过早会让前端拿到 done 后立即 refreshStats 读到旧统计，
        # 也会让新任务抢占操作锁导致本次 affected titles 的刷新被跳过。
        # 聚合刷新必须放在操作锁释放之后：refresh_aggregated_view 检测到
        # 「全局操作进行中」会直接跳过，锁内调用等于白调（补全看似不生效的根因之一）。
        tail_error: str | None = None
        try:
            if affected_all:
                async with self._db_factory() as db:
                    refreshed = await refresh_aggregated_view(
                        db, affected_norm_titles=affected_all
                    )
                if not refreshed:
                    logger.warning(
                        "fill_missing_videolist 聚合刷新被跳过，%d 个受影响标题转入待刷新队列",
                        len(affected_all),
                    )
                    # 回填到 pending 通道（60 秒防抖），后续任意一次刷新会带上它们
                    await self._refresh_aggregated_cache(
                        affected_norm_titles=affected_all
                    )

            await self._update_stats_cache(force=True)
        except Exception as exc:
            logger.exception("fill_missing_videolist 收尾阶段异常")
            tail_error = f"收尾阶段异常：{exc}"
        finally:
            self._fill_active = False

        # 收尾完成后才发布并持久化总体终态；收尾异常不会留下 running/done
        if tail_error is not None:
            fill_status_tracker.finish("failed", error=tail_error)
        else:
            fill_status_tracker.finish(overall, error=overall_error)
        await fill_status_tracker.persist(self._db_factory)
        logger.info(
            "fill_missing_videolist completed state=%s affected=%d",
            fill_status_tracker.snapshot()["state"],
            len(affected_all),
        )
        return fill_status_tracker.snapshot()

    async def _fill_site(self, site: Site, affected_all: set[str]) -> None:
        """补全单个站点：分批请求 videolist，401/403 熔断剩余批次。"""
        async with self._db_factory() as db:
            result = await db.execute(
                select(
                    VideoCache.original_id,
                    VideoCache.type_id,
                    VideoCache.type_name,
                ).where(
                    VideoCache.site_id == site.id,
                    VideoCache.has_detail.is_(False),
                )
            )
            entries = [
                {
                    "original_id": str(r.original_id),
                    "type_id": r.type_id,
                    "type_name": r.type_name,
                }
                for r in result.all()
            ]

        missing = len(entries)
        fill_status_tracker.site_started(site.id, missing)
        if missing == 0:
            fill_status_tracker.site_finished(
                site.id, "done", filled=0, failed=0, skipped=0
            )
            return

        client = SourceClient(
            site_id=site.id, base_url=site.base_url, name=site.name
        )
        filled = 0
        failed = 0
        blocked_error: str | None = None
        try:
            for i in range(0, missing, CRAWLER_BATCH_VIDEOLIST_SIZE):
                chunk = entries[i : i + CRAWLER_BATCH_VIDEOLIST_SIZE]
                res = await self._fill_chunk(site, client, chunk, op="fill_videolist")
                filled += res.filled
                failed += res.failed
                affected_all.update(res.affected)
                fill_status_tracker.site_progress(
                    site.id, filled=filled, failed=failed
                )
                if res.blocked_error is not None:
                    blocked_error = res.blocked_error
                    break
        finally:
            await client.aclose()

        if blocked_error is not None:
            # 熔断：没来得及请求的条目记 skipped，不算 failed（根本没尝试过）
            skipped = missing - filled - failed
            fill_status_tracker.site_finished(
                site.id, "blocked",
                filled=filled, failed=failed, skipped=skipped,
                error=blocked_error,
            )
        else:
            if failed == 0:
                state = "done"
            elif filled > 0:
                state = "partial"
            else:
                state = "failed"
            # 非 blocked 的失败没有异常错误可引用，补一条明确说明，
            # 否则前端在 partial/failed 下只能显示「未知错误」
            site_error = f"{failed} 条未返回详情或请求失败" if failed > 0 else None
            fill_status_tracker.site_finished(
                site.id, state, filled=filled, failed=failed, skipped=0,
                error=site_error,
            )
        await fill_status_tracker.persist(self._db_factory)

    async def _fill_chunk(
        self, site: Site, client: SourceClient, entries: list[dict], op: str
    ) -> FillChunkResult:
        """处理一批（200 条）缺失条目，内部按 20 条/请求拆分子批。

        与 _batch_videolist 的区别：逐条区分 filled/failed，且遇到
        401/403 立即熔断返回 blocked_error，不再继续轰炸该站点。
        """
        affected: set[str] = set()
        filled = 0
        failed = 0
        detail_entries: list[dict] = []

        for j in range(0, len(entries), CRAWLER_VIDEOLIST_BATCH_SIZE):
            sub_batch = entries[j : j + CRAWLER_VIDEOLIST_BATCH_SIZE]
            ids = [e["original_id"] for e in sub_batch]

            try:
                await playback_guard.wait_until_idle()
                details = await client.videolist(ids=ids, op=op)
            except SourceHttpError as exc:
                if exc.status_code in FILL_BLOCK_STATUS_CODES:
                    logger.warning(
                        "站点 %s videolist 返回 HTTP %s，熔断该站剩余 %d 条",
                        site.name, exc.status_code, len(entries) - j,
                    )
                    return FillChunkResult(
                        affected=affected, filled=filled, failed=failed,
                        blocked_error=str(exc),
                    )
                logger.warning("批量 videolist 站点 %s 失败: %s", site.name, exc)
                failed += len(sub_batch)
                continue
            except Exception as exc:
                logger.warning("批量 videolist 站点 %s 失败: %s", site.name, exc)
                failed += len(sub_batch)
                continue

            detail_map = {str(d.get("original_id", "")): d for d in details}
            for entry in sub_batch:
                d = detail_map.get(entry["original_id"])
                if not d:
                    # 请求成功但站点没返回这条：尝试过却没补上，记 failed
                    failed += 1
                    continue
                detail_entry = self._build_detail_entry(site.id, d)
                # 保留 list 阶段的分类信息（videolist 接口不返回 type_id）
                detail_entry["type_id"] = entry.get("type_id")
                detail_entry["type_name"] = entry.get("type_name")
                detail_entries.append(detail_entry)

        if detail_entries:
            async with self._db_factory() as db:
                batch_affected = await self._batch_upsert_detail_fields(
                    db, detail_entries
                )
                affected.update(batch_affected)
            filled += len(detail_entries)

        return FillChunkResult(affected=affected, filled=filled, failed=failed)


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
        """返回当天刮削日志（最多 50 条）。"""
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
            site_state["last_full_crawl"] = _utcnow().isoformat()
            site_state["last_incremental"] = _utcnow().isoformat()
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

                while (
                    self._running
                    and not stopped
                    and page <= CRAWLER_INCREMENTAL_MAX_PAGES
                ):
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

            site_state["last_incremental"] = _utcnow().isoformat()
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
                await playback_guard.wait_until_idle()
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
    ) -> BatchVideolistResult:
        """批量 videolist 补充 detail 字段。"""
        affected: set[str] = set()
        filled = 0
        for i in range(0, len(entries), self.BATCH_SIZE):
            batch = entries[i : i + self.BATCH_SIZE]
            detail_entries: list[dict] = []

            # 每个 videolist 请求最多 20 个 ID，避免站点截断
            for j in range(0, len(batch), CRAWLER_VIDEOLIST_BATCH_SIZE):
                sub_batch = batch[j : j + CRAWLER_VIDEOLIST_BATCH_SIZE]
                ids = [e["original_id"] for e in sub_batch]

                try:
                    await playback_guard.wait_until_idle()
                    details = await client.videolist(ids=ids, op=op)
                    detail_map = {str(d.get("original_id", "")): d for d in details}

                    for entry in sub_batch:
                        d = detail_map.get(entry["original_id"])
                        if not d:
                            continue
                        detail_entry = self._build_detail_entry(site.id, d)
                        # 保留 list 阶段的分类信息（videolist 接口不返回 type_id）
                        detail_entry["type_id"] = entry.get("type_id")
                        detail_entry["type_name"] = entry.get("type_name")
                        detail_entries.append(detail_entry)

                except Exception as exc:
                    logger.warning("批量 videolist 站点 %s 失败: %s", site.name, exc)

            if detail_entries:
                async with self._db_factory() as db:
                    batch_affected = await self._batch_upsert_detail_fields(db, detail_entries)
                    affected.update(batch_affected)
                filled += len(detail_entries)

        return BatchVideolistResult(affected=affected, filled=filled)

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

    async def _execute_upsert_with_retry(self, db: AsyncSession, stmt, label: str) -> bool:
        """执行 upsert 语句并提交，带重试。失败时回滚并退避重试，最终失败记 error 返回 False。

        统一大/小批写入路径的异常处理：单批失败不再向上抛（不阻断后续批次），
        而是收敛为日志 + False；调用方据此跳过 commit 成功后的让出/淘汰逻辑。
        """
        for attempt in range(RETRY_MAX_ATTEMPTS):
            try:
                await db.execute(stmt)
                await db.commit()
                return True
            except Exception:
                await db.rollback()
                if attempt < RETRY_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** attempt))
                    continue
                logger.error("批量写入最终失败 %s", label)
                return False
        return False

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
            total_batches = (len(entries) + batch_size - 1) // batch_size
            for i in range(0, len(entries), batch_size):
                batch = entries[i : i + batch_size]
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
                ok = await self._execute_upsert_with_retry(
                    db, stmt, f"列表字段 batch={i // batch_size + 1}/{total_batches}"
                )
                if ok:
                    await self._evict_if_overflow(db)
                    await asyncio.sleep(0)
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
        ok = await self._execute_upsert_with_retry(db, stmt, "列表字段单批")
        if ok:
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
            total_batches = (len(entries) + batch_size - 1) // batch_size
            for i in range(0, len(entries), batch_size):
                batch = entries[i : i + batch_size]
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
                # 单 batch 失败不阻断后续批次
                ok = await self._execute_upsert_with_retry(
                    db, stmt, f"详情字段 batch={i // batch_size + 1}/{total_batches}"
                )
                if ok:
                    await self._evict_if_overflow(db)
                    await asyncio.sleep(0)
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
        ok = await self._execute_upsert_with_retry(db, stmt, "详情字段单批")
        if ok:
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
        """记录单页刮削日志，仅保留当天日志，最多 50 条。"""
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
            "timestamp": _utcnow().isoformat(),
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

        # 仅保留当天日志（timestamp 为 naive UTC，按本地时区展示）
        today = date.today()
        self._logs = deque(
            [
                log
                for log in self._logs
                if (
                    datetime.fromisoformat(log["timestamp"]).replace(tzinfo=timezone.utc)
                    .astimezone().date() == today
                )
            ],
            maxlen=50,
        )

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

    async def _update_stats_cache(self, force: bool = False):
        """将统计结果预计算并写入 AppConfig，供看板 O(1) 读取。

        控制策略：
        - 默认每 15 分钟最多计算一次，避免频繁查询
        - 每次计算时追加一个历史快照到 crawler_stats_history
        """
        from sqlalchemy import case

        async with self._db_factory() as db:
            # --- 15 分钟间隔控制 ---
            MIN_INTERVAL_SECONDS = 15 * 60
            if not force:
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
                            if last.tzinfo is not None:
                                last = last.replace(tzinfo=None)
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
                "computed_at": _utcnow().isoformat(),
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

        now_iso = _utcnow().isoformat()
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
                        if last.tzinfo is not None:
                            last = last.replace(tzinfo=None)
                        if (_utcnow() - last).total_seconds() < MIN_REFRESH_INTERVAL:
                            return
                    except ValueError:
                        pass

                to_refresh = set(self._pending_norm_titles)
                if not to_refresh:
                    return

                ok = await refresh_aggregated_view(
                    db, affected_norm_titles=to_refresh
                )
                if ok:
                    # 仅移除已刷新成功的 title；刷新期间新进入的 title 保留待下次处理
                    self._pending_norm_titles -= to_refresh
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
