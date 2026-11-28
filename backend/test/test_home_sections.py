import httpx
import pytest
from fastapi import FastAPI

import app.api.videos as videos_module
from app.api.videos import router
from app.db import get_db
from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    Site,
    SystemCategory,
    VideoCache,
)


@pytest.fixture(autouse=True)
def _reset_category_caches():
    videos_module._category_filter_cache = None
    videos_module._category_filter_cache_ts = 0.0
    yield
    videos_module._category_filter_cache = None
    videos_module._category_filter_cache_ts = 0.0


async def _get_home_sections(db) -> dict:
    app = FastAPI()
    app.include_router(router, prefix="/api")

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/videos/home-sections")
    assert response.status_code == 200
    return response.json()


async def _make_site(db, site_id: int = 1, enabled: bool = True) -> Site:
    site = Site(
        id=site_id,
        name=f"site-{site_id}",
        base_url=f"https://site{site_id}.test",
        enabled=enabled,
    )
    db.add(site)
    await db.flush()
    return site


async def _add_video(
    db,
    title: str,
    category: str,
    updated_at: str | None,
    *,
    site_id: int = 1,
    type_id: int = 1,
    year: int | None = 2025,
    poster_url: str | None = None,
    original_id: str | None = None,
    remarks: str = "HD",
) -> AggregatedVideoV3:
    video = AggregatedVideoV3(
        title=title,
        norm_title=title.casefold(),
        year=year,
        poster_url=poster_url,
        latest_updated_at=updated_at,
        system_category=category,
        source_count=1,
    )
    db.add(video)
    await db.flush()
    db.add(
        AggregatedSource(
            aggregated_video_id=video.id,
            site_id=site_id,
            original_id=original_id or f"original-{video.id}",
            site_name=f"site-{site_id}",
            type_name=category,
            type_id=type_id,
            remarks=remarks,
            updated_at=updated_at,
        )
    )
    await db.flush()
    return video


@pytest.mark.asyncio
async def test_home_sections_limits_to_eight_with_deterministic_latest_order(db_session):
    await _make_site(db_session)
    db_session.add(SystemCategory(id=10, name="电影", enabled=True))
    for index in range(10):
        if index == 8:
            updated_at = "2025-02-01 00:00:00"
        elif index == 9:
            updated_at = "2025-01-15 00:00:00"
        else:
            updated_at = "2025-01-01 00:00:00"
        await _add_video(db_session, f"电影-{index}", "电影", updated_at)
    await db_session.commit()

    payload = await _get_home_sections(db_session)

    assert len(payload["sections"]) == 1
    items = payload["sections"][0]["items"]
    assert len(items) == 8
    assert [item["title"] for item in items] == [
        "电影-8",
        "电影-9",
        "电影-7",
        "电影-6",
        "电影-5",
        "电影-4",
        "电影-3",
        "电影-2",
    ]


@pytest.mark.asyncio
async def test_home_sections_uses_system_sort_and_omits_empty(db_session):
    await _make_site(db_session)
    categories = [
        SystemCategory(id=10 + index, name=name, enabled=True, sort=index)
        for index, name in enumerate(
            ["电影", "连续剧", "综艺", "动漫", "短剧", "体育", "其他"]
        )
    ]
    db_session.add_all(categories)
    db_session.add(SystemCategory(id=30, parent_id=12, name="真人秀", enabled=True))
    await _add_video(db_session, "电影内容", "电影", "2025-01-01 00:00:00")
    await _add_video(db_session, "综艺内容", "真人秀", "2025-01-02 00:00:00")
    await _add_video(db_session, "动漫内容", "动漫", "2025-01-03 00:00:00")
    await _add_video(db_session, "其他内容", "其他", "2025-01-04 00:00:00")
    await db_session.commit()

    payload = await _get_home_sections(db_session)

    assert [section["category"] for section in payload["sections"]] == [
        "电影",
        "综艺",
        "动漫",
        "其他",
    ]
    assert all(section["items"] for section in payload["sections"])
    assert payload["sections"][1]["items"][0]["title"] == "综艺内容"


@pytest.mark.asyncio
async def test_home_sections_matches_aggregated_video_source_shape(db_session):
    await _make_site(db_session)
    db_session.add(SystemCategory(id=10, name="电影", enabled=True))
    video = await _add_video(
        db_session,
        "完整卡片",
        "电影",
        "2025-03-01 12:30:00",
        year=2024,
        poster_url="https://img.test/primary.jpg",
        original_id="movie-123",
        remarks="蓝光",
    )
    db_session.add_all(
        [
            VideoCache(
                site_id=1,
                original_id="movie-123",
                title="完整卡片",
                poster_url="https://img.test/primary.jpg",
            ),
            VideoCache(
                site_id=1,
                original_id="movie-456",
                title="完整卡片",
                poster_url="https://img.test/fallback.jpg",
            ),
        ]
    )
    await db_session.commit()

    payload = await _get_home_sections(db_session)

    item = payload["sections"][0]["items"][0]
    assert item["id"] == video.id
    assert item["title"] == "完整卡片"
    assert item["year"] == 2024
    assert item["poster_url"] == "https://img.test/primary.jpg"
    assert set(item["poster_urls"]) == {
        "https://img.test/primary.jpg",
        "https://img.test/fallback.jpg",
    }
    assert item["source_count"] == 1
    assert item["sources"] == [
        {
            "site_id": 1,
            "site_name": "site-1",
            "original_id": "movie-123",
            "type": "电影",
            "type_id": 1,
            "category": None,
            "remarks": "蓝光",
            "updated_at": "2025-03-01 12:30:00",
        }
    ]


@pytest.mark.asyncio
async def test_home_sections_preserves_disabled_site_and_category_filters(db_session):
    await _make_site(db_session, 1, enabled=True)
    await _make_site(db_session, 2, enabled=False)
    db_session.add_all(
        [
            SystemCategory(id=10, name="电影", enabled=True),
            SystemCategory(id=11, parent_id=10, name="动作片", enabled=True),
            SystemCategory(id=12, name="连续剧", enabled=True),
            SystemCategory(id=13, parent_id=12, name="禁用剧集", enabled=False),
            SystemCategory(id=14, name="综艺", enabled=False),
        ]
    )
    await _add_video(db_session, "仅禁用站点", "电影", "2025-04-06 00:00:00", site_id=2)
    mixed = await _add_video(
        db_session, "多来源视频", "动作片", "2025-04-05 00:00:00"
    )
    db_session.add(
        AggregatedSource(
            aggregated_video_id=mixed.id,
            site_id=2,
            original_id="disabled-source",
            site_name="site-2",
            type_name="动作片",
            type_id=1,
        )
    )
    mixed.source_count = 2
    await _add_video(db_session, "禁用子分类", "禁用剧集", "2025-04-03 00:00:00")
    await _add_video(db_session, "禁用父分类", "综艺", "2025-04-02 00:00:00")
    await _add_video(db_session, "正常视频", "电影", "2025-04-01 00:00:00")
    await db_session.commit()

    payload = await _get_home_sections(db_session)

    assert [section["category"] for section in payload["sections"]] == ["电影"]
    items = payload["sections"][0]["items"]
    assert [item["title"] for item in items] == ["多来源视频", "正常视频"]
    assert len(items[0]["sources"]) == 2
    assert items[0]["source_count"] == 2


@pytest.mark.asyncio
async def test_home_sections_merges_children_and_puts_null_updates_last(db_session):
    await _make_site(db_session)
    db_session.add_all(
        [
            SystemCategory(id=10, name="电影", enabled=True),
            SystemCategory(id=11, parent_id=10, name="动作片", enabled=True),
            SystemCategory(id=12, parent_id=10, name="剧情片", enabled=True),
        ]
    )
    await _add_video(db_session, "动作新", "动作片", "2025-05-01 00:00:00")
    await _add_video(db_session, "剧情新", "剧情片", "2025-06-01 00:00:00")
    await _add_video(db_session, "动作次", "动作片", "2025-04-01 00:00:00")
    await _add_video(db_session, "剧情次", "剧情片", "2025-03-01 00:00:00")
    await _add_video(db_session, "无日期", "动作片", None)
    await db_session.commit()

    payload = await _get_home_sections(db_session)

    assert [item["title"] for item in payload["sections"][0]["items"]] == [
        "剧情新",
        "动作新",
        "动作次",
        "剧情次",
        "无日期",
    ]


@pytest.mark.asyncio
async def test_home_sections_fills_eight_items_after_disabled_site_filter(db_session):
    await _make_site(db_session, 1, enabled=True)
    await _make_site(db_session, 2, enabled=False)
    db_session.add(SystemCategory(id=10, name="电影", enabled=True))
    for index in range(9):
        await _add_video(
            db_session,
            f"禁用-{index}",
            "电影",
            f"2025-02-{index + 1:02d} 00:00:00",
            site_id=2,
        )
    for index in range(8):
        await _add_video(
            db_session,
            f"有效-{index}",
            "电影",
            f"2025-01-{index + 1:02d} 00:00:00",
        )
    await db_session.commit()

    payload = await _get_home_sections(db_session)

    items = payload["sections"][0]["items"]
    assert len(items) == 8
    assert [item["title"] for item in items] == [
        f"有效-{index}" for index in range(7, -1, -1)
    ]
