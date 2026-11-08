"""分类查询走预聚合表（_query_aggregated_cache 分类过滤）测试。

覆盖视频级分类（aggregated_videos.system_category）的查询语义：
- 命中预聚合表、按视频级分类过滤、跨页不重复
- 子分类无别名时回退父分类（fallback_category）
- 聚合表为空时：带分类返回空列表（不 fallback 到实时路径），不带分类返回 None
"""

import pytest

import app.api.videos as videos
from app.api.videos import _query_aggregated_cache
from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    CategoryAlias,
    Site,
    SystemCategory,
)
from app.services import category_alias


@pytest.fixture(autouse=True)
def _reset_category_cache():
    """重置分类过滤缓存与别名缓存，避免测试间污染。"""
    videos._category_filter_cache = None
    videos._category_filter_cache_ts = 0.0
    category_alias.invalidate_alias_cache()
    yield
    videos._category_filter_cache = None
    videos._category_filter_cache_ts = 0.0
    category_alias.invalidate_alias_cache()


async def _make_site(db, site_id: int, enabled: bool = True) -> Site:
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


async def _add_video(db, title, year, sources, system_category=None):
    """sources: list of (site_id, original_id, type_id, type_name)。"""
    video = AggregatedVideoV3(
        title=title,
        year=year,
        poster_url=None,
        norm_title=title.lower(),
        latest_updated_at="2024-01-01 00:00:00",
        source_count=len(sources),
        system_category=system_category,
    )
    db.add(video)
    await db.flush()
    for site_id, original_id, type_id, type_name in sources:
        db.add(
            AggregatedSource(
                aggregated_video_id=video.id,
                site_id=site_id,
                original_id=original_id,
                site_name=f"site-{site_id}",
                type_name=type_name,
                type_id=type_id,
                remarks="HD",
                updated_at="2024-01-01 00:00:00",
            )
        )
    await db.flush()
    return video


def _add_alias(db, raw_name: str, system_name: str) -> None:
    db.add(
        CategoryAlias(
            name_key=category_alias.normalize_category_name(raw_name),
            system_name=system_name,
            raw_names=[raw_name],
            enabled=True,
            source="manual",
        )
    )


@pytest.mark.asyncio
async def test_list_videos_category_aggregated_cache(db_session):
    """分类查询只返回该视频级分类下的视频。"""
    await _make_site(db_session, 1)
    parent = SystemCategory(id=10, parent_id=None, name="电影", enabled=True)
    child = SystemCategory(id=11, parent_id=10, name="动作片", enabled=True)
    other = SystemCategory(id=12, parent_id=10, name="剧情片", enabled=True)
    db_session.add_all([parent, child, other])
    _add_alias(db_session, "动作片", "动作片")
    _add_alias(db_session, "剧情片", "剧情片")

    await _add_video(
        db_session, "动作大片", 2024, [(1, "1001", 6, "动作片")], "动作片"
    )
    await _add_video(
        db_session, "剧情片甲", 2024, [(1, "2001", 7, "剧情片")], "剧情片"
    )
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
    """跨页（pg=1,2,3）不返回重复视频。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    _add_alias(db_session, "动作片", "动作片")

    for i in range(12):
        await _add_video(
            db_session,
            f"动作片-{i:02d}",
            2024,
            [(1, f"3{i:03d}", 6, "动作片")],
            "动作片",
        )
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    page1 = await _query_aggregated_cache(
        db_session, pg=1, per_page=5, category="动作片", sites=sites
    )
    page2 = await _query_aggregated_cache(
        db_session, pg=2, per_page=5, category="动作片", sites=sites
    )
    page3 = await _query_aggregated_cache(
        db_session, pg=3, per_page=5, category="动作片", sites=sites
    )

    t1 = {item.title for item in page1.items}
    t2 = {item.title for item in page2.items}
    t3 = {item.title for item in page3.items}
    assert t1.isdisjoint(t2)
    assert t1.isdisjoint(t3)
    assert t2.isdisjoint(t3)
    assert len(t1 | t2 | t3) == 12


@pytest.mark.asyncio
async def test_list_videos_category_fallback(db_session):
    """子分类无别名时回退父分类，仍能命中。"""
    await _make_site(db_session, 1)
    parent = SystemCategory(id=10, parent_id=None, name="电影", enabled=True)
    child = SystemCategory(id=11, parent_id=10, name="动作片", enabled=True)
    db_session.add_all([parent, child])
    # 只有父分类有别名，子分类没有任何远程类名
    _add_alias(db_session, "电影", "电影")

    await _add_video(db_session, "电影甲", 2024, [(1, "4001", 6, "电影")], "电影")
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
    """该分类下没有任何视频时返回空响应（非 None，不 fallback 到实时路径）。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    _add_alias(db_session, "剧情片", "剧情片")
    await _add_video(
        db_session, "剧情片甲", 2024, [(1, "5001", 6, "剧情片")], "剧情片"
    )
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    resp = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category="动作片", sites=sites
    )

    assert resp is not None
    assert resp.items == []


@pytest.mark.asyncio
async def test_disabled_site_content_hidden(db_session):
    """禁用站点的内容不出现在聚合列表；多来源视频只要有一个启用来源就保留。"""
    site_on = await _make_site(db_session, 1, enabled=True)
    await _make_site(db_session, 2, enabled=False)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    _add_alias(db_session, "动作片", "动作片")

    await _add_video(
        db_session, "仅禁用站", 2024, [(2, "9001", 6, "动作片")], "动作片"
    )
    await _add_video(
        db_session, "启用站内容", 2024, [(1, "9002", 6, "动作片")], "动作片"
    )
    await _add_video(
        db_session,
        "两站共用",
        2024,
        [(1, "9003", 6, "动作片"), (2, "9004", 6, "动作片")],
        "动作片",
    )
    await db_session.commit()

    resp = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category=None, sites=[site_on]
    )

    assert resp is not None
    titles = {item.title for item in resp.items}
    assert titles == {"启用站内容", "两站共用"}


@pytest.mark.asyncio
async def test_list_videos_uncategorized(db_session):
    """「未分类」返回 system_category 为 NULL 的视频。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    _add_alias(db_session, "动作片", "动作片")

    await _add_video(
        db_session, "动作大片", 2024, [(1, "6001", 6, "动作片")], "动作片"
    )
    await _add_video(db_session, "无名视频", 2024, [(1, "7001", 8, "杂项")], None)
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    resp = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category="未分类", sites=sites
    )

    assert resp is not None
    assert {item.title for item in resp.items} == {"无名视频"}


@pytest.mark.asyncio
async def test_list_videos_category_cache_empty_fallthrough(db_session):
    """聚合表为空时：带分类返回空列表，不带分类返回 None（触发实时路径）。"""
    await _make_site(db_session, 1)
    db_session.add(SystemCategory(id=11, parent_id=None, name="动作片", enabled=True))
    _add_alias(db_session, "动作片", "动作片")
    await db_session.commit()

    sites = [await db_session.get(Site, 1)]
    with_category = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category="动作片", sites=sites
    )
    without_category = await _query_aggregated_cache(
        db_session, pg=1, per_page=20, category=None, sites=sites
    )

    assert with_category is not None
    assert with_category.items == []
    assert without_category is None
