"""分类查询走预聚合表（_query_aggregated_cache 分类过滤）测试。

覆盖 list_videos 带 category 时新走的预聚合路径核心逻辑：
- 命中预聚合表、按 (site_id, type_id) 过滤、跨页不重复
- 子分类无映射时回退父分类（fallback_category）
- 预聚合表为空时返回 None（触发 list_videos fallthrough 到实时路径）
"""

import pytest

import app.api.videos as videos
from app.api.videos import _query_aggregated_cache
from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    Site,
    SiteCategoryMapping,
    SystemCategory,
)


@pytest.fixture(autouse=True)
def _reset_category_cache():
    """重置 _load_category_filter_maps 的 60 秒模块级缓存，避免测试间污染。"""
    videos._category_filter_cache = None
    videos._category_filter_cache_ts = 0.0
    yield
    videos._category_filter_cache = None
    videos._category_filter_cache_ts = 0.0


async def _make_site(db, site_id: int) -> Site:
    site = Site(
        id=site_id,
        name=f"site-{site_id}",
        base_url=f"http://site{site_id}.test",
        enabled=True,
        sort=site_id,
    )
    db.add(site)
    await db.flush()
    return site


async def _add_video(db, title, year, sources):
    """sources: list of (site_id, original_id, type_id)。"""
    video = AggregatedVideoV3(
        title=title,
        year=year,
        poster_url=None,
        norm_title=title.lower(),
        latest_updated_at="2024-01-01 00:00:00",
        source_count=len(sources),
    )
    db.add(video)
    await db.flush()
    for site_id, original_id, type_id in sources:
        db.add(
            AggregatedSource(
                aggregated_video_id=video.id,
                site_id=site_id,
                original_id=original_id,
                site_name=f"site-{site_id}",
                type_name="动作片",
                type_id=type_id,
                remarks="HD",
                updated_at="2024-01-01 00:00:00",
            )
        )
    await db.flush()
    return video


@pytest.mark.asyncio
async def test_list_videos_category_aggregated_cache(db_session):
    """分类查询命中预聚合表，且只返回该分类下的视频。"""
    await _make_site(db_session, 1)
    # 系统分类：电影 > 动作片
    parent = SystemCategory(id=10, parent_id=None, name="电影", enabled=True)
    child = SystemCategory(id=11, parent_id=10, name="动作片", enabled=True)
    db_session.add_all([parent, child])
    # 站点 1 把 remote_id="6" 映射到动作片
    db_session.add(
        SiteCategoryMapping(site_id=1, remote_id="6", system_name="动作片", enabled=True)
    )
    # 命中：type_id=6（动作片）；不命中：type_id=99（无映射的其它分类）
    await _add_video(db_session, "动作大片", 2024, [(1, "1001", 6)])
    await _add_video(db_session, "其它影片", 2024, [(1, "2001", 99)])
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    resp = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category="动作片", sites=sites
    )

    assert resp is not None
    titles = {item.title for item in resp.items}
    assert titles == {"动作大片"}


@pytest.mark.asyncio
async def test_list_videos_category_no_cross_page_duplicates(db_session):
    """跨页（pg=1,2）不返回重复视频。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    db_session.add(
        SiteCategoryMapping(site_id=1, remote_id="6", system_name="动作片", enabled=True)
    )
    # 12 部动作片，per_page=5 → 需要 3 页
    for i in range(12):
        await _add_video(db_session, f"动作片-{i:02d}", 2024, [(1, f"3{i:03d}", 6)])
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    page1 = await _query_aggregated_cache(
        db_session, pg=1, per_page=5, category="动作片", sites=sites
    )
    page2 = await _query_aggregated_cache(
        db_session, pg=2, per_page=5, category="动作片", sites=sites
    )

    t1 = {item.title for item in page1.items}
    t2 = {item.title for item in page2.items}
    # 两页无交集，且并集覆盖全部 12 部
    assert t1.isdisjoint(t2)
    assert len(t1 | t2) == 12


@pytest.mark.asyncio
async def test_list_videos_category_fallback(db_session):
    """子分类无映射时回退父分类，仍能命中。"""
    await _make_site(db_session, 1)
    parent = SystemCategory(id=10, parent_id=None, name="电影", enabled=True)
    child = SystemCategory(id=11, parent_id=10, name="动作片", enabled=True)
    db_session.add_all([parent, child])
    # 站点只映射到父分类"电影"，无"动作片"子分类映射
    db_session.add(
        SiteCategoryMapping(site_id=1, remote_id="6", system_name="电影", enabled=True)
    )
    await _add_video(db_session, "电影甲", 2024, [(1, "4001", 6)])
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    resp = await _query_aggregated_cache(
        db_session,
        pg=1,
        per_page=20,
        category="动作片",
        fallback_category="电影",
        sites=sites,
    )

    assert resp is not None
    assert {item.title for item in resp.items} == {"电影甲"}


@pytest.mark.asyncio
async def test_list_videos_category_no_mapping_returns_empty(db_session):
    """所有站点都无该分类映射时返回空响应（非 None，不 fallback 到实时路径）。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    # 无任何 SiteCategoryMapping
    await _add_video(db_session, "孤儿视频", 2024, [(1, "5001", 6)])
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    resp = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category="动作片", sites=sites
    )

    assert resp is not None
    assert resp.items == []


@pytest.mark.asyncio
async def test_list_videos_category_cache_empty_fallthrough(db_session):
    """预聚合表为空时返回 None，让 list_videos fallthrough 到实时路径。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    db_session.add(
        SiteCategoryMapping(site_id=1, remote_id="6", system_name="动作片", enabled=True)
    )
    # 有映射但聚合表无数据
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    resp = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category="动作片", sites=sites
    )

    assert resp is None
