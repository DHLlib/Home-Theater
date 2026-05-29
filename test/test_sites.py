import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Site

pytestmark = pytest.mark.asyncio


async def test_list_sites_empty(async_client: AsyncClient):
    r = await async_client.get("/api/sites")
    assert r.status_code == 200
    assert r.json() == []


async def test_create_site(async_client: AsyncClient, db_session: AsyncSession):
    payload = {
        "name": "TestSite",
        "base_url": "http://example.com",
        "enabled": True,
        "sort": 1,
    }
    r = await async_client.post("/api/sites", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "TestSite"
    assert data["base_url"] == "http://example.com"
    assert data["enabled"] is True
    assert data["sort"] == 1


async def test_update_site(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/sites",
        json={"name": "Site1", "base_url": "http://a.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    r = await async_client.patch(
        f"/api/sites/{site_id}", json={"name": "Site1Updated", "sort": 5}
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Site1Updated"
    assert data["sort"] == 5


async def test_delete_site(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/sites",
        json={"name": "DelSite", "base_url": "http://del.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    r = await async_client.delete(f"/api/sites/{site_id}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = await async_client.get("/api/sites")
    assert r.json() == []


async def test_update_site_not_found(async_client: AsyncClient):
    r = await async_client.patch("/api/sites/9999", json={"name": "Nope"})
    assert r.status_code == 404
    assert r.json()["detail"] == "Site not found"


async def test_delete_site_not_found(async_client: AsyncClient):
    r = await async_client.delete("/api/sites/9999")
    assert r.status_code == 404
    assert r.json()["detail"] == "Site not found"


async def test_get_site_categories_empty(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/sites",
        json={"name": "CatSite", "base_url": "http://cat.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    r = await async_client.get(f"/api/sites/{site_id}/categories")
    assert r.status_code == 200
    data = r.json()
    assert data["site_id"] == site_id
    assert data["categories"] == []


async def test_update_site_categories_success(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/sites",
        json={"name": "CatSite", "base_url": "http://cat.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    payload = {
        "categories": [
            {"remote_id": "1", "name": "Movie"},
            {"remote_id": "2", "name": "TV"},
        ]
    }
    r = await async_client.put(f"/api/sites/{site_id}/categories", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert len(data["categories"]) == 2
    assert {c["remote_id"] for c in data["categories"]} == {"1", "2"}


async def test_update_site_categories_duplicate_remote_id(
    async_client: AsyncClient, db_session: AsyncSession
):
    r = await async_client.post(
        "/api/sites",
        json={"name": "CatSite", "base_url": "http://cat.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    payload = {
        "categories": [
            {"remote_id": "1", "name": "Movie"},
            {"remote_id": "1", "name": "TV"},
        ]
    }
    r = await async_client.put(f"/api/sites/{site_id}/categories", json=payload)
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "remote_id '1' 已分配到分类 'Movie'" in detail


async def test_update_site_categories_empty(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/sites",
        json={"name": "CatSite", "base_url": "http://cat.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    payload = {"categories": []}
    r = await async_client.put(f"/api/sites/{site_id}/categories", json=payload)
    assert r.status_code == 200
    assert r.json()["categories"] == []


async def test_update_site_categories_not_found(async_client: AsyncClient):
    r = await async_client.put(
        "/api/sites/9999/categories", json={"categories": [{"remote_id": "1", "name": "X"}]}
    )
    assert r.status_code == 404


async def test_probe_site_not_found(async_client: AsyncClient):
    r = await async_client.post("/api/sites/9999/probe")
    assert r.status_code == 404


async def test_fetch_remote_categories_not_found(async_client: AsyncClient):
    r = await async_client.post("/api/sites/9999/fetch-categories")
    assert r.status_code == 404


async def test_create_site_empty_name(async_client: AsyncClient):
    r = await async_client.post(
        "/api/sites",
        json={"name": "", "base_url": "http://example.com", "enabled": True, "sort": 0},
    )
    assert r.status_code == 422


async def test_create_site_invalid_url(async_client: AsyncClient):
    r = await async_client.post(
        "/api/sites",
        json={"name": "BadUrl", "base_url": "not-a-url", "enabled": True, "sort": 0},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["base_url"] == "not-a-url"


async def test_update_site_sort_boundary(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/sites",
        json={"name": "SortSite", "base_url": "http://sort.com", "enabled": True, "sort": 0},
    )
    site_id = r.json()["id"]

    r = await async_client.patch(f"/api/sites/{site_id}", json={"sort": 999999})
    assert r.status_code == 200
    assert r.json()["sort"] == 999999
