import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def test_list_favorites_empty(async_client: AsyncClient):
    r = await async_client.get("/api/favorites")
    assert r.status_code == 200
    assert r.json() == []


async def test_add_favorite(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/favorites",
        json={"title": "Inception", "year": 2010, "poster_url": "http://poster.jpg"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "Inception"
    assert data["year"] == 2010
    assert data["poster_url"] == "http://poster.jpg"


async def test_add_favorite_no_year(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post("/api/favorites", json={"title": "Standalone"})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "Standalone"
    assert data["year"] is None


async def test_add_favorite_duplicate_title_year(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/favorites", json={"title": "Dup", "year": 2020}
    )
    assert r.status_code == 200

    r = await async_client.post(
        "/api/favorites", json={"title": "Dup", "year": 2020}
    )
    assert r.status_code == 409


async def test_delete_favorite(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/favorites", json={"title": "ToDelete", "year": 2021}
    )
    fav_id = r.json()["id"]

    r = await async_client.delete(f"/api/favorites/{fav_id}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = await async_client.get("/api/favorites")
    assert r.json() == []


async def test_delete_favorite_not_found(async_client: AsyncClient):
    r = await async_client.delete("/api/favorites/9999")
    assert r.status_code == 404
    assert r.json()["detail"] == "Favorite not found"


async def test_add_favorite_year_zero(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/favorites",
        json={"title": "YearZero", "year": 0},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "YearZero"
    assert data["year"] == 0


async def test_add_favorite_year_negative(async_client: AsyncClient, db_session: AsyncSession):
    r = await async_client.post(
        "/api/favorites",
        json={"title": "YearNegative", "year": -100},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "YearNegative"
    assert data["year"] == -100
