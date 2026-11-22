"""批量补全 videolist 的状态机、熔断与恢复语义测试。"""
import asyncio
import json

import pytest
from sqlalchemy import select

from app.models import AppConfig, Site, VideoCache, _utcnow
from app.schemas import FillStatus, FillVideolistRequest
from app.services.aggregator import acquire_operation_lock, release_operation_lock
from app.services.crawler import Crawler
from app.services.fill_status import FillStatusTracker, fill_status_tracker
from app.services.source_client import SourceHttpError

from conftest import async_session_factory


@pytest.fixture(autouse=True)
def _reset_tracker():
    fill_status_tracker.reset()
    yield
    fill_status_tracker.reset()


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


async def _add_missing_rows(db, site_id: int, ids: list[str]) -> None:
    for oid in ids:
        db.add(
            VideoCache(
                site_id=site_id,
                original_id=oid,
                title=f"片{oid}",
                norm_title=f"片{oid}",
                has_detail=False,
                cached_at=_utcnow(),
            )
        )
    await db.commit()


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


class _FakeClient:
    """按 site_id 分发行为的假 SourceClient。

    handlers: site_id -> callable(ids) -> list[dict]（抛异常即模拟失败）
    """

    handlers: dict = {}
    calls: list = []

    def __init__(self, site_id, base_url, name, **kwargs):
        self.site_id = site_id
        self.name = name

    async def videolist(self, ids, op="unknown"):
        type(self).calls.append((self.site_id, list(ids)))
        handler = type(self).handlers.get(self.site_id)
        if handler is None:
            return [_detail(str(i)) for i in ids]
        return handler(ids)

    async def aclose(self):
        return None


@pytest.fixture
def fake_client(monkeypatch):
    _FakeClient.handlers = {}
    _FakeClient.calls = []
    monkeypatch.setattr("app.services.crawler.SourceClient", _FakeClient)
    return _FakeClient


async def _cache_row(db, site_id: int, oid: str) -> VideoCache | None:
    result = await db.execute(
        select(VideoCache).where(
            VideoCache.site_id == site_id, VideoCache.original_id == oid
        )
    )
    return result.scalar_one_or_none()


# ------------------------------------------------------------------
# 状态流转：全部成功 → done
# ------------------------------------------------------------------

async def test_fill_done_updates_status_and_marks_detail(db_session, fake_client):
    await _make_site(db_session, 1)
    ids = [str(i) for i in range(1, 26)]  # 25 条 → 2 个子批（20 + 5）
    await _add_missing_rows(db_session, 1, ids)

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    assert result["state"] == "done"
    assert result["missing"] == 25
    assert result["filled"] == 25
    assert result["failed"] == 0
    assert result["skipped"] == 0
    assert result["completed_sites"] == 1
    assert result["total_sites"] == 1
    assert result["started_at"] and result["finished_at"]
    site = result["sites"][0]
    assert site["state"] == "done"
    assert site["missing"] == 25 and site["filled"] == 25

    # 2 个子批（20 + 5），无重试风暴
    assert len(fake_client.calls) == 2

    # 返回详情的条目被正确标记 has_detail=True 并写入播放地址
    row = await _cache_row(db_session, 1, "7")
    assert row is not None
    assert row.has_detail is True
    assert row.play_url_raw.startswith("第1集$")

    # 轻量持久化：任务结束后 AppConfig 里有 done 快照
    persisted = (
        await db_session.execute(
            select(AppConfig).where(AppConfig.key == FillStatusTracker.KEY)
        )
    ).scalar_one()
    assert json.loads(persisted.value)["state"] == "done"


# ------------------------------------------------------------------
# 部分失败：部分条目站点没返回 → partial，不误标 has_detail
# ------------------------------------------------------------------

async def test_fill_partial_failure_accounting(db_session, fake_client):
    await _make_site(db_session, 1)
    ids = [str(i) for i in range(1, 26)]
    await _add_missing_rows(db_session, 1, ids)

    # 站点只返回前 20 条中的偶数 id + 最后一批全部 → 部分 failed
    def handler(batch_ids):
        return [
            _detail(str(i)) for i in batch_ids if int(i) % 2 == 0 or int(i) > 20
        ]

    fake_client.handlers[1] = handler

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    site = result["sites"][0]
    assert site["state"] == "partial"
    assert site["filled"] == 15  # 10 偶数 + 5 尾部
    assert site["failed"] == 10
    assert site["filled"] + site["failed"] == site["missing"]
    # 部分失败没有异常错误，但要给出明确中文说明，不能是 None
    assert site["error"] == "10 条未返回详情或请求失败"
    assert result["state"] == "partial"
    # 总体错误沿用站点聚合逻辑，非成功站点的说明要透上来
    assert result["error"] is not None
    assert "10 条未返回详情或请求失败" in result["error"]

    # 站点没返回的条目保持 has_detail=False，不能被误标
    row = await _cache_row(db_session, 1, "3")
    assert row is not None and row.has_detail is False
    row = await _cache_row(db_session, 1, "4")
    assert row is not None and row.has_detail is True


# ------------------------------------------------------------------
# 403 熔断：立即停止该站剩余批次、不删除数据、其他站继续
# ------------------------------------------------------------------

async def test_fill_blocked_on_403_stops_site_batches(db_session, fake_client):
    await _make_site(db_session, 1)
    ids = [str(i) for i in range(1, 61)]  # 60 条 → 3 个子批
    await _add_missing_rows(db_session, 1, ids)

    def forbidden(_ids):
        raise SourceHttpError("site-1", 403)

    fake_client.handlers[1] = forbidden

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    # 第一次请求 403 即熔断：只发了一次请求，没有逐批重试
    assert len(fake_client.calls) == 1

    site = result["sites"][0]
    assert site["state"] == "blocked"
    assert site["filled"] == 0
    assert site["failed"] == 0
    assert site["skipped"] == 60
    assert "403" in (site["error"] or "")
    # 唯一站点被熔断，没有任何进展 → 整体 failed
    assert result["state"] == "failed"

    # 熔断不删除数据、不误标 has_detail
    remaining = (
        await db_session.execute(
            select(VideoCache).where(VideoCache.site_id == 1)
        )
    ).scalars().all()
    assert len(remaining) == 60
    assert all(r.has_detail is False for r in remaining)


async def test_fill_other_sites_continue_after_403(db_session, fake_client):
    await _make_site(db_session, 1, name="无尽ME")
    await _make_site(db_session, 2, name="正常站")
    await _add_missing_rows(db_session, 1, [str(i) for i in range(1, 41)])
    await _add_missing_rows(db_session, 2, [str(i) for i in range(1, 11)])

    def forbidden(_ids):
        raise SourceHttpError("无尽ME", 403)

    fake_client.handlers[1] = forbidden

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    by_id = {s["site_id"]: s for s in result["sites"]}
    assert by_id[1]["state"] == "blocked"
    assert by_id[1]["skipped"] == 40
    assert by_id[2]["state"] == "done"
    assert by_id[2]["filled"] == 10
    # 一个站完成、一个站被熔断 → 整体 partial
    assert result["state"] == "partial"
    assert result["filled"] == 10
    assert result["skipped"] == 40


# ------------------------------------------------------------------
# 单站异常不丢整个摘要
# ------------------------------------------------------------------

async def test_site_unexpected_exception_keeps_summary(
    db_session, fake_client, monkeypatch
):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)
    await _add_missing_rows(db_session, 1, ["1"])
    await _add_missing_rows(db_session, 2, ["2"])

    crawler = Crawler(async_session_factory)
    original = crawler._fill_site

    async def exploding(site, affected_all):
        if site.id == 1:
            raise RuntimeError("boom")
        await original(site, affected_all)

    monkeypatch.setattr(crawler, "_fill_site", exploding)

    result = await crawler.fill_missing_videolist()

    by_id = {s["site_id"]: s for s in result["sites"]}
    assert by_id[1]["state"] == "failed"
    assert "boom" in (by_id[1]["error"] or "")
    assert by_id[2]["state"] == "done"
    assert result["state"] == "partial"


# ------------------------------------------------------------------
# 锁冲突：started=false 且不影响在途任务
# ------------------------------------------------------------------

async def test_try_start_fill_conflict_returns_false(db_session, fake_client):
    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1", "2"])

    crawler = Crawler(async_session_factory)

    # 第一道闸门：全局操作锁被其它操作占用
    assert await acquire_operation_lock("site_delete", timeout=1) is True
    try:
        assert crawler.try_start_fill() is False
        assert fill_status_tracker.snapshot()["state"] == "idle"
    finally:
        release_operation_lock("site_delete")

    # 第二道闸门：已有补全任务在途（用事件卡住第一个任务）
    gate = asyncio.Event()

    def blocked_handler(ids):
        # 通过事件让任务停留在运行中
        return [_detail(str(i)) for i in ids]

    fake_client.handlers[1] = blocked_handler

    async def gated_fill(site, affected_all):
        await gate.wait()
        await Crawler._fill_site(crawler, site, affected_all)

    crawler._fill_site = gated_fill  # type: ignore[method-assign]
    assert crawler.try_start_fill() is True
    assert fill_status_tracker.snapshot()["state"] == "running"

    # 任务在途时重复触发 → False，状态不被重置
    assert crawler.try_start_fill() is False
    assert fill_status_tracker.snapshot()["state"] == "running"

    gate.set()
    await crawler._fill_task
    assert fill_status_tracker.snapshot()["state"] == "done"

    # 任务结束后可以再次启动
    assert crawler.try_start_fill() is True
    await crawler._fill_task
    assert fill_status_tracker.snapshot()["state"] == "done"


# ------------------------------------------------------------------
# 重启语义：遗留 running → interrupted
# ------------------------------------------------------------------

async def test_restart_marks_running_task_interrupted(db_session):
    tracker = FillStatusTracker()
    tracker.begin()
    tracker.set_sites([(1, "站点A"), (2, "站点B")])
    tracker.site_finished(1, "done", filled=5, failed=0, skipped=0)
    tracker.site_started(2, 10)
    tracker.site_progress(2, filled=3, failed=1)
    await tracker.persist(async_session_factory)

    # 模拟进程重启：新实例从持久化恢复
    recovered = FillStatusTracker()
    await recovered.recover_interrupted(async_session_factory)

    snap = recovered.snapshot()
    assert snap["state"] == "interrupted"
    assert snap["finished_at"] is not None
    assert snap["error"]
    by_id = {s["site_id"]: s for s in snap["sites"]}
    # 已完成的站点保留原状，做到一半的站点标 failed
    assert by_id[1]["state"] == "done"
    assert by_id[1]["filled"] == 5
    assert by_id[2]["state"] == "failed"
    assert by_id[2]["filled"] == 3

    # interrupted 也会写回持久化，下次启动不会重复告警
    persisted = (
        await db_session.execute(
            select(AppConfig).where(AppConfig.key == FillStatusTracker.KEY)
        )
    ).scalar_one()
    assert json.loads(persisted.value)["state"] == "interrupted"


async def test_recover_keeps_finished_task_untouched(db_session):
    tracker = FillStatusTracker()
    tracker.begin()
    tracker.set_sites([(1, "站点A")])
    tracker.site_finished(1, "done", filled=3, failed=0, skipped=0)
    tracker.finish("done")
    await tracker.persist(async_session_factory)

    recovered = FillStatusTracker()
    await recovered.recover_interrupted(async_session_factory)
    assert recovered.snapshot()["state"] == "done"


# ------------------------------------------------------------------
# API 契约：POST 返回 started + status；GET status 返回真实状态
# ------------------------------------------------------------------

async def test_api_post_returns_started_and_status(db_session, fake_client, monkeypatch):
    from app.api import videos as videos_api

    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1"])

    crawler = Crawler(async_session_factory)
    monkeypatch.setattr(videos_api.scheduler_module, "crawler", crawler)
    from app.services.maintenance import MaintenanceCoordinator
    import app.services.maintenance as maintenance_module

    coordinator = MaintenanceCoordinator(async_session_factory)
    monkeypatch.setattr(maintenance_module, "maintenance_coordinator", coordinator)

    async def _no_events(channel, event):
        return None

    monkeypatch.setattr(maintenance_module.notify_sender, "send", _no_events)

    resp = await videos_api.fill_videolist(FillVideolistRequest(site_id=None))
    assert resp.started is True
    assert resp.status.state == "running"
    assert "已启动" in resp.message

    # 任务在途时 GET status 反映 running
    status = await videos_api.fill_videolist_status()
    assert isinstance(status, FillStatus)
    assert status.state == "running"

    active = coordinator.find_active("detail.fill")
    assert active is not None
    await coordinator.wait(active["id"])
    status = await videos_api.fill_videolist_status()
    assert status.state == "done"
    assert status.filled == 1
    assert status.sites[0].state == "done"


async def test_api_post_conflict_returns_not_started(
    db_session, fake_client, monkeypatch
):
    from app.api import videos as videos_api

    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1"])

    crawler = Crawler(async_session_factory)
    crawler._fill_active = True  # 模拟任务在途
    monkeypatch.setattr(videos_api.scheduler_module, "crawler", crawler)

    resp = await videos_api.fill_videolist(FillVideolistRequest(site_id=None))
    assert resp.started is False
    assert "未重复启动" in resp.message


# ------------------------------------------------------------------
# 边界 1：唯一站点 blocked 时总体 error 必须聚合站点错误（403 可见）
# ------------------------------------------------------------------

async def test_overall_error_aggregates_blocked_site(db_session, fake_client):
    await _make_site(db_session, 1, name="无尽ME")
    await _add_missing_rows(db_session, 1, ["1", "2"])

    def forbidden(_ids):
        raise SourceHttpError("无尽ME", 403)

    fake_client.handlers[1] = forbidden

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    assert result["state"] == "failed"
    assert result["error"] is not None
    assert "无尽ME" in result["error"]
    assert "403" in result["error"]

    # 聚合后的 error 也会持久化，重启后恢复的状态仍带原因
    persisted = (
        await db_session.execute(
            select(AppConfig).where(AppConfig.key == FillStatusTracker.KEY)
        )
    ).scalar_one()
    assert "403" in (json.loads(persisted.value)["error"] or "")


# ------------------------------------------------------------------
# 边界 2a：聚合刷新/统计完成前任务保持活跃，新任务不能抢占
# ------------------------------------------------------------------

async def test_fill_stays_active_until_refresh_done(
    db_session, fake_client, monkeypatch
):
    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1"])

    refresh_entered = asyncio.Event()
    refresh_release = asyncio.Event()

    async def gated_refresh(db, affected_norm_titles=None):
        refresh_entered.set()
        await refresh_release.wait()
        return True

    monkeypatch.setattr(
        "app.services.crawler.refresh_aggregated_view", gated_refresh
    )

    crawler = Crawler(async_session_factory)
    assert crawler.try_start_fill() is True

    # 等补全流程走到聚合刷新阶段（操作锁已释放）
    await asyncio.wait_for(refresh_entered.wait(), timeout=10)
    # 收尾期间：终态尚未发布，status 保持 running，新任务不得抢占
    assert crawler._fill_active is True
    assert fill_status_tracker.snapshot()["state"] == "running"
    assert fill_status_tracker.snapshot()["finished_at"] is None
    assert crawler.try_start_fill() is False

    refresh_release.set()
    await asyncio.wait_for(crawler._fill_task, timeout=30)
    assert crawler._fill_active is False
    # 放行、收尾完成后才发布 done
    assert fill_status_tracker.snapshot()["state"] == "done"

    # 任务彻底结束后可以再次启动
    assert crawler.try_start_fill() is True
    await crawler._fill_task


# ------------------------------------------------------------------
# 边界 2b：聚合刷新返回 False 时记 warning 并回填 pending 通道
# ------------------------------------------------------------------

async def test_refresh_skipped_backfills_pending_titles(
    db_session, fake_client, monkeypatch, caplog
):
    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1", "2"])

    async def skipped_refresh(db, affected_norm_titles=None):
        return False

    monkeypatch.setattr(
        "app.services.crawler.refresh_aggregated_view", skipped_refresh
    )

    crawler = Crawler(async_session_factory)
    with caplog.at_level("WARNING", logger="app.services.crawler"):
        result = await crawler.fill_missing_videolist()

    assert result["state"] == "done"
    # 刷新被跳过必须有 warning，不能静默
    assert any(
        "转入待刷新队列" in rec.message for rec in caplog.records
    )
    # affected titles 回填到 pending 通道，后续刷新会带上，不丢失
    assert {"片1", "片2"} <= crawler._pending_norm_titles


# ------------------------------------------------------------------
# 边界 2c：统计更新悬置期间终态不得发布（前端 refreshStats 不读旧值）
# ------------------------------------------------------------------

async def test_terminal_state_after_stats_update(
    db_session, fake_client, monkeypatch
):
    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1"])

    stats_entered = asyncio.Event()
    stats_release = asyncio.Event()

    async def gated_stats(self, force: bool = False):
        stats_entered.set()
        await stats_release.wait()

    monkeypatch.setattr(Crawler, "_update_stats_cache", gated_stats)

    crawler = Crawler(async_session_factory)
    assert crawler.try_start_fill() is True

    # 补全与聚合刷新都完成了，卡在统计更新：终态不能提前发布
    await asyncio.wait_for(stats_entered.wait(), timeout=10)
    snap = fill_status_tracker.snapshot()
    assert snap["state"] == "running"
    assert snap["finished_at"] is None
    assert crawler._fill_active is True
    assert crawler.try_start_fill() is False

    stats_release.set()
    await asyncio.wait_for(crawler._fill_task, timeout=30)
    snap = fill_status_tracker.snapshot()
    assert snap["state"] == "done"
    assert snap["finished_at"] is not None
    assert crawler._fill_active is False


# ------------------------------------------------------------------
# 边界 2d：收尾异常落 failed + error + finished_at，不泄漏 running/done
# ------------------------------------------------------------------

async def test_tail_exception_marks_failed_and_releases(
    db_session, fake_client, monkeypatch
):
    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1"])

    async def exploding_stats(self, force: bool = False):
        raise RuntimeError("stats boom")

    monkeypatch.setattr(Crawler, "_update_stats_cache", exploding_stats)

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    # 不能留下 running/done，必须是 failed 且带原因与完成时间
    assert result["state"] == "failed"
    assert "stats boom" in (result["error"] or "")
    assert result["finished_at"] is not None
    assert crawler._fill_active is False

    # 终态与原因也持久化
    persisted = (
        await db_session.execute(
            select(AppConfig).where(AppConfig.key == FillStatusTracker.KEY)
        )
    ).scalar_one()
    persisted_state = json.loads(persisted.value)
    assert persisted_state["state"] == "failed"
    assert "stats boom" in (persisted_state["error"] or "")

    # 活跃标记已释放，可以再次启动
    assert crawler.try_start_fill() is True
    await crawler._fill_task


# ------------------------------------------------------------------
# 边界 3：全部 ID 未返回详情（非 403）→ failed 且 error 为中文说明
# ------------------------------------------------------------------

async def test_all_ids_unreturned_marks_failed_with_reason(
    db_session, fake_client
):
    await _make_site(db_session, 1)
    await _add_missing_rows(db_session, 1, ["1", "2", "3"])

    # 请求成功但站点一条详情都没返回
    fake_client.handlers[1] = lambda _ids: []

    crawler = Crawler(async_session_factory)
    result = await crawler.fill_missing_videolist()

    site = result["sites"][0]
    assert site["state"] == "failed"
    assert site["filled"] == 0
    assert site["failed"] == 3
    assert site["skipped"] == 0
    assert site["error"] == "3 条未返回详情或请求失败"

    assert result["state"] == "failed"
    assert result["error"] is not None
    assert "3 条未返回详情或请求失败" in result["error"]

    # 没返回详情的条目不能被误标
    rows = (
        await db_session.execute(
            select(VideoCache).where(VideoCache.site_id == 1)
        )
    ).scalars().all()
    assert all(r.has_detail is False for r in rows)
