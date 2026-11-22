"""统一维护任务执行器适配的定向测试。

覆盖本 worker 负责的迁移面：
- Crawler.run_full_crawl / run_incremental / run_fill_job 的协调器契约
  （返回 state/details/progress、忙时 skipped、合作式取消）
- check_list_items 共享探测判定
- api/videos.py 旧 full/incremental/fill/cleanup 入口改走协调器后的
  started/job_id 语义与去重
- api/sites.py 探测结果持久化 SiteProbeLog、batch-probe 记录 site.discover
  并为新站提交 lifecycle 全量刮削

协调器用真实 MaintenanceCoordinator（注入测试库 factory），不走全局单例。
"""
import asyncio
import json

import pytest
from sqlalchemy import select

import app.services.maintenance as maintenance_module
from app.api import sites as sites_api
from app.api import videos as videos_api
from app.models import (
    AppConfig,
    MaintenanceJob,
    Site,
    SiteProbeLog,
    VideoCache,
    _utcnow,
)
from app.schemas import BatchProbeItem, FillVideolistRequest, ProbeSitesBatchRequest
from app.services.aggregator import acquire_operation_lock, release_operation_lock
from app.services.crawler import Crawler
from app.services.fill_status import fill_status_tracker
from app.services.health import ProbeResult
from app.services.maintenance import MaintenanceCoordinator

from conftest import async_session_factory


# ------------------------------------------------------------------
# 公共工具
# ------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_shared_state():
    fill_status_tracker.reset()
    videos_api._reset_cleanup_state()
    yield
    fill_status_tracker.reset()
    videos_api._reset_cleanup_state()


@pytest.fixture
def coordinator(monkeypatch):
    """真实协调器 + 测试库 factory；替换全局单例，任务行落在测试库。"""
    coord = MaintenanceCoordinator(async_session_factory)
    monkeypatch.setattr(maintenance_module, "maintenance_coordinator", coord)

    async def _no_events(channel, event):
        return None

    monkeypatch.setattr(maintenance_module.notify_sender, "send", _no_events)
    return coord


async def _make_site(db, site_id: int, name: str | None = None) -> Site:
    site = Site(
        id=site_id,
        name=name or f"site-{site_id}",
        base_url=f"http://site{site_id}.test",
        enabled=True,
        sort=0,
    )
    db.add(site)
    await db.commit()
    return site


def _list_item(oid: str) -> dict:
    return {
        "original_id": oid,
        "title": f"片{oid}",
        "year": 2024,
        "type_id": 1,
        "type": "电影",
        "remarks": "HD",
        "play_from": "ffm3u8",
        "updated_at": "2024-01-01 00:00:00",
    }


def _detail(oid: str) -> dict:
    return {
        "original_id": oid,
        "title": f"片{oid}",
        "year": 2024,
        "poster_url": "http://img.test/p.jpg",
        "intro": "简介",
        "area": "大陆",
        "actors": "演员",
        "director": "导演",
        "play_url_raw": f"第1集$http://v.test/{oid}.m3u8$ffm3u8",
        "updated_at": "2024-01-01 00:00:00",
    }


class _FakeCrawlerClient:
    """crawler 用假 SourceClient：第一页 list 可控，videolist 恒成功。"""

    list_items: dict[int, list[dict]] = {}
    list_gate: asyncio.Event | None = None

    def __init__(self, site_id, base_url, name, **kwargs):
        self.site_id = site_id

    async def list(self, t=None, pg=1, op="unknown"):
        if type(self).list_gate is not None and pg == 1:
            await type(self).list_gate.wait()
        if pg != 1:
            return []
        return [dict(item) for item in type(self).list_items.get(self.site_id, [])]

    async def videolist(self, ids, op="unknown"):
        return [_detail(str(i)) for i in ids]

    async def aclose(self):
        return None


@pytest.fixture
def fake_crawler_client(monkeypatch):
    _FakeCrawlerClient.list_items = {}
    _FakeCrawlerClient.list_gate = None
    monkeypatch.setattr("app.services.crawler.SourceClient", _FakeCrawlerClient)
    return _FakeCrawlerClient


class _FakeCleanupClient:
    """cleanup 用假 SourceClient（async 上下文管理器协议）。"""

    returned_ids: set[str] | None = None
    gate: asyncio.Event | None = None
    entered: asyncio.Event | None = None

    def __init__(self, site_id, base_url, name, **kwargs):
        self.site_id = site_id

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def videolist(self, ids, op="unknown"):
        if type(self).entered is not None:
            type(self).entered.set()
        if type(self).gate is not None:
            await type(self).gate.wait()
        keep = type(self).returned_ids
        return [
            {"original_id": str(i)}
            for i in ids
            if keep is None or str(i) in keep
        ]


@pytest.fixture
def fake_cleanup_client(monkeypatch):
    _FakeCleanupClient.returned_ids = None
    _FakeCleanupClient.gate = None
    _FakeCleanupClient.entered = None
    monkeypatch.setattr(videos_api, "SourceClient", _FakeCleanupClient)
    return _FakeCleanupClient


async def _add_cache_rows(db, site_id: int, ids: list[str], has_detail: bool = False):
    for oid in ids:
        db.add(
            VideoCache(
                site_id=site_id,
                original_id=oid,
                title=f"片{oid}",
                norm_title=f"片{oid}",
                has_detail=has_detail,
                play_url_raw=f"第1集$http://v.test/{oid}.m3u8$ffm3u8" if has_detail else None,
                cached_at=_utcnow(),
            )
        )
    await db.commit()


# ------------------------------------------------------------------
# Crawler.run_full_crawl：协调器契约
# ------------------------------------------------------------------

async def test_run_full_crawl_single_site_done(db_session, fake_crawler_client):
    await _make_site(db_session, 1)
    _FakeCrawlerClient.list_items[1] = [_list_item("1"), _list_item("2")]

    crawler = Crawler(async_session_factory)
    crawler._running = True
    progress_calls: list[tuple[int, int]] = []

    async def progress(completed, total, details):
        progress_calls.append((completed, total))

    result = await crawler.run_full_crawl(site_id=1, progress=progress)

    assert result["state"] == "done"
    assert result["progress_completed"] == 1
    assert result["progress_total"] == 1
    assert result["details"]["sites"] == [
        {"site_id": 1, "site_name": "site-1", "ok": True}
    ]
    assert progress_calls == [(1, 1)]

    rows = (
        await db_session.execute(select(VideoCache).where(VideoCache.site_id == 1))
    ).scalars().all()
    assert len(rows) == 2
    assert all(r.has_detail is True for r in rows)


async def test_run_full_crawl_lock_held_returns_skipped(
    db_session, fake_crawler_client, monkeypatch
):
    await _make_site(db_session, 1)
    monkeypatch.setattr(
        "app.services.crawler.FULL_CRAWL_LOCK_TIMEOUT", 0.1
    )
    assert await acquire_operation_lock("site_delete", timeout=1) is True
    try:
        crawler = Crawler(async_session_factory)
        crawler._running = True
        result = await crawler.run_full_crawl()
        assert result["state"] == "skipped"
        assert "site_delete" in (result["error"] or "")
    finally:
        release_operation_lock("site_delete")


async def test_run_full_crawl_cancel_marks_site_not_ok(
    db_session, fake_crawler_client
):
    await _make_site(db_session, 1)
    _FakeCrawlerClient.list_items[1] = [_list_item("1")]
    stop = asyncio.Event()
    stop.set()  # 预置取消：站点不应被刮削

    crawler = Crawler(async_session_factory)
    crawler._running = True
    result = await crawler.run_full_crawl(site_id=1, stop_event=stop)

    assert result["error"] == "已取消"
    assert result["details"]["sites"][0]["ok"] is False
    rows = (
        await db_session.execute(select(VideoCache).where(VideoCache.site_id == 1))
    ).scalars().all()
    assert rows == []


# ------------------------------------------------------------------
# Crawler.run_incremental / check_list_items
# ------------------------------------------------------------------

async def test_run_incremental_busy_returns_skipped(db_session):
    crawler = Crawler(async_session_factory)
    crawler._running = True
    crawler._site_status[1] = "full_crawling"
    result = await crawler.run_incremental(1)
    assert result["state"] == "skipped"

    # 站点不存在也要明确 skipped，不能静默成功
    crawler._site_status[2] = "idle"
    result = await crawler.run_incremental(2)
    assert result["state"] == "skipped"


async def test_run_incremental_done(db_session, fake_crawler_client):
    await _make_site(db_session, 1)
    _FakeCrawlerClient.list_items[1] = [_list_item("1")]

    crawler = Crawler(async_session_factory)
    crawler._running = True
    result = await crawler.run_incremental(1)
    assert result["state"] == "done"
    row = (
        await db_session.execute(
            select(VideoCache).where(
                VideoCache.site_id == 1, VideoCache.original_id == "1"
            )
        )
    ).scalar_one()
    assert row.title == "片1"


async def test_check_list_items_compares_last_vod_time(db_session):
    crawler = Crawler(async_session_factory)
    crawler._running = True
    site = Site(id=1, name="s", base_url="http://s.test", enabled=True)

    # 空结果 → 无更新
    assert await crawler.check_list_items(site, []) is False
    # 无历史状态 → 有更新
    assert await crawler.check_list_items(site, [_list_item("1")]) is True

    # 历史 last_vod_time 更新 → 无更新；更旧 → 有更新
    await crawler._save_state(
        {"sites": {"1": {"last_vod_time": "2024-06-01 00:00:00"}}}
    )
    assert await crawler.check_list_items(site, [_list_item("1")]) is False
    newer = _list_item("2")
    newer["updated_at"] = "2024-07-01 00:00:00"
    assert await crawler.check_list_items(site, [newer]) is True


# ------------------------------------------------------------------
# Crawler.run_fill_job：协调器契约 + 取消
# ------------------------------------------------------------------

async def test_run_fill_job_done_returns_details_and_progress(
    db_session, fake_crawler_client
):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1", "2", "3"])

    crawler = Crawler(async_session_factory)
    crawler._running = True
    progress_calls: list[tuple[int, int]] = []

    async def progress(completed, total, details):
        progress_calls.append((completed, total))

    result = await crawler.run_fill_job(1, progress=progress)

    assert result["state"] == "done"
    assert result["progress_completed"] == 1
    assert result["progress_total"] == 1
    assert result["details"]["fill"]["filled"] == 3
    assert result["details"]["fill"]["state"] == "done"
    assert crawler._fill_active is False
    assert (1, 1) in progress_calls


async def test_run_fill_job_busy_returns_skipped(db_session, fake_crawler_client):
    await _make_site(db_session, 1)
    crawler = Crawler(async_session_factory)
    crawler._fill_active = True
    result = await crawler.run_fill_job(1)
    assert result["state"] == "skipped"
    assert result["error"]


async def test_run_fill_job_cancel_marks_interrupted(
    db_session, fake_crawler_client
):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1", "2"])

    cancel = asyncio.Event()
    cancel.set()  # 预置取消：未处理条目计 skipped，整体 interrupted
    crawler = Crawler(async_session_factory)
    crawler._running = True
    result = await crawler.run_fill_job(1, cancel_event=cancel)

    # handler 只能自报 failed/skipped；cancelled 由协调器依据 cancel_event 标记
    assert result["state"] == "failed"
    assert result["error"] == "已取消"
    snap = fill_status_tracker.snapshot()
    assert snap["state"] == "interrupted"
    assert snap["error"] == "已取消"
    site = snap["sites"][0]
    assert site["skipped"] == 2
    assert site["filled"] == 0
    # 不留 running、不泄漏 _fill_active
    assert crawler._fill_active is False

    # 未补数据不被误标，终态也持久化
    rows = (
        await db_session.execute(select(VideoCache).where(VideoCache.site_id == 1))
    ).scalars().all()
    assert all(r.has_detail is False for r in rows)
    persisted = (
        await db_session.execute(
            select(AppConfig).where(AppConfig.key == "fill_videolist_status")
        )
    ).scalar_one()
    assert json.loads(persisted.value)["state"] == "interrupted"


# ------------------------------------------------------------------
# api/videos.py：旧入口改走协调器
# ------------------------------------------------------------------

async def test_trigger_full_returns_real_job_and_dedupes(
    db_session, fake_crawler_client, coordinator, monkeypatch
):
    await _make_site(db_session, 1)
    _FakeCrawlerClient.list_items[1] = [_list_item("1")]
    _FakeCrawlerClient.list_gate = asyncio.Event()  # 卡住第一次刮削

    crawler = Crawler(async_session_factory)
    crawler._running = True
    monkeypatch.setattr(videos_api.scheduler_module, "crawler", crawler)

    r1 = await videos_api.trigger_full()
    assert r1["started"] is True
    assert r1["job_id"]
    assert "已启动" in r1["message"]

    # 任务在途时重复触发：去重，不能假报已启动
    r2 = await videos_api.trigger_full()
    assert r2["started"] is False
    assert r2["job_id"] == r1["job_id"]
    assert "未重复启动" in r2["message"]

    _FakeCrawlerClient.list_gate.set()
    final = await coordinator.wait(r1["job_id"])
    assert final["state"] == "done"
    # 任务行落在测试库
    row = await db_session.get(MaintenanceJob, r1["job_id"])
    assert row is not None and row.kind == "crawl.full" and row.trigger == "manual"


async def test_trigger_incremental_via_api(
    db_session, fake_crawler_client, coordinator, monkeypatch
):
    await _make_site(db_session, 1)
    _FakeCrawlerClient.list_items[1] = [_list_item("1")]

    crawler = Crawler(async_session_factory)
    crawler._running = True
    monkeypatch.setattr(videos_api.scheduler_module, "crawler", crawler)

    r = await videos_api.trigger_incremental(1)
    assert r["started"] is True
    assert r["site_id"] == 1
    final = await coordinator.wait(r["job_id"])
    assert final["state"] == "done"


async def test_fill_api_submits_detail_fill_job(
    db_session, fake_crawler_client, coordinator, monkeypatch
):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1"])

    crawler = Crawler(async_session_factory)
    crawler._running = True
    monkeypatch.setattr(videos_api.scheduler_module, "crawler", crawler)

    resp = await videos_api.fill_videolist(FillVideolistRequest(site_id=None))
    assert resp.started is True
    assert "已启动" in resp.message

    # 等协调器任务收尾后，tracker 与 job 详情一致
    active = coordinator.find_active("detail.fill")
    assert active is not None
    final = await coordinator.wait(active["id"])
    assert final["state"] == "done"

    status = await videos_api.fill_videolist_status()
    assert status.state == "done"
    assert status.filled == 1

    job_row = (
        await db_session.execute(
            select(MaintenanceJob).where(MaintenanceJob.kind == "detail.fill")
        )
    ).scalar_one()
    assert job_row.state == "done"
    assert job_row.details["fill"]["filled"] == 1


async def test_fill_api_conflict_returns_not_started(
    db_session, fake_crawler_client, coordinator, monkeypatch
):
    await _make_site(db_session, 1)
    crawler = Crawler(async_session_factory)
    crawler._fill_active = True  # 模拟任务在途
    monkeypatch.setattr(videos_api.scheduler_module, "crawler", crawler)

    resp = await videos_api.fill_videolist(FillVideolistRequest(site_id=None))
    assert resp.started is False
    assert "未重复启动" in resp.message


# ------------------------------------------------------------------
# api/videos.py：cleanup 协调器适配
# ------------------------------------------------------------------

async def test_cleanup_managed_done_reports_details(
    db_session, fake_cleanup_client
):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1", "2"], has_detail=True)
    _FakeCleanupClient.returned_ids = {"1", "2"}  # 全部有效，不删除

    progress_calls: list[dict] = []

    class _Ctx:
        def __init__(self):
            self.cancel_event = asyncio.Event()

        async def progress(self, completed, total, details):
            progress_calls.append(details)

    ctx = _Ctx()
    result = await videos_api.run_cleanup_managed(None, False, "eco", ctx)

    assert result["state"] == "done"
    assert result["details"]["cleanup"]["checked"] == 2
    assert result["details"]["cleanup"]["deleted"] == 0
    assert result["progress_completed"] == 2
    assert progress_calls  # details.cleanup 有定期回报
    assert videos_api._CLEANUP_STATE["running"] is False
    assert videos_api._CLEANUP_TASK is not None


async def test_cleanup_cancel_bridges_to_worker(db_session, fake_cleanup_client):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1", "2"], has_detail=True)
    _FakeCleanupClient.gate = asyncio.Event()
    _FakeCleanupClient.entered = asyncio.Event()

    class _Ctx:
        def __init__(self):
            self.cancel_event = asyncio.Event()

        async def progress(self, completed, total, details):
            return None

    ctx = _Ctx()
    task = asyncio.create_task(
        videos_api.run_cleanup_managed(None, False, "eco", ctx)
    )
    await asyncio.wait_for(_FakeCleanupClient.entered.wait(), timeout=5)
    ctx.cancel_event.set()
    _FakeCleanupClient.gate.set()
    result = await task

    # cancel_event 桥接到 cancel_requested，worker 边界响应后收尾
    assert videos_api._CLEANUP_STATE["cancel_requested"] is True
    assert result["state"] == "partial"
    assert result["error"] == "已取消"
    assert videos_api._CLEANUP_STATE["running"] is False


async def test_cleanup_api_start_dedupe_and_cancel(
    db_session, fake_cleanup_client, coordinator
):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1"], has_detail=True)
    _FakeCleanupClient.gate = asyncio.Event()
    _FakeCleanupClient.entered = asyncio.Event()

    r1 = await videos_api.cleanup_expired(site_id=None, dry_run=False, speed="eco")
    assert r1["started"] is True
    assert r1["job_id"]

    await asyncio.wait_for(_FakeCleanupClient.entered.wait(), timeout=5)
    # 运行中重复启动 → 去重
    r2 = await videos_api.cleanup_expired(site_id=None, dry_run=False, speed="eco")
    assert r2["started"] is False

    # 旧取消入口通过协调器 find_active + cancel 工作
    r3 = await videos_api.cleanup_expired_cancel()
    assert r3["cancelled"] is True
    _FakeCleanupClient.gate.set()
    final = await coordinator.wait(r1["job_id"])
    assert final["state"] == "cancelled"
    assert final["cancel_requested"] is True

    # 没有活动任务时取消返回 False
    r4 = await videos_api.cleanup_expired_cancel()
    assert r4["cancelled"] is False


# ------------------------------------------------------------------
# api/sites.py：探测持久化 + 嗅探记录/刮削
# ------------------------------------------------------------------

@pytest.fixture
def probe_log_db(monkeypatch):
    """探测日志写入测试库（模块级 factory 替换）。"""
    monkeypatch.setattr(sites_api, "async_session_factory", async_session_factory)


async def test_single_probe_persists_health_log(db_session, monkeypatch, probe_log_db):
    await _make_site(db_session, 1)

    async def fake_probe(site_id, base_url, name="", timeout=5.0, max_attempts=1):
        return ProbeResult(ok=False, latency_ms=None, error="超时：x")

    monkeypatch.setattr(sites_api, "health_probe", fake_probe)

    result = await sites_api.probe_site(1, db_session)
    assert result.ok is False

    logs = (
        await db_session.execute(
            select(SiteProbeLog).where(SiteProbeLog.site_id == 1)
        )
    ).scalars().all()
    # 无论 ok 与否都落日志
    assert len(logs) == 1
    assert logs[0].ok is False
    assert logs[0].error == "超时：x"


async def test_batch_probe_stream_persists_health_logs(
    db_session, monkeypatch, probe_log_db
):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)

    async def fake_probe(site_id, base_url, name="", timeout=5.0, max_attempts=1):
        if site_id == 2:
            return ProbeResult(ok=False, latency_ms=None, error="网络错误：x")
        return ProbeResult(ok=True, latency_ms=12, error=None)

    monkeypatch.setattr(sites_api, "health_probe", fake_probe)

    resp = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=None), db_session
    )
    lines = [json.loads(chunk) async for chunk in resp.body_iterator]
    assert len(lines) == 2

    logs = (
        await db_session.execute(select(SiteProbeLog).order_by(SiteProbeLog.site_id))
    ).scalars().all()
    assert len(logs) == 2
    by_site = {log.site_id: log for log in logs}
    assert by_site[1].ok is True
    assert by_site[2].ok is False
    assert by_site[2].error == "网络错误：x"


class _FakeSiteClient:
    """sites 路由用假 SourceClient（智能匹配等 _get 调用）。"""

    def __init__(self, site_id, base_url, name="", **kwargs):
        self.site_id = site_id

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def _get(self, params):
        return {"class": []}


async def test_batch_probe_records_discover_and_submits_crawl(
    db_session, fake_crawler_client, coordinator, monkeypatch, probe_log_db
):
    async def fake_probe(site_id, base_url, name="", timeout=5.0, max_attempts=1):
        return ProbeResult(ok=True, latency_ms=20, error=None)

    monkeypatch.setattr(sites_api, "health_probe", fake_probe)
    monkeypatch.setattr(sites_api, "SourceClient", _FakeSiteClient)

    crawler = Crawler(async_session_factory)
    crawler._running = True
    monkeypatch.setattr(sites_api.scheduler_module, "crawler", crawler)

    resp = await sites_api.batch_probe(
        [
            BatchProbeItem(name="新站A", url="http://newa.test"),
            BatchProbeItem(name="新站B", url="http://newb.test"),
        ],
        db_session,
    )
    assert all(r.ok and r.added for r in resp.results)

    # site.discover 完成历史已落库（coordinator.run 等待终态）
    discover = (
        await db_session.execute(
            select(MaintenanceJob).where(MaintenanceJob.kind == "site.discover")
        )
    ).scalar_one()
    assert discover.state == "done"
    assert len(discover.details["results"]) == 2

    # 新站点合并为一个 lifecycle 全量任务（crawl.full 全局去重下的正确姿势）
    crawl_job = (
        await db_session.execute(
            select(MaintenanceJob).where(MaintenanceJob.kind == "crawl.full")
        )
    ).scalar_one()
    assert crawl_job.trigger == "lifecycle"

    final = await coordinator.wait(crawl_job.id)
    assert final["state"] == "done"


async def test_trigger_full_crawl_submits_lifecycle_job(
    db_session, fake_crawler_client, coordinator
):
    await _make_site(db_session, 1)
    _FakeCrawlerClient.list_items[1] = [_list_item("1")]

    crawler = Crawler(async_session_factory)
    crawler._running = True
    await crawler.trigger_full_crawl(1)

    jobs = await coordinator.list_jobs()
    assert len(jobs) == 1
    job = jobs[0]
    assert job["kind"] == "crawl.full"
    assert job["trigger"] == "lifecycle"
    assert job["site_id"] == 1

    final = await coordinator.wait(job["id"])
    assert final["state"] == "done"


async def test_cleanup_forced_shutdown_cancels_child_worker(
    db_session, fake_cleanup_client
):
    await _make_site(db_session, 1)
    await _add_cache_rows(db_session, 1, ["1"], has_detail=True)
    _FakeCleanupClient.gate = asyncio.Event()
    _FakeCleanupClient.entered = asyncio.Event()

    class _Ctx:
        def __init__(self):
            self.cancel_event = asyncio.Event()

        async def progress(self, completed, total, details):
            return None

    task = asyncio.create_task(
        videos_api.run_cleanup_managed(None, False, "eco", _Ctx())
    )
    await asyncio.wait_for(_FakeCleanupClient.entered.wait(), timeout=5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert videos_api._CLEANUP_STATE["running"] is False
    assert not [
        pending
        for pending in asyncio.all_tasks()
        if pending is not asyncio.current_task()
        and pending.get_coro() is not None
        and pending.get_coro().__qualname__.startswith("_cleanup_worker")
    ]
