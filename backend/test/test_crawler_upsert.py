from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import Site, VideoCache
from app.services.crawler import Crawler


def _sample_entry(site_id: int, original_id: str, title: str, norm_title: str) -> dict:
    return {
        "site_id": site_id,
        "original_id": original_id,
        "title": title,
        "norm_title": norm_title,
        "year": 2022,
        "type_id": 1,
        "type_name": "动作片",
        "remarks": "HD",
        "play_from": "test",
        "source_updated_at": "2022-01-01 00:00:00",
        "cached_at": datetime(2022, 1, 1, 0, 0, 0),
    }


async def _make_site(db, site_id: int = 1) -> Site:
    site = Site(
        id=site_id,
        name=f"site-{site_id}",
        base_url=f"http://site{site_id}.test",
        enabled=True,
        sort=0,
    )
    db.add(site)
    await db.commit()
    return site


async def _get_video(db_session, site_id: int, original_id: str):
    result = await db_session.execute(
        select(VideoCache).where(
            VideoCache.site_id == site_id, VideoCache.original_id == original_id
        )
    )
    return result.scalar_one_or_none()


@pytest.mark.asyncio
async def test_batch_upsert_list_fields_inserts_successfully(db_session):
    await _make_site(db_session)
    crawler = Crawler(lambda: db_session)

    entries = [_sample_entry(1, "1001", "Test Video", "test video")]
    affected = await crawler._batch_upsert_list_fields(db_session, entries)

    assert affected == {"test video"}
    row = await _get_video(db_session, 1, "1001")
    assert row is not None
    assert row.title == "Test Video"


@pytest.mark.asyncio
async def test_batch_upsert_list_fields_retries_on_execute_failure(db_session, monkeypatch):
    await _make_site(db_session)
    crawler = Crawler(lambda: db_session)

    entries = [_sample_entry(1, "1001", "Test Video", "test video")]

    real_execute = db_session.execute
    call_count = 0

    async def flaky_execute(stmt, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("temporary db error")
        return await real_execute(stmt, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", flaky_execute)

    # 将重试基础间隔调短，避免测试等待过久
    import app.services.crawler as crawler_module
    monkeypatch.setattr(crawler_module, "RETRY_BASE_DELAY_SECONDS", 0.001)

    affected = await crawler._batch_upsert_list_fields(db_session, entries)
    upsert_calls = call_count

    assert affected == {"test video"}
    # 第一次失败 + 第二次成功 = 2 次 execute（upsert 阶段）
    assert upsert_calls == 2

    monkeypatch.undo()
    row = await _get_video(db_session, 1, "1001")
    assert row is not None
    assert row.title == "Test Video"


@pytest.mark.asyncio
async def test_batch_upsert_list_fields_returns_false_after_final_failure(
    db_session, monkeypatch, caplog
):
    await _make_site(db_session)
    crawler = Crawler(lambda: db_session)

    entries = [_sample_entry(1, "1001", "Test Video", "test video")]

    async def always_fail(stmt, *args, **kwargs):
        raise RuntimeError("persistent db error")

    monkeypatch.setattr(db_session, "execute", always_fail)

    import app.services.crawler as crawler_module
    monkeypatch.setattr(crawler_module, "RETRY_BASE_DELAY_SECONDS", 0.001)

    affected = await crawler._batch_upsert_list_fields(db_session, entries)

    # 写入失败不应抛异常，应返回 affected（后续批次可继续）
    assert affected == {"test video"}
    assert any("批量写入最终失败" in rec.message for rec in caplog.records)

    monkeypatch.undo()
    row = await _get_video(db_session, 1, "1001")
    assert row is None
