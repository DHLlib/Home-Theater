"""列表抓取遇到 WAF 人机校验时的退避与中止语义。

真实事故：百度云资源的 ac=list 被 Cloudflare 挑战时，抓取仍按「分类数 × 3 次」
重试（54 个分类 → 162 次请求），风控越打越热，整轮永远补不回来。
"""
import pytest

from app.models import Site
from app.services.crawler import Crawler
from app.services.source_client import SourceChallengeError

from conftest import async_session_factory


class _FakeListClient:
    name = "site-1"

    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = 0

    async def list(self, t=None, pg=None, op="unknown"):
        self.calls += 1
        return self.behaviour(self.calls)


def _no_wait(monkeypatch):
    monkeypatch.setattr(
        "app.services.crawler.WAF_CHALLENGE_BACKOFF_SECONDS", (0.0, 0.0, 0.0)
    )


async def test_list_page_waits_once_then_recovers(monkeypatch):
    _no_wait(monkeypatch)

    def behaviour(call):
        if call == 1:
            raise SourceChallengeError("site-1", 403)
        return [{"original_id": "1"}]

    client = _FakeListClient(behaviour)
    crawler = Crawler(db_factory=None)

    items = await crawler._fetch_list_page(client, None, 1, op="crawler_incremental")

    assert items == [{"original_id": "1"}]
    assert client.calls == 2


async def test_list_page_aborts_on_persistent_challenge(monkeypatch):
    _no_wait(monkeypatch)

    def behaviour(_call):
        raise SourceChallengeError("site-1", 403)

    client = _FakeListClient(behaviour)
    crawler = Crawler(db_factory=None)

    with pytest.raises(SourceChallengeError):
        await crawler._fetch_list_page(client, None, 1, op="crawler_incremental")

    # 只等一次、只试两次，不按分类继续轰炸
    assert client.calls == 2


async def test_list_page_still_retries_generic_errors(monkeypatch):
    _no_wait(monkeypatch)

    def behaviour(_call):
        raise ValueError("boom")

    client = _FakeListClient(behaviour)
    crawler = Crawler(db_factory=None)

    items = await crawler._fetch_list_page(client, None, 1, op="crawler_incremental")

    assert items == []
    assert client.calls == 3


async def _make_site(db, site_id: int = 1) -> Site:
    site = Site(
        id=site_id,
        name="百度云资源",
        base_url="http://site.test/api",
        enabled=True,
        sort=0,
    )
    db.add(site)
    await db.commit()
    return site


async def test_run_incremental_reports_challenge_as_failure(db_session, monkeypatch):
    """被挑战时任务要显示「人机校验拦截」，而不是静默 done/已取消。"""
    await _make_site(db_session)
    crawler = Crawler(async_session_factory)

    async def challenged(_site, stop_event=None):
        raise SourceChallengeError("百度云资源", 403)

    monkeypatch.setattr(crawler, "_crawl_site_incremental", challenged)

    result = await crawler.run_incremental(site_id=1)

    assert result["state"] == "failed"
    assert "人机校验" in result["error"]
    assert "403" in result["error"]
