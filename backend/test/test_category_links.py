"""按站点手动挂载的核心行为。"""
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from app.api import category_settings
from app.api.system_categories import (
    delete_system_category,
    update_system_category,
)
from app.db import get_db
from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    Site,
    SiteCategoryLink,
    SiteRemoteCategory,
    SystemCategory,
    _utcnow,
)
from app.schemas import SystemCategoryUpdate
from app.services import category_links


async def _site(db, site_id=1, enabled=True):
    site = Site(
        id=site_id,
        name=f"site-{site_id}",
        base_url=f"http://site{site_id}.test",
        enabled=enabled,
        sort=site_id,
    )
    db.add(site)
    await db.flush()
    return site


async def _categories(db):
    parent = SystemCategory(id=10, parent_id=None, name="电影", enabled=True)
    action = SystemCategory(id=11, parent_id=10, name="动作片", enabled=True, sort=1)
    scifi = SystemCategory(id=12, parent_id=10, name="科幻片", enabled=True, sort=2)
    db.add_all([parent, action, scifi])
    await db.flush()
    return parent, action, scifi


async def _remotes(db, site_id=1):
    rows = [
        SiteRemoteCategory(
            site_id=site_id,
            remote_id="6",
            name="动作片",
            parent_name="电影",
            sort=1,
            last_seen_at=_utcnow(),
        ),
        SiteRemoteCategory(
            site_id=site_id,
            remote_id="7",
            name="科幻片",
            parent_name="电影",
            sort=2,
            last_seen_at=_utcnow(),
        ),
    ]
    db.add_all(rows)
    await db.flush()


async def _video(db, title, sources):
    video = AggregatedVideoV3(
        title=title,
        year=2024,
        norm_title=title.lower(),
        latest_updated_at="2024-01-01 00:00:00",
        source_count=len(sources),
        system_category=None,
    )
    db.add(video)
    await db.flush()
    for site_id, type_id, type_name in sources:
        db.add(
            AggregatedSource(
                aggregated_video_id=video.id,
                site_id=site_id,
                original_id=f"{title}-{type_id}",
                site_name=f"site-{site_id}",
                type_name=type_name,
                type_id=type_id,
                updated_at="2024-01-01 00:00:00",
            )
        )
    await db.flush()
    return video


@pytest.mark.asyncio
async def test_attach_and_detach_recompute_video(db_session):
    await _site(db_session)
    _parent, action, _scifi = await _categories(db_session)
    await _remotes(db_session)
    video = await _video(db_session, "动作大片", [(1, 6, "动作片")])
    await db_session.commit()

    touched = await category_links.attach_links(
        db_session,
        [{"site_id": 1, "remote_id": "6", "system_category_id": action.id}],
    )
    await db_session.commit()
    affected = await category_links.attach_affected_videos(db_session, touched)
    await db_session.commit()
    await db_session.refresh(video)

    assert affected == 1
    assert video.system_category == "动作片"

    touched = await category_links.detach_links(
        db_session, [{"site_id": 1, "remote_id": "6"}]
    )
    await db_session.commit()
    await category_links.attach_affected_videos(db_session, touched)
    await db_session.commit()
    await db_session.refresh(video)
    assert video.system_category is None


@pytest.mark.asyncio
async def test_vote_uses_site_links_and_sort_tiebreak(db_session):
    await _site(db_session)
    _parent, action, scifi = await _categories(db_session)
    await _remotes(db_session)
    video = await _video(
        db_session, "多来源", [(1, 6, "动作片"), (1, 7, "科幻片")]
    )
    await db_session.commit()

    await category_links.attach_links(
        db_session,
        [
            {"site_id": 1, "remote_id": "6", "system_category_id": action.id},
            {"site_id": 1, "remote_id": "7", "system_category_id": scifi.id},
        ],
    )
    await db_session.commit()
    by_id, by_name, sort_order = await category_links.load_category_decision_maps(
        db_session
    )
    picked = category_links.pick_system_category(
        [(1, 6, "动作片"), (1, 7, "科幻片")], by_id, by_name, sort_order
    )
    assert picked == "动作片"

    # 再加一个来源指向科幻片，票数反超
    picked = category_links.pick_system_category(
        [(1, 6, "动作片"), (1, 7, "科幻片"), (1, 7, "科幻片")],
        by_id,
        by_name,
        sort_order,
    )
    assert picked == "科幻片"


@pytest.mark.asyncio
async def test_attach_rejects_big_category_and_moves_existing(db_session):
    await _site(db_session)
    parent, action, scifi = await _categories(db_session)
    await _remotes(db_session)
    await db_session.commit()

    with pytest.raises(ValueError):
        await category_links.attach_links(
            db_session,
            [{"site_id": 1, "remote_id": "6", "system_category_id": parent.id}],
        )

    await category_links.attach_links(
        db_session,
        [{"site_id": 1, "remote_id": "6", "system_category_id": action.id}],
    )
    await db_session.commit()
    await category_links.attach_links(
        db_session,
        [{"site_id": 1, "remote_id": "6", "system_category_id": scifi.id}],
    )
    await db_session.commit()
    link = (
        await db_session.execute(
            select(SiteCategoryLink).where(
                SiteCategoryLink.site_id == 1,
                SiteCategoryLink.remote_id == "6",
            )
        )
    ).scalar_one()
    assert link.system_category_id == scifi.id
    assert await db_session.scalar(
        select(func.count()).select_from(
            SiteCategoryLink
        )
    ) == 1


@pytest.mark.asyncio
async def test_delete_category_sets_videos_null_without_revote(db_session):
    await _site(db_session)
    _parent, action, _scifi = await _categories(db_session)
    await _remotes(db_session)
    video = await _video(db_session, "动作大片", [(1, 6, "动作片")])
    await db_session.commit()
    await category_links.attach_links(
        db_session,
        [{"site_id": 1, "remote_id": "6", "system_category_id": action.id}],
    )
    await db_session.commit()
    await category_links.attach_affected_videos(
        db_session, [(1, "6")]
    )
    await db_session.commit()

    result = await delete_system_category(action.id, db_session)
    await db_session.commit()
    await db_session.refresh(video)
    assert result["links_removed"] == 1
    assert result["videos_reset"] == 1
    assert video.system_category is None


@pytest.mark.asyncio
async def test_rename_keeps_link_and_repoints_video(db_session):
    await _site(db_session)
    _parent, action, _scifi = await _categories(db_session)
    await _remotes(db_session)
    video = await _video(db_session, "动作大片", [(1, 6, "动作片")])
    video.system_category = "动作片"
    await db_session.commit()
    await category_links.attach_links(
        db_session,
        [{"site_id": 1, "remote_id": "6", "system_category_id": action.id}],
    )
    await db_session.commit()

    await update_system_category(
        action.id, SystemCategoryUpdate(name="武打片"), db_session
    )
    await db_session.commit()
    await db_session.refresh(video)
    link = (
        await db_session.execute(
            select(SiteCategoryLink).where(
                SiteCategoryLink.site_id == 1,
                SiteCategoryLink.remote_id == "6",
            )
        )
    ).scalar_one()
    assert video.system_category == "武打片"
    assert link.system_category_id == action.id


@pytest.mark.asyncio
async def test_refresh_snapshot_uses_ac_list(db_session, monkeypatch):
    site = await _site(db_session)
    await db_session.commit()

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def _get(self, params):
            return {
                "class": [
                    {"type_id": 1, "type_pid": 0, "type_name": "电影"},
                    {"type_id": 6, "type_pid": 1, "type_name": "动作片"},
                    {"type_id": 7, "type_pid": 1, "type_name": "科幻片"},
                ]
            }

    monkeypatch.setattr(
        "app.services.source_client.SourceClient", FakeClient
    )
    stats = await category_links.refresh_site_remote_categories(db_session, site)
    assert stats["total"] == 2
    rows = (
        await db_session.execute(
            select(SiteRemoteCategory).where(
                SiteRemoteCategory.site_id == site.id
            )
        )
    ).scalars().all()
    assert {row.remote_id for row in rows} == {"6", "7"}
    assert all(row.parent_name == "电影" for row in rows)


@pytest.mark.asyncio
async def test_category_settings_api_overview_attach_and_detach(db_session):
    await _site(db_session)
    _parent, action, _scifi = await _categories(db_session)
    await _remotes(db_session)
    video = await _video(db_session, "动作大片", [(1, 6, "动作片")])
    await db_session.commit()

    app = FastAPI()
    app.include_router(category_settings.router, prefix="/api")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        overview = await client.get("/api/category-settings/overview")
        assert overview.status_code == 200
        payload = overview.json()
        assert payload["categories"][0]["name"] == "电影"
        assert payload["categories"][0]["children"][0]["name"] == "动作片"
        assert payload["summary"]["sites"] == 1

        remotes = await client.get("/api/category-settings/remotes")
        assert remotes.status_code == 200
        items = remotes.json()["items"]
        assert len(items) == 2
        assert items[0]["attached_category_id"] is None

        linked = await client.post(
            "/api/category-settings/links",
            json={
                "items": [
                    {"site_id": 1, "remote_id": "6", "system_category_id": action.id}
                ]
            },
        )
        assert linked.status_code == 200, linked.text
        assert linked.json()["linked"] == 1
        await db_session.refresh(video)
        assert video.system_category == "动作片"

        after = (await client.get("/api/category-settings/remotes")).json()["items"]
        assert next(item for item in after if item["remote_id"] == "6")[
            "attached_category_id"
        ] == action.id

        detached = await client.request(
            "DELETE",
            "/api/category-settings/links",
            json={"items": [{"site_id": 1, "remote_id": "6"}]},
        )
        assert detached.status_code == 200, detached.text
        assert detached.json()["unlinked"] == 1
        await db_session.refresh(video)
        assert video.system_category is None
