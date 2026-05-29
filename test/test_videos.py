import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Site

pytestmark = pytest.mark.asyncio


async def test_list_videos_pg_zero(async_client: AsyncClient, db_session: AsyncSession):
    # pg=0 should be treated as pg=1 (no negative slice)
    r = await async_client.get("/api/videos", params={"pg": 0})
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["failed_sources"] == []


async def test_list_videos_huge_pg(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.get("/api/videos", params={"pg": 999999})
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["failed_sources"] == []


async def test_search_videos_empty_wd(async_client: AsyncClient):
    r = await async_client.get("/api/videos/search", params={"wd": ""})
    assert r.status_code == 400
    assert "搜索词不能为空" in r.json()["detail"]


async def test_search_videos_nonexistent_category(async_client: AsyncClient, db_session: AsyncSession):
    # Create a site without the target category
    db_session.add(Site(name="CatSite", base_url="http://cat.com", enabled=True, sort=0))
    await db_session.commit()

    r = await async_client.get("/api/videos/search", params={"wd": "test", "category": "不存在的分类"})
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["failed_sources"] == []
