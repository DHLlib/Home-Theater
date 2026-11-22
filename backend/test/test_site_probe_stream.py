"""POST /api/sites/probe-batch 的 NDJSON 流式行为测试。

mock health_probe 控制快/慢/失败站点，验证逐站流式返回、异常与超时隔离、
取消清理不遗留任务。不依赖真实互联网。
"""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from app.api import sites as sites_api
from app.db import get_db
from app.models import Site
from app.schemas import ProbeSitesBatchRequest
from app.services.health import ProbeResult


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


class _FakeProbeState:
    def __init__(self):
        self.handlers: dict[int, object] = {}
        self.calls: list[dict] = []
        self.slow_started = asyncio.Event()
        self.slow_release = asyncio.Event()
        self.slow_cancelled = asyncio.Event()
        self.slow_done = asyncio.Event()


@pytest.fixture
def fake_probe(monkeypatch) -> _FakeProbeState:
    """按 site_id 分发行为的假 health_probe，记录调用参数。"""
    state = _FakeProbeState()

    async def probe(site_id, base_url, name="", timeout=5.0, max_attempts=3):
        state.calls.append({"site_id": site_id, "max_attempts": max_attempts})
        handler = state.handlers.get(site_id)
        if handler is not None:
            return await handler()
        return ProbeResult(ok=True, latency_ms=12, error=None)

    monkeypatch.setattr(sites_api, "health_probe", probe)
    return state


def _blocked_handler(state: _FakeProbeState):
    """慢站：等待放行事件；被取消时记录并继续抛出。"""

    async def slow():
        state.slow_started.set()
        try:
            await state.slow_release.wait()
        except asyncio.CancelledError:
            state.slow_cancelled.set()
            raise
        finally:
            state.slow_done.set()
        return ProbeResult(ok=True, latency_ms=99, error=None)

    return slow


def _client_for(db):
    app = FastAPI()
    app.include_router(sites_api.router, prefix="/api")

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ------------------------------------------------------------------
# ASGI 端到端：NDJSON Content-Type、逐行完整字段、单次尝试
# ------------------------------------------------------------------

async def test_asgi_streams_ndjson_lines(db_session, fake_probe):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)

    async with _client_for(db_session) as client:
        async with client.stream("POST", "/api/sites/probe-batch", json={}) as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("application/x-ndjson")
            lines = [line async for line in resp.aiter_lines() if line.strip()]

    assert len(lines) == 2
    results = {json.loads(line)["site_id"]: json.loads(line) for line in lines}
    for site_id, payload in results.items():
        assert set(payload) == {"site_id", "site_name", "url", "ok", "latency_ms", "error"}
        assert payload["ok"] is True
        assert payload["site_name"] == f"site-{site_id}"
        assert payload["url"] == f"http://site{site_id}.test"
    # 交互探测必须单次尝试，不允许默认 3 次重试
    assert fake_probe.calls
    assert all(c["max_attempts"] == 1 for c in fake_probe.calls)


# ------------------------------------------------------------------
# 生产压缩中间件不能把逐站结果缓冲到整批结束
# ------------------------------------------------------------------

async def test_gzip_middleware_does_not_buffer_probe_stream(db_session, fake_probe):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)
    fake_probe.handlers[2] = _blocked_handler(fake_probe)
    response = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=None), db_session
    )
    app = GZipMiddleware(response, minimum_size=500)
    messages = asyncio.Queue()

    request_received = False

    async def receive():
        nonlocal request_received
        if not request_received:
            request_received = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()
        return {"type": "http.disconnect"}

    async def send(message):
        await messages.put(message)

    request = asyncio.create_task(app(
        {"type": "http", "headers": [(b"accept-encoding", b"gzip")]},
        receive,
        send,
    ))
    try:
        await asyncio.wait_for(fake_probe.slow_started.wait(), timeout=1)
        start = await asyncio.wait_for(messages.get(), timeout=1)
        assert start["type"] == "http.response.start"
        assert (b"content-encoding", b"identity") in start["headers"]
        body = await asyncio.wait_for(messages.get(), timeout=1)
        assert json.loads(body["body"])["site_id"] == 1
        assert body["more_body"] is True
        assert not fake_probe.slow_done.is_set()
        fake_probe.slow_release.set()
        await asyncio.wait_for(request, timeout=1)
        final = await asyncio.wait_for(messages.get(), timeout=1)
        assert json.loads(final["body"])["site_id"] == 2
        await asyncio.wait_for(messages.get(), timeout=1)
    finally:
        if not request.done():
            request.cancel()
            await asyncio.gather(request, return_exceptions=True)


# ------------------------------------------------------------------
# 流式语义：快站结果在慢站放行前就到达
# ------------------------------------------------------------------

async def test_fast_result_arrives_before_slow_site_finishes(db_session, fake_probe):
    await _make_site(db_session, 1)  # 快站（默认 handler 立即返回）
    await _make_site(db_session, 2)  # 慢站
    fake_probe.handlers[2] = _blocked_handler(fake_probe)

    resp = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=None), db_session
    )
    it = resp.body_iterator

    # 生成器在首次迭代时才创建探测任务；快站完成即返回第一行，
    # 如果还是 gather 一次性返回，慢站未放行前这里不可能拿到结果
    first = json.loads(await it.__anext__())
    assert first["site_id"] == 1
    assert first["ok"] is True
    # 等慢站确实开始并卡住，证明快站不是「碰巧先完成」
    await asyncio.wait_for(fake_probe.slow_started.wait(), timeout=5)
    assert not fake_probe.slow_done.is_set()

    fake_probe.slow_release.set()
    second = json.loads(await it.__anext__())
    assert second["site_id"] == 2
    with pytest.raises(StopAsyncIteration):
        await it.__anext__()


# ------------------------------------------------------------------
# 异常隔离：失败站 ok=false 且不泄漏堆栈，其它站不受影响
# ------------------------------------------------------------------

async def test_failing_site_isolated_and_no_stack_leak(db_session, fake_probe):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)

    async def boom():
        raise RuntimeError("secret-boom")

    fake_probe.handlers[2] = boom

    resp = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=None), db_session
    )
    lines = [json.loads(chunk) async for chunk in resp.body_iterator]

    assert len(lines) == 2
    by_id = {line["site_id"]: line for line in lines}
    assert by_id[1]["ok"] is True
    assert by_id[2]["ok"] is False
    assert by_id[2]["error"] is not None
    # 不允许把异常消息/堆栈透给前端
    assert "secret-boom" not in by_id[2]["error"]
    assert "RuntimeError" not in by_id[2]["error"]


# ------------------------------------------------------------------
# 超时隔离：单站有界超时 → ok=false「检测超时」
# ------------------------------------------------------------------

async def test_timeout_site_reports_friendly_error(db_session, fake_probe, monkeypatch):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)
    monkeypatch.setattr(sites_api, "BATCH_PROBE_TIMEOUT", 0.1)

    async def hang():
        await asyncio.sleep(30)
        return ProbeResult(ok=True, latency_ms=None, error=None)

    fake_probe.handlers[2] = hang

    resp = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=None), db_session
    )
    lines = [json.loads(chunk) async for chunk in resp.body_iterator]

    assert len(lines) == 2
    by_id = {line["site_id"]: line for line in lines}
    assert by_id[1]["ok"] is True
    assert by_id[2] == {
        "site_id": 2,
        "site_name": "site-2",
        "url": "http://site2.test",
        "ok": False,
        "latency_ms": None,
        "error": "检测超时",
    }


# ------------------------------------------------------------------
# 空站点集合 → 200 空流
# ------------------------------------------------------------------

async def test_empty_site_set_returns_empty_stream(db_session, fake_probe):
    async with _client_for(db_session) as client:
        async with client.stream("POST", "/api/sites/probe-batch", json={}) as resp:
            assert resp.status_code == 200
            lines = [line async for line in resp.aiter_lines() if line.strip()]
    assert lines == []
    assert fake_probe.calls == []


# ------------------------------------------------------------------
# site_ids 过滤：只检测指定站点
# ------------------------------------------------------------------

async def test_site_ids_filter_limits_scope(db_session, fake_probe):
    await _make_site(db_session, 1)
    await _make_site(db_session, 2)

    resp = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=[2]), db_session
    )
    lines = [json.loads(chunk) async for chunk in resp.body_iterator]

    assert [line["site_id"] for line in lines] == [2]


# ------------------------------------------------------------------
# 取消清理：关闭流时取消并等待未完成任务，不遗留 orphan task
# ------------------------------------------------------------------

async def test_closing_stream_cancels_and_awaits_pending_tasks(db_session, fake_probe):
    await _make_site(db_session, 1)  # 快站
    await _make_site(db_session, 2)  # 慢站
    fake_probe.handlers[2] = _blocked_handler(fake_probe)

    resp = await sites_api.probe_sites_batch(
        ProbeSitesBatchRequest(site_ids=None), db_session
    )
    it = resp.body_iterator

    first = json.loads(await it.__anext__())
    assert first["site_id"] == 1
    await asyncio.wait_for(fake_probe.slow_started.wait(), timeout=5)

    # 模拟客户端断开：关闭生成器
    await it.aclose()

    # 慢站收到取消且清理逻辑已等待任务结束（aclose 返回即代表 finally 完成）
    assert fake_probe.slow_cancelled.is_set()
    assert fake_probe.slow_done.is_set()

    # 没有遗留探测任务
    leftovers = [
        task
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task()
        and task.get_coro() is not None
        and "_line" in task.get_coro().__qualname__
    ]
    assert leftovers == []
