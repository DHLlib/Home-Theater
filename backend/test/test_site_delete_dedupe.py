"""站点地址判重与删除排队语义。

真实事故：批量嗅探把 `https://api.ffzyapi.com/api.php/provide/vod` 当成新站
加进来（库里已有 `http://.../vod/`），判重只比原字符串所以漏了；删除时又被
全量刮削占着全局操作锁，60 秒后失败，前端一直停在「删除中…」。
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import Site, VideoCache, _utcnow
from app.schemas import BatchProbeItem, BatchProbeResult, SiteCreate
from app.services import site_deleter
from app.services.aggregator import acquire_operation_lock, release_operation_lock
from app.services.site_urls import site_url_key

from conftest import async_session_factory


# ------------------------------------------------------------------
# 地址归一化
# ------------------------------------------------------------------

def test_site_url_key_ignores_scheme_and_trailing_slash():
    assert site_url_key("http://api.ffzyapi.com/api.php/provide/vod/") == site_url_key(
        "https://api.ffzyapi.com/api.php/provide/vod"
    )


def test_site_url_key_keeps_real_differences():
    base = site_url_key("https://a.test/api.php/provide/vod")
    assert site_url_key("https://a.test/api.php/provide/vod2") != base
    assert site_url_key("https://b.test/api.php/provide/vod") != base
    assert site_url_key("https://a.test:8443/api.php/provide/vod") != base


def test_site_url_key_handles_messy_input():
    assert site_url_key("  HTTPS://Example.COM/api/  ") == "example.com/api"
    assert site_url_key("example.com/api/") == "example.com/api"
    assert site_url_key("") == ""


# ------------------------------------------------------------------
# 添加判重
# ------------------------------------------------------------------

async def test_create_site_rejects_duplicate_url_with_other_scheme(db_session):
    await _call_create(
        SiteCreate(
            name="非凡资源",
            base_url="http://api.ffzyapi.com/api.php/provide/vod/",
            enabled=False,
        ),
        db_session,
    )

    with pytest.raises(HTTPException) as exc_info:
        await _call_create(
            SiteCreate(
                name="🎬非凡资源",
                base_url="https://api.ffzyapi.com/api.php/provide/vod",
                enabled=False,
            ),
            db_session,
        )
    assert exc_info.value.status_code == 409
    assert "已存在" in str(exc_info.value.detail)


async def test_create_site_rejects_duplicate_name(db_session):
    await _call_create(SiteCreate(name="A", base_url="http://a.test/api", enabled=False), db_session)
    with pytest.raises(HTTPException) as exc_info:
        await _call_create(
            SiteCreate(name="A", base_url="http://b.test/api", enabled=False), db_session
        )
    assert exc_info.value.status_code == 409


async def _call_create(site: SiteCreate, db):
    from app.api.sites import create_site

    return await create_site(site, db)


# ------------------------------------------------------------------
# 批量嗅探判重
# ------------------------------------------------------------------

async def test_batch_probe_skips_existing_url_with_other_scheme(
    db_session, monkeypatch
):
    from app.api import sites as sites_api

    db_session.add(
        Site(
            name="非凡资源",
            base_url="http://api.ffzyapi.com/api.php/provide/vod/",
            enabled=True,
            sort=0,
        )
    )
    await db_session.commit()

    async def fake_probe(item: BatchProbeItem) -> BatchProbeResult:
        return BatchProbeResult(
            name=item.name, url=item.url, ok=True, latency_ms=10,
            error=None, added=False,
        )

    async def noop_auto_match(site, db):
        return {}

    async def noop_lifecycle(new_sites):
        return None

    monkeypatch.setattr(sites_api, "_probe_one", fake_probe)
    monkeypatch.setattr(sites_api, "_auto_match_and_save", noop_auto_match)
    monkeypatch.setattr(sites_api, "_submit_lifecycle_crawl", noop_lifecycle)

    resp = await sites_api.batch_probe(
        [
            BatchProbeItem(
                name="🎬非凡资源",
                url="https://api.ffzyapi.com/api.php/provide/vod",
            )
        ],
        db_session,
    )

    assert resp.results[0].ok is True
    assert resp.results[0].added is False
    remaining = (await db_session.execute(select(Site))).scalars().all()
    assert len(remaining) == 1


# ------------------------------------------------------------------
# 删除：空站点直接删、不排队；有数据的站点排队并上报阻塞者
# ------------------------------------------------------------------

@pytest.fixture
def progress_events(monkeypatch):
    events: list[tuple[int, str, float, str]] = []

    async def fake_send(site_id: int, status: str, progress: float, message: str) -> None:
        events.append((site_id, status, progress, message))

    monkeypatch.setattr(site_deleter, "_send_progress", fake_send)
    return events


async def _make_site(db, name: str = "空站", count: int = 0) -> Site:
    site = Site(name=name, base_url="http://empty.test/api", enabled=True, sort=0)
    db.add(site)
    await db.commit()
    await db.refresh(site)
    for i in range(count):
        db.add(
            VideoCache(
                site_id=site.id,
                original_id=str(i),
                title=f"片{i}",
                norm_title=f"片{i}",
                has_detail=False,
                cached_at=_utcnow(),
            )
        )
    if count:
        await db.commit()
    return site


async def test_empty_site_delete_skips_global_lock(db_session, progress_events):
    site = await _make_site(db_session, count=0)

    # 模拟全量刮削正在持锁
    assert await acquire_operation_lock("crawl.full", timeout=1) is True
    try:
        await site_deleter.delete_site_background(site.id, site.name)
    finally:
        release_operation_lock("crawl.full")

    assert (await db_session.execute(select(Site).where(Site.id == site.id))).scalar_one_or_none() is None
    assert progress_events[-1][1] == "completed"


async def test_site_with_data_waits_then_fails_when_lock_busy(
    db_session, progress_events, monkeypatch
):
    site = await _make_site(db_session, name="有数据站", count=2)
    monkeypatch.setattr(site_deleter, "SITE_DELETE_LOCK_WAIT_SECONDS", 0.05)
    monkeypatch.setattr(site_deleter, "SITE_DELETE_LOCK_POLL_SECONDS", 0.01)

    assert await acquire_operation_lock("crawl.full", timeout=1) is True
    try:
        await site_deleter.delete_site_background(site.id, site.name)
        # 等待期间必须上报「在等哪个任务」
        waiting = [e for e in progress_events if "等待其他任务结束" in e[3]]
        assert waiting and "crawl.full" in waiting[0][3]
    finally:
        release_operation_lock("crawl.full")

    # 锁一直没释放：任务失败但站点数据保留，锁没有被误释放
    assert (await db_session.execute(select(Site).where(Site.id == site.id))).scalar_one_or_none() is not None
    assert progress_events[-1][1] == "failed"
    assert "占用太久" in progress_events[-1][3]


async def test_duplicate_delete_click_runs_once(db_session, progress_events):
    site = await _make_site(db_session, name="重复点击站", count=0)

    # 模拟同一个站点已有删除任务在途：再次点击直接返回，不再发事件
    site_deleter._pending_deletes.add(site.id)
    try:
        await site_deleter.delete_site_background(site.id, site.name)
    finally:
        site_deleter._pending_deletes.discard(site.id)

    assert progress_events == []
    remaining = (
        await db_session.execute(select(Site).where(Site.id == site.id))
    ).scalar_one_or_none()
    assert remaining is not None
