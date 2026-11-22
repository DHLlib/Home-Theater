"""统一站点维护调度测试。

覆盖：
- 同站同轮健康 + 更新检测只有一次网络调用（共享 probe 的 items）
- 网络/解析失败记 error，绝不按 unchanged 进入 miss 退避
- 禁用站只做健康检测，不查内容更新
- 检测计划持久化到 AppConfig 并可恢复
- 每日补全时间按本地时区 04:00 计算
"""
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

import app.services.scheduler as scheduler
from app.models import Site, SiteProbeLog
from app.services.health import ProbeResult

from conftest import async_session_factory


@pytest.fixture(autouse=True)
def _reset_scheduler_state(monkeypatch):
    scheduler._maint_state.clear()
    scheduler._crawl_queued.clear()
    _drain_queue()
    monkeypatch.setattr(scheduler, "async_session_factory", async_session_factory)
    monkeypatch.setattr(scheduler, "crawler", None)

    async def _noop(*args, **kwargs):
        return None

    # 健康回调（自动禁用/恢复）沿用旧实现，这里打桩避免计数器/通知干扰
    monkeypatch.setattr(scheduler, "_on_probe_success", _noop)
    monkeypatch.setattr(scheduler, "_on_probe_failure", _noop)
    monkeypatch.setattr(scheduler.playback_guard, "wait_until_idle", _noop)
    yield
    scheduler._maint_state.clear()
    scheduler._crawl_queued.clear()
    _drain_queue()


def _drain_queue() -> None:
    while not scheduler._crawl_queue.empty():
        scheduler._crawl_queue.get_nowait()
        scheduler._crawl_queue.task_done()


async def _make_site(db, site_id: int, *, enabled: bool = True) -> Site:
    site = Site(
        id=site_id,
        name=f"site-{site_id}",
        base_url=f"http://site{site_id}.test",
        enabled=enabled,
        sort=0,
    )
    db.add(site)
    await db.commit()
    return site


class _FakeCrawler:
    """记录 check_list_items 调用；results: site_id -> bool | str | Exception。"""

    def __init__(self, results: dict | None = None):
        self.results = results or {}
        self.calls: list[tuple[int, list]] = []

    async def check_list_items(self, site, items):
        self.calls.append((site.id, items))
        result = self.results.get(site.id, False)
        if isinstance(result, Exception):
            raise result
        return result


def _patch_probe(monkeypatch, results: dict[int, ProbeResult], calls: dict) -> None:
    async def _fake_probe(site_id, base_url, name="", timeout=5.0, max_attempts=1):
        calls[site_id] = calls.get(site_id, 0) + 1
        return results[site_id]

    monkeypatch.setattr(scheduler, "probe", _fake_probe)


async def _probe_logs(db, site_id: int) -> list[SiteProbeLog]:
    result = await db.execute(
        select(SiteProbeLog).where(SiteProbeLog.site_id == site_id)
    )
    return list(result.scalars().all())


async def test_health_and_update_share_single_probe(db_session, monkeypatch):
    """健康与更新同轮到期时，同一站点只发一次网络请求。"""
    await _make_site(db_session, 1, enabled=True)
    crawler = _FakeCrawler({1: False})
    monkeypatch.setattr(scheduler, "crawler", crawler)
    scheduler._maint_state[1] = {
        "next_health_at": 0,
        "next_check_at": 0,
        "miss_count": 0,
    }
    calls: dict[int, int] = {}
    _patch_probe(
        monkeypatch,
        {1: ProbeResult(ok=True, latency_ms=10, error=None, items=[{"vod_id": 1}])},
        calls,
    )

    await scheduler._tick_site_maintenance()

    assert calls[1] == 1
    assert crawler.calls == [(1, [{"vod_id": 1}])]
    logs = await _probe_logs(db_session, 1)
    assert len(logs) == 1
    assert logs[0].ok is True
    st = scheduler._maint_state[1]
    assert st["next_health_at"] > time.time()
    assert st["last_check_status"] == "unchanged"
    assert st["miss_count"] == 1
    assert st["interval"] == min(
        scheduler.CHECK_BASE_INTERVAL * scheduler.CHECK_MISS_BACKOFF,
        scheduler.CHECK_MAX_INTERVAL,
    )


async def test_first_update_check_delayed(db_session, monkeypatch):
    """新站点首次只健康检测，更新检测约 30 秒后才开始。"""
    await _make_site(db_session, 1, enabled=True)
    crawler = _FakeCrawler({1: True})
    monkeypatch.setattr(scheduler, "crawler", crawler)
    calls: dict[int, int] = {}
    _patch_probe(
        monkeypatch,
        {1: ProbeResult(ok=True, latency_ms=10, error=None, items=[{"vod_id": 1}])},
        calls,
    )

    before = time.time()
    await scheduler._tick_site_maintenance()

    assert calls[1] == 1
    assert crawler.calls == []
    st = scheduler._maint_state[1]
    assert st["next_check_at"] >= before + scheduler.CHECK_FIRST_DELAY - 1


async def test_network_failure_marks_error_not_unchanged(db_session, monkeypatch):
    """探测失败记 error 并按基础间隔重试，不进入 miss 退避。"""
    await _make_site(db_session, 1, enabled=True)
    crawler = _FakeCrawler()
    monkeypatch.setattr(scheduler, "crawler", crawler)
    scheduler._maint_state[1] = {
        "next_health_at": time.time() + 3600,  # 健康未到期，只走更新检测
        "next_check_at": 0,
        "miss_count": 3,
    }
    calls: dict[int, int] = {}
    _patch_probe(
        monkeypatch,
        {1: ProbeResult(ok=False, latency_ms=None, error="网络错误：boom")},
        calls,
    )

    before = time.time()
    await scheduler._tick_site_maintenance()

    assert calls[1] == 1
    assert crawler.calls == []
    st = scheduler._maint_state[1]
    assert st["last_check_status"] == "error"
    assert st["last_error"] == "网络错误：boom"
    assert st["miss_count"] == 0
    assert (
        before + scheduler.CHECK_BASE_INTERVAL - 5
        <= st["next_check_at"]
        <= time.time() + scheduler.CHECK_BASE_INTERVAL + 5
    )
    # 健康未到期：不写探测日志
    assert await _probe_logs(db_session, 1) == []


async def test_check_exception_marks_error(db_session, monkeypatch):
    """check_list_items 抛异常同样记 error，不按 unchanged 退避。"""
    await _make_site(db_session, 1, enabled=True)
    crawler = _FakeCrawler({1: RuntimeError("解析爆炸")})
    monkeypatch.setattr(scheduler, "crawler", crawler)
    scheduler._maint_state[1] = {
        "next_health_at": time.time() + 3600,
        "next_check_at": 0,
        "miss_count": 2,
    }
    _patch_probe(
        monkeypatch,
        {1: ProbeResult(ok=True, latency_ms=10, error=None, items=[{"vod_id": 1}])},
        {},
    )

    before = time.time()
    await scheduler._tick_site_maintenance()

    st = scheduler._maint_state[1]
    assert st["last_check_status"] == "error"
    assert "解析爆炸" in st["last_error"]
    assert st["miss_count"] == 0
    assert st["next_check_at"] <= time.time() + scheduler.CHECK_BASE_INTERVAL + 5
    assert st["next_check_at"] >= before + scheduler.CHECK_BASE_INTERVAL - 5


async def test_disabled_site_skips_update_check(db_session, monkeypatch):
    """禁用站只做健康恢复检测，不做内容更新检查。"""
    await _make_site(db_session, 1, enabled=False)
    crawler = _FakeCrawler({1: True})
    monkeypatch.setattr(scheduler, "crawler", crawler)
    scheduler._maint_state[1] = {"next_health_at": 0, "next_check_at": 0}
    calls: dict[int, int] = {}
    _patch_probe(
        monkeypatch,
        {1: ProbeResult(ok=True, latency_ms=5, error=None, items=[{"vod_id": 1}])},
        calls,
    )

    await scheduler._tick_site_maintenance()

    assert calls[1] == 1
    assert crawler.calls == []
    assert scheduler._crawl_queued == set()
    assert scheduler._crawl_queue.empty()
    assert len(await _probe_logs(db_session, 1)) == 1


async def test_updated_enqueues_incremental_once(db_session, monkeypatch):
    """命中更新：状态记 updated、按基础间隔复查、入队且排队期间不重复入队。"""
    await _make_site(db_session, 1, enabled=True)
    await _make_site(db_session, 2, enabled=True)
    # bool True 与 "updated" 字符串两种返回都算命中
    crawler = _FakeCrawler({1: True, 2: "updated"})
    monkeypatch.setattr(scheduler, "crawler", crawler)
    far_future = time.time() + 3600
    scheduler._maint_state[1] = {"next_health_at": far_future, "next_check_at": 0}
    scheduler._maint_state[2] = {"next_health_at": far_future, "next_check_at": 0}
    _patch_probe(
        monkeypatch,
        {
            1: ProbeResult(ok=True, latency_ms=5, error=None, items=[{"vod_id": 1}]),
            2: ProbeResult(ok=True, latency_ms=5, error=None, items=[{"vod_id": 2}]),
        },
        {},
    )

    before = time.time()
    await scheduler._tick_site_maintenance()

    for site_id in (1, 2):
        st = scheduler._maint_state[site_id]
        assert st["last_check_status"] == "updated"
        assert st["last_error"] is None
        assert st["miss_count"] == 0
        assert st["next_check_at"] >= before + scheduler.CHECK_BASE_INTERVAL - 5
    assert scheduler._crawl_queued == {1, 2}
    assert scheduler._crawl_queue.qsize() == 2

    # 排队期间同站重复入队被去重
    assert await scheduler._enqueue_crawl(1) is False
    assert scheduler._crawl_queue.qsize() == 2


async def test_schedule_state_persist_and_restore(db_session):
    """检测计划持久化到 AppConfig 并可在重启后恢复。"""
    scheduler._maint_state[7] = {
        "next_health_at": 1700000000.0,
        "next_check_at": 1700000300.0,
        "interval": 600,
        "miss_count": 2,
        "last_check_status": "unchanged",
        "last_error": None,
    }

    await scheduler._persist_maintenance_state()
    scheduler._maint_state.clear()
    await scheduler._load_maintenance_state()

    st = scheduler._maint_state[7]
    assert st["next_health_at"] == 1700000000.0
    assert st["next_check_at"] == 1700000300.0
    assert st["miss_count"] == 2
    assert st["last_check_status"] == "unchanged"
    assert st["last_error"] is None


async def test_next_fill_run_at_is_local_time():
    """每日补全按本地时区 04:00 计算，而非 UTC。"""
    target = scheduler._next_fill_run_at()
    assert target.hour == scheduler.CRAWLER_FILL_VIDEOLIST_HOUR
    assert target.minute == scheduler.CRAWLER_FILL_VIDEOLIST_MINUTE
    assert target.second == 0
    assert target.tzinfo is not None
    now = datetime.now().astimezone()
    # 时区必须是本地时区，不能是固定的 UTC
    assert target.utcoffset() == now.utcoffset()
    assert target > now
    assert target - now <= timedelta(days=1)


async def test_get_schedule_snapshot():
    """调度快照包含健康间隔、下次补全时间与每站检测计划。"""
    scheduler._maint_state[3] = {
        "next_health_at": 1700000000.0,
        "next_check_at": None,
        "last_check_status": "error",
        "last_error": "boom",
    }

    snap = scheduler.get_schedule_snapshot()

    assert snap["health_interval_seconds"] == int(scheduler.PROBE_INTERVAL)
    assert snap["fill_next_run_at"].endswith("Z")
    site = snap["sites"]["3"]
    assert site["next_health_at"].endswith("Z")
    assert site["next_check_at"] is None
    assert site["last_check_status"] == "error"
    assert site["last_error"] == "boom"
