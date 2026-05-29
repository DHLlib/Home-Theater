import os
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppConfig

pytestmark = pytest.mark.asyncio


async def test_list_downloads_empty(async_client: AsyncClient):
    r = await async_client.get("/api/downloads")
    assert r.status_code == 200
    assert r.json() == []


async def test_create_download_without_root(async_client: AsyncClient):
    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.mp4",
            "suffix": "mp4",
            "title": "Movie",
            "year": 2020,
        },
    )
    assert r.status_code == 409
    assert "download_root not configured" in r.json()["detail"]


async def test_create_download_success(async_client: AsyncClient, db_session: AsyncSession, tmp_path):
    root = str(tmp_path / "downloads")
    os.makedirs(root, exist_ok=True)
    db_session.add(AppConfig(key="download_root", value=root))
    await db_session.commit()

    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.mp4",
            "suffix": "mp4",
            "title": "Movie",
            "year": 2020,
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "Movie"
    assert data["status"] == "queued"
    from pathlib import Path
    assert data["file_path"].endswith(str(Path("Movie") / "EP01.mp4"))


async def test_create_download_invalid_suffix_defaults_to_mp4(
    async_client: AsyncClient, db_session: AsyncSession, tmp_path
):
    root = str(tmp_path / "downloads")
    os.makedirs(root, exist_ok=True)
    db_session.add(AppConfig(key="download_root", value=root))
    await db_session.commit()

    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.avi",
            "suffix": "avi",
            "title": "Movie2",
        },
    )
    assert r.status_code == 200
    assert r.json()["file_path"].endswith(".mp4")


async def test_create_download_m3u8_suffix(async_client: AsyncClient, db_session: AsyncSession, tmp_path):
    root = str(tmp_path / "downloads")
    os.makedirs(root, exist_ok=True)
    db_session.add(AppConfig(key="download_root", value=root))
    await db_session.commit()

    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.m3u8",
            "suffix": "m3u8",
            "title": "Movie3",
        },
    )
    assert r.status_code == 200
    assert r.json()["file_path"].endswith(".m3u8")


async def test_pause_download_not_found(async_client: AsyncClient):
    r = await async_client.post("/api/downloads/9999/pause")
    assert r.status_code == 404


async def test_resume_download_not_found(async_client: AsyncClient):
    r = await async_client.post("/api/downloads/9999/resume")
    assert r.status_code == 404


async def test_delete_download(async_client: AsyncClient, db_session: AsyncSession, tmp_path):
    root = str(tmp_path / "downloads")
    os.makedirs(root, exist_ok=True)
    db_session.add(AppConfig(key="download_root", value=root))
    await db_session.commit()

    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.mp4",
            "suffix": "mp4",
            "title": "DelMovie",
        },
    )
    task_id = r.json()["id"]

    r = await async_client.delete(f"/api/downloads/{task_id}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["file_deleted"] is False
    assert r.json()["file_error"] is None


async def test_delete_download_with_file(
    async_client: AsyncClient, db_session: AsyncSession, tmp_path
):
    root = str(tmp_path / "downloads")
    os.makedirs(root, exist_ok=True)
    db_session.add(AppConfig(key="download_root", value=root))
    await db_session.commit()

    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.mp4",
            "suffix": "mp4",
            "title": "FileMovie",
        },
    )
    task_id = r.json()["id"]
    file_path = r.json()["file_path"]
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w") as f:
        f.write("video")

    r = await async_client.delete(f"/api/downloads/{task_id}", params={"delete_file": True})
    assert r.status_code == 200
    assert r.json()["file_deleted"] is True
    assert not os.path.exists(file_path)


async def test_delete_download_file_missing(
    async_client: AsyncClient, db_session: AsyncSession, tmp_path
):
    root = str(tmp_path / "downloads")
    os.makedirs(root, exist_ok=True)
    db_session.add(AppConfig(key="download_root", value=root))
    await db_session.commit()

    r = await async_client.post(
        "/api/downloads",
        json={
            "site_id": 1,
            "original_id": "abc",
            "episode_index": 0,
            "episode_name": "EP01",
            "url": "http://v.com/1.mp4",
            "suffix": "mp4",
            "title": "GhostMovie",
        },
    )
    task_id = r.json()["id"]

    r = await async_client.delete(f"/api/downloads/{task_id}", params={"delete_file": True})
    assert r.status_code == 200
    assert r.json()["file_deleted"] is False
    assert "源文件已被删除或不存在" in r.json()["file_error"]


async def test_delete_download_not_found(async_client: AsyncClient):
    r = await async_client.delete("/api/downloads/9999")
    assert r.status_code == 404
