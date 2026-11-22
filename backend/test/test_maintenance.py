"""统一维护任务协调器与 /api/maintenance 路由的定向测试。

mock notify_sender（不触真实 PostgreSQL NOTIFY）与 crawler / cleanup 执行器，
不依赖真实外部请求。覆盖：成功/失败/跳过、并发去重、合作取消、详情进度、
重启恢复、关闭兜底、API 路由与 overview 组合。
"""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from app.api import maintenance as maintenance_api
from app.db import get_db
from app.models import (
    AppConfig,
    MaintenanceJob,
    Site,
    SiteHealthCounter,
    SiteProbeLog,
    _utcnow,
)
from app.services import maintenance as maintenance_mod
from app.services import scheduler
from app.services.maintenance import MaintenanceCoordinator
from conftest import async_session_factory


class _FakeSender:
    """记录发送事件的假 notify_sender。"""

    def __init__(self):
        self.events: list[dict] = []

    async def send(self, channel, event):
        self.events.append(
            {"channel": channel, "type": event.type, "payload": event.payload}
        )


@pytest.fixture
def fake_sender(monkeypatch):
    sender = _FakeSender()
    monkeypatch.setattr(maintenance_mod, "notify_sender", sender)
    return sender


@pytest.fixture
async def coordinator(fake_sender):
    coord = MaintenanceCoordinator(db_factory=async_session_factory)
    yield coord
    await coord.shutdown()


def _client_for(db, coord, monkeypatch):
    monkeypatch.setattr(maintenance_api, "maintenance_coordinator", coord)
    app = FastAPI()
    app.include_router(maintenance_api.router, prefix="/api")

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _db_job(job_id: str) -> dict | None:
    """绕过内存快照，直接从 DB 读任务行（验证持久化）。"""
    async with async_session_factory() as db:
        row = await db.get(MaintenanceJob, job_id)
        return maintenance_mod._row_to_dict(row) if row is not None else None


# ------------------------------------------------------------------
# 成功路径：状态、详情合并、进度持久化、SSE 轻量 payload
# ------------------------------------------------------------------

async def test_run_success_persists_details_and_progress(coordinator, db_session, fake_sender):
    async def handler(ctx):
        await ctx.progress(1, 3)
        await ctx.progress(2, 3)
        return {
            "state": "done",
            "details": {"fill": {"filled": 3}},
            "progress_completed": 3,
            "progress_total": 3,
        }

    final = await coordinator.run("detail.fill", handler)

    assert final["state"] == "done"
    assert final["progress_completed"] == 3
    assert final["progress_total"] == 3
    assert final["details"]["fill"] == {"filled": 3}
    assert final["started_at"] and final["started_at"].endswith("Z")
    assert final["finished_at"] and final["finished_at"].endswith("Z")
    assert final["created_at"].endswith("Z")

    # 任务结束后从 DB 读到的必须是同一份终态（终态必写库）
    row = await _db_job(final["id"])
    assert row["state"] == "done"
    assert row["progress_completed"] == 3
    assert row["details"]["fill"]["filled"] == 3

    # SSE payload 只含轻量字段，不带 details
    assert fake_sender.events
    for evt in fake_sender.events:
        assert evt["channel"] == "maintenance_events"
        assert evt["type"] == "maintenance_progress"
        assert set(evt["payload"]) == {
            "job_id", "kind", "state", "site_id", "trigger",
            "progress_completed", "progress_total", "cancel_requested",
        }


async def test_handler_state_partial_and_skipped(coordinator, db_session):
    async def partial(ctx):
        return {"state": "partial", "error": "部分站点失败"}

    final = await coordinator.run("crawl.full", partial)
    assert final["state"] == "partial"
    assert final["error"] == "部分站点失败"

    async def skipped(ctx):
        return {"state": "skipped", "error": "已有补全任务在运行"}

    final2 = await coordinator.run("detail.fill", skipped)
    assert final2["state"] == "skipped"
    assert final2["error"] == "已有补全任务在运行"


async def test_handler_invalid_state_falls_back_to_done(coordinator, db_session):
    async def weird(ctx):
        return {"state": "weird"}

    final = await coordinator.run("cache.cleanup", weird)
    assert final["state"] == "done"


async def test_handler_none_result_marks_done(coordinator, db_session):
    async def silent(ctx):
        return None

    final = await coordinator.run("crawl.full", silent)
    assert final["state"] == "done"


# ------------------------------------------------------------------
# 失败路径：异常 → failed，error 精简且不泄漏给事件
# ------------------------------------------------------------------

async def test_handler_exception_marks_failed(coordinator, db_session):
    async def boom(ctx):
        raise RuntimeError("db gone")

    final = await coordinator.run("crawl.full", boom)
    assert final["state"] == "failed"
    assert "RuntimeError" in final["error"]
    assert len(final["error"]) <= 500

    row = await _db_job(final["id"])
    assert row["state"] == "failed"
    assert row["finished_at"] is not None


# ------------------------------------------------------------------
# 并发去重：crawl.full 全局去重；crawl.incremental 按 (kind, site_id)
# ------------------------------------------------------------------

async def test_concurrent_submit_dedup_global_kind(coordinator, db_session):
    release = asyncio.Event()

    async def handler(ctx):
        await release.wait()
        return {"state": "done"}

    j1, j2 = await asyncio.gather(
        coordinator.submit("crawl.full", handler),
        coordinator.submit("crawl.full", handler),
    )
    assert j1["id"] == j2["id"]
    assert j2.get("deduplicated") is True
    assert not j1.get("deduplicated")

    release.set()
    final = await coordinator.wait(j1["id"])
    assert final["state"] == "done"


async def test_incremental_dedup_scoped_by_site(coordinator, db_session):
    release = asyncio.Event()

    async def handler(ctx):
        await release.wait()
        return {"state": "done"}

    j1 = await coordinator.submit("crawl.incremental", handler, site_id=1)
    j2 = await coordinator.submit("crawl.incremental", handler, site_id=2)
    assert j1["id"] != j2["id"]

    j3 = await coordinator.submit("crawl.incremental", handler, site_id=1)
    assert j3["id"] == j1["id"]
    assert j3.get("deduplicated") is True

    release.set()
    assert (await coordinator.wait(j1["id"]))["state"] == "done"
    assert (await coordinator.wait(j2["id"]))["state"] == "done"

    # 终态后同 key 可再次提交新任务
    j4 = await coordinator.submit("crawl.incremental", handler, site_id=1)
    assert j4["id"] != j1["id"]
    assert not j4.get("deduplicated")
    await coordinator.wait(j4["id"])


async def test_find_active(coordinator, db_session):
    release = asyncio.Event()

    async def handler(ctx):
        await release.wait()
        return {"state": "done"}

    assert coordinator.find_active("cache.cleanup") is None
    job = await coordinator.submit("cache.cleanup", handler)
    active = coordinator.find_active("cache.cleanup")
    assert active is not None and active["id"] == job["id"]
    release.set()
    await coordinator.wait(job["id"])
    assert coordinator.find_active("cache.cleanup") is None


# ------------------------------------------------------------------
# 合作式取消：cancel_requested 落库，handler 正常返回也标 cancelled
# ------------------------------------------------------------------

async def test_cooperative_cancel(coordinator, db_session):
    started = asyncio.Event()

    async def handler(ctx):
        started.set()
        while not ctx.cancel_event.is_set():
            await asyncio.sleep(0.01)
        return {"state": "done"}  # 正常返回，但 cancel_event 已置位

    job = await coordinator.submit("crawl.full", handler)
    await asyncio.wait_for(started.wait(), timeout=5)

    snap = await coordinator.cancel(job["id"])
    assert snap is not None
    assert snap["cancel_requested"] is True
    # 取消时尚未终态，状态仍是 running
    assert snap["state"] == "running"

    final = await coordinator.wait(job["id"])
    assert final["state"] == "cancelled"
    assert final["cancel_requested"] is True

    row = await _db_job(job["id"])
    assert row["state"] == "cancelled"
    assert row["cancel_requested"] is True


async def test_cancel_unknown_job_returns_none(coordinator, db_session):
    assert await coordinator.cancel("0" * 32) is None


async def test_cancel_race_with_finish_persists_terminal_state(coordinator, db_session):
    """回归：cancel() 的写库与任务协程的终态写库并发时，后 commit 的旧快照
    不能覆盖终态（真实出现过 DB 停在 running、finished_at 为 NULL）。"""
    for _ in range(20):
        started = asyncio.Event()

        async def handler(ctx):
            started.set()
            while not ctx.cancel_event.is_set():
                await asyncio.sleep(0)
            return {"state": "done"}

        job = await coordinator.submit("crawl.full", handler)
        await asyncio.wait_for(started.wait(), timeout=5)
        # 不等 cancel 的 flush 完成就让任务继续，最大化并发窗口
        cancel_task = asyncio.create_task(coordinator.cancel(job["id"]))
        final = await coordinator.wait(job["id"])
        await cancel_task
        assert final["state"] == "cancelled"
        row = await _db_job(job["id"])
        assert row["state"] == "cancelled"
        assert row["finished_at"] is not None


async def test_wait_unknown_job_returns_none(coordinator, db_session):
    assert await coordinator.wait("0" * 32) is None


# ------------------------------------------------------------------
# 重启恢复：queued/running（含 cancel_requested 未落地）→ interrupted，终态不动
# ------------------------------------------------------------------

async def test_recover_interrupted(coordinator, db_session):
    done_at = _utcnow()
    db_session.add(
        MaintenanceJob(id="a" * 32, kind="crawl.full", trigger="manual", state="running")
    )
    db_session.add(
        MaintenanceJob(
            id="b" * 32, kind="detail.fill", trigger="scheduled",
            state="queued", cancel_requested=True,
        )
    )
    db_session.add(
        MaintenanceJob(
            id="c" * 32, kind="cache.cleanup", trigger="manual",
            state="done", finished_at=done_at,
        )
    )
    await db_session.commit()

    await coordinator.recover_interrupted()

    for job_id in ("a" * 32, "b" * 32):
        row = await _db_job(job_id)
        assert row["state"] == "interrupted"
        assert row["error"] == "服务重启，任务中断"
        assert row["finished_at"] is not None

    done_row = await _db_job("c" * 32)
    assert done_row["state"] == "done"
    assert done_row["finished_at"] == done_at.isoformat() + "Z"


# ------------------------------------------------------------------
# 关闭：合作取消优先，超时后硬取消兜底，不遗留协程
# ------------------------------------------------------------------

async def test_shutdown_cooperative_cancel(coordinator, db_session):
    async def handler(ctx):
        while not ctx.cancel_event.is_set():
            await asyncio.sleep(0.01)
        return {"state": "done"}

    job = await coordinator.submit("crawl.full", handler)
    await asyncio.sleep(0.05)
    await coordinator.shutdown()

    row = await _db_job(job["id"])
    assert row["state"] == "cancelled"
    assert coordinator.find_active("crawl.full") is None


async def test_shutdown_hard_cancel_fallback(coordinator, db_session, monkeypatch):
    monkeypatch.setattr(maintenance_mod, "MAINTENANCE_SHUTDOWN_TIMEOUT_SECONDS", 0.2)

    async def stubborn(ctx):
        await asyncio.sleep(3600)  # 无视 cancel_event
        return {"state": "done"}

    job = await coordinator.submit("crawl.full", stubborn)
    await asyncio.sleep(0.05)
    await coordinator.shutdown()

    row = await _db_job(job["id"])
    assert row["state"] in ("cancelled", "interrupted")
    assert row["finished_at"] is not None


# ------------------------------------------------------------------
# list_jobs：DB 最新 + 内存活动覆盖
# ------------------------------------------------------------------

async def test_list_jobs_merges_memory_over_db(coordinator, db_session):
    release = asyncio.Event()

    async def handler(ctx):
        await release.wait()
        return {"state": "done"}

    async def quick(ctx):
        return None

    active = await coordinator.submit("crawl.full", handler)
    finished = await coordinator.run("detail.fill", quick)

    jobs = await coordinator.list_jobs()
    by_id = {j["id"]: j for j in jobs}
    assert by_id[active["id"]]["state"] == "running"
    assert by_id[finished["id"]]["state"] == "done"
    # 倒序：后创建的在前
    assert jobs[0]["created_at"] >= jobs[-1]["created_at"]

    active_jobs = await coordinator.list_jobs(active_only=True)
    assert [j["id"] for j in active_jobs] == [active["id"]]

    release.set()
    await coordinator.wait(active["id"])
    assert await coordinator.list_jobs(active_only=True) == []


# ------------------------------------------------------------------
# API 路由
# ------------------------------------------------------------------

async def test_api_get_unknown_job_404(db_session, coordinator, monkeypatch):
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.get(f"/api/maintenance/jobs/{'0' * 32}")
        assert resp.status_code == 404

        resp = await client.post(f"/api/maintenance/jobs/{'0' * 32}/cancel")
        assert resp.status_code == 404


async def test_api_rejects_invalid_kind(db_session, coordinator, monkeypatch):
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.post("/api/maintenance/jobs/not.a.kind", json={})
        assert resp.status_code == 400


async def test_api_incremental_requires_site_id(db_session, coordinator, monkeypatch):
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.post("/api/maintenance/jobs/crawl.incremental", json={})
        assert resp.status_code == 400


async def test_api_crawl_503_when_crawler_not_started(db_session, coordinator, monkeypatch):
    monkeypatch.setattr(scheduler, "crawler", None)
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.post("/api/maintenance/jobs/crawl.full", json={})
        assert resp.status_code == 503


async def test_api_start_crawl_full_with_fake_crawler(db_session, coordinator, monkeypatch):
    progress_calls = []

    class _FakeCrawler:
        async def run_full_crawl(self, site_id=None, stop_event=None, progress=None):
            assert stop_event is not None
            if progress is not None:
                progress_calls.append((site_id,))
                await progress(1, 1, {})
            return {"state": "done"}

    monkeypatch.setattr(scheduler, "crawler", _FakeCrawler())
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.post("/api/maintenance/jobs/crawl.full", json={})
        assert resp.status_code == 200
        job = resp.json()
        assert job["kind"] == "crawl.full"
        assert job["trigger"] == "manual"
        assert job["state"] in ("queued", "running", "done")
        assert job["created_at"].endswith("Z")

        final = await coordinator.wait(job["id"])
        assert final["state"] == "done"
        assert progress_calls == [(None,)]

        resp = await client.get(f"/api/maintenance/jobs/{job['id']}")
        assert resp.status_code == 200
        assert resp.json()["state"] == "done"


async def test_api_start_cleanup_uses_videos_adapter(db_session, coordinator, monkeypatch):
    import app.api.videos as videos_api

    calls = []

    async def fake_cleanup(site_id, dry_run, speed, ctx):
        calls.append({"site_id": site_id, "dry_run": dry_run, "speed": speed})
        await ctx.progress(5, 10, {"cleanup": {"scanned": 5}})
        return {
            "state": "done",
            "details": {"cleanup": {"done": True}},
            "progress_completed": 10,
            "progress_total": 10,
        }

    monkeypatch.setattr(videos_api, "run_cleanup_managed", fake_cleanup, raising=False)
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.post(
            "/api/maintenance/jobs/cache.cleanup",
            json={"site_id": 7, "dry_run": True, "speed": "fast"},
        )
        assert resp.status_code == 200
        job = resp.json()
        assert job["kind"] == "cache.cleanup"
        assert job["site_id"] == 7

        final = await coordinator.wait(job["id"])
        assert final["state"] == "done"
        assert final["details"]["cleanup"] == {"done": True}
        assert final["progress_completed"] == 10
        assert calls == [{"site_id": 7, "dry_run": True, "speed": "fast"}]


async def test_api_cancel_flow(db_session, coordinator, monkeypatch):
    started = asyncio.Event()

    async def handler(ctx):
        started.set()
        while not ctx.cancel_event.is_set():
            await asyncio.sleep(0.01)
        return {"state": "done"}

    job = await coordinator.submit("crawl.full", handler)
    await asyncio.wait_for(started.wait(), timeout=5)

    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.post(f"/api/maintenance/jobs/{job['id']}/cancel")
        assert resp.status_code == 200
        assert resp.json()["cancel_requested"] is True

        final = await coordinator.wait(job["id"])
        assert final["state"] == "cancelled"

        resp = await client.get("/api/maintenance/jobs", params={"active_only": True})
        assert resp.status_code == 200
        assert resp.json() == []


# ------------------------------------------------------------------
# overview：站点 + 计数器 + 最新探测 + crawler_state/stats + 调度快照
# ------------------------------------------------------------------

async def test_overview_combines_sources(db_session, coordinator, monkeypatch):
    site = Site(id=1, name="站点一", base_url="http://s1.test", enabled=True, sort=0)
    db_session.add(site)
    db_session.add(SiteHealthCounter(site_id=1, failure_count=2, recovery_count=0))
    db_session.add(
        SiteProbeLog(site_id=1, ok=False, error="连接超时", response_time_ms=999)
    )
    await db_session.flush()
    db_session.add(SiteProbeLog(site_id=1, ok=True, error=None, response_time_ms=50))
    db_session.add(
        AppConfig(
            key="crawler_state",
            value=json.dumps({
                "sites": {"1": {
                    "last_full_crawl": "2026-01-01T00:00:00",
                    "last_incremental": "2026-01-02T00:00:00",
                }}
            }),
        )
    )
    db_session.add(
        AppConfig(
            key="crawler_stats",
            value=json.dumps({
                "by_site": [{
                    "site_id": 1, "count": 10, "with_detail": 6, "without_detail": 4,
                }]
            }),
        )
    )
    await db_session.commit()

    monkeypatch.setattr(
        scheduler,
        "get_schedule_snapshot",
        lambda: {
            "health_interval_seconds": 300,
            "fill_next_run_at": "2026-01-03T04:00:00Z",
            "sites": {"1": {
                "next_health_at": "2026-01-03T01:00:00Z",
                "next_check_at": "2026-01-03T00:30:00Z",
                "last_check_status": "ok",
                "last_error": None,
            }},
        },
        raising=False,
    )

    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.get("/api/maintenance/overview")
        assert resp.status_code == 200
        data = resp.json()

    assert set(data) == {"sites", "jobs", "schedules"}
    assert data["schedules"]["health_interval_seconds"] == 300
    assert len(data["sites"]) == 1
    s = data["sites"][0]
    assert s["site_id"] == 1
    assert s["site_name"] == "站点一"
    assert s["enabled"] is True
    assert s["health"]["failure_count"] == 2
    # 最新一条探测日志（id 更大者）生效
    assert s["health"]["last_probe_ok"] is True
    assert s["health"]["last_probe_latency_ms"] == 50
    assert s["last_crawl_at"] == "2026-01-02T00:00:00Z"
    assert s["total"] == 10
    assert s["with_detail"] == 6
    assert s["without_detail"] == 4
    assert s["next_check_at"] == "2026-01-03T00:30:00Z"
    assert s["last_check_status"] == "ok"
    assert s["active_job_ids"] == []


async def test_overview_empty_when_no_sites(db_session, coordinator, monkeypatch):
    async with _client_for(db_session, coordinator, monkeypatch) as client:
        resp = await client.get("/api/maintenance/overview")
        assert resp.status_code == 200
        data = resp.json()
    assert data["sites"] == []
    assert isinstance(data["jobs"], list)
    assert "sites" in data["schedules"]


async def test_insert_failure_does_not_start_or_reserve(coordinator, monkeypatch):
    called = False

    async def handler(ctx):
        nonlocal called
        called = True

    async def fail_insert(job_id, snapshot, created_dt):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(coordinator, "_insert_row", fail_insert)
    with pytest.raises(RuntimeError, match="无法保存任务状态"):
        await coordinator.submit("crawl.full", handler)

    assert called is False
    assert coordinator.find_active("crawl.full") is None
    assert coordinator._active == {}
