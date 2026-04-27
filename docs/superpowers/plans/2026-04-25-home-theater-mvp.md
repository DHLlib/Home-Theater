# Home Theater MVP Implementation Plan

> **更新注记（2026-04-26）**：本计划已执行完毕。后续变更未反向同步到本文档：
> - 开发/联调端口由 `8000` 改为 `8181`（与 `frontend/vite.config.ts` 代理对齐）
> - 新增「分类映射」功能（互斥约束、occupancy map、扁平系统分类），详见 `CLAUDE.md`
> - 仓库已初始化 Git
> - 当前事实文档：`CLAUDE.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal video aggregation system with FastAPI backend and React frontend, supporting multi-source aggregation, explicit source selection, playback progress, favorites, and download management.

**Architecture:** FastAPI async backend with httpx for concurrent multi-source fetching; SQLite via SQLAlchemy async for persistence; React + Vite SPA frontend with react-router; FastAPI static-files hosts the built frontend for LAN deployment.

**Tech Stack:** FastAPI, SQLAlchemy(async, aiosqlite), httpx, pydantic-settings, React, Vite, TypeScript, react-router v6

---

## File Structure

### Backend

| File | Responsibility |
|---|---|
| `backend/pyproject.toml` | Python project metadata and dependencies |
| `backend/app/config.py` | pydantic-settings: db_path, host, port, download_root |
| `backend/app/db.py` | async SQLAlchemy engine, session_factory, get_db, init_db |
| `backend/app/models.py` | ORM: Site, Favorite, PlayProgress, DownloadTask, AppConfig |
| `backend/app/schemas.py` | Pydantic request/response models |
| `backend/app/main.py` | FastAPI app, CORS, router mounting, static hosting, lifespan |
| `backend/app/api/sites.py` | Site CRUD, probe, category mapping |
| `backend/app/api/videos.py` | Aggregated list, detail, search |
| `backend/app/api/play.py` | GET /play/episodes for single-source episode list |
| `backend/app/api/downloads.py` | Download task CRUD, pause/resume |
| `backend/app/api/progress.py` | Play progress upsert, recent list, get by title/year |
| `backend/app/api/favorites.py` | Favorite add/list/remove |
| `backend/app/api/settings_api.py` | GET/PUT download_root |
| `backend/app/services/source_client.py` | **Only** external HTTP exit; constructs ac/t/pg/wd/h/ids params |
| `backend/app/services/parser.py` | Pure function: parse_episodes(raw) → list[Episode] |
| `backend/app/services/aggregator.py` | normalize_title + aggregate_lists; no DB |
| `backend/app/services/health.py` | async probe(site) → ProbeResult |
| `backend/app/services/downloader.py` | State-machine skeleton: start/pause/resume (real loop TODO) |

### Frontend

| File | Responsibility |
|---|---|
| `frontend/package.json` | npm project metadata and dependencies |
| `frontend/vite.config.ts` | Vite config with `/api` proxy to localhost:8000 |
| `frontend/src/main.tsx` | React app entry point |
| `frontend/src/App.tsx` | RouterProvider + ToastContainer |
| `frontend/src/router.tsx` | react-router route table |
| `frontend/src/types.ts` | TypeScript interfaces matching backend schemas |
| `frontend/src/styles/global.css` | Dark theme CSS variables + utilities |
| `frontend/src/api/client.ts` | Fetch wrapper + ApiError + auto toastError |
| `frontend/src/api/sites.ts` | Site CRUD, probe, categories API |
| `frontend/src/api/videos.ts` | list, search, detail API |
| `frontend/src/api/play.ts` | getEpisodes API |
| `frontend/src/api/downloads.ts` | Download task CRUD + pause/resume |
| `frontend/src/api/progress.ts` | Upsert, recent, get progress |
| `frontend/src/api/favorites.ts` | Add, list, remove favorites |
| `frontend/src/api/settings.ts` | GET/PUT download_root |
| `frontend/src/pages/Home.tsx` | Aggregated video grid + category filter |
| `frontend/src/pages/Search.tsx` | Search input + results grid |
| `frontend/src/pages/Detail.tsx` | Video detail + episode list + play/download triggers |
| `frontend/src/pages/Player.tsx` | Video player + prev/next episode + progress reporting |
| `frontend/src/pages/Downloads.tsx` | Download task list + pause/resume/delete |
| `frontend/src/pages/Favorites.tsx` | Favorite grid with poster |
| `frontend/src/pages/Progress.tsx` | Recent playback list with resume link |
| `frontend/src/pages/Settings.tsx` | Site CRUD, category mapping table, download root |
| `frontend/src/components/Layout.tsx` | Top nav with NavLink |
| `frontend/src/components/VideoCard.tsx` | Card with lazy-loaded poster |
| `frontend/src/components/EpisodeList.tsx` | Episode button grid |
| `frontend/src/components/SourcePicker.tsx` | Modal forcing explicit source selection |
| `frontend/src/components/CategoryBar.tsx` | Unified category filter buttons |
| `frontend/src/components/CategorySettings.tsx` | Dynamic table for cross-site category mapping |
| `frontend/src/utils/toast.ts` | Event-driven toast system |

---

### Task 1: Backend Project Skeleton

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "home-theater"
version = "0.1.0"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "sqlalchemy[asyncio]>=2.0",
    "aiosqlite>=0.20",
    "httpx>=0.27",
    "pydantic-settings>=2.2",
]

[tool.setuptools.packages.find]
where = ["."]
include = ["app*"]
```

- [ ] **Step 2: Create app/__init__.py**

Empty file.

- [ ] **Step 3: Create app/config.py**

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    db_path: str = "data/app.db"
    host: str = "0.0.0.0"
    port: int = 8000
    default_download_root: str | None = None

    @property
    def db_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.db_path}"

settings = Settings()
```

- [ ] **Step 4: Create app/db.py**

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.config import settings

engine = create_async_engine(settings.db_url, echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        yield session

async def init_db() -> None:
    from app.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

- [ ] **Step 5: Install and verify**

Run: `cd backend && pip install -e .`
Expected: Installs successfully.

---

### Task 2: Backend Data Models

**Files:**
- Create: `backend/app/models.py`

- [ ] **Step 1: Create models.py**

```python
from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class Site(Base):
    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    base_url: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    categories: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("title", "year", name="uix_favorite_title_year"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class PlayProgress(Base):
    __tablename__ = "play_progress"
    __table_args__ = (UniqueConstraint("title", "year", name="uix_progress_title_year"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_site_id: Mapped[int] = mapped_column(Integer, ForeignKey("sites.id"), nullable=False)
    source_video_id: Mapped[str] = mapped_column(String, nullable=False)
    episode_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    episode_name: Mapped[str] = mapped_column(String, default="", nullable=False)
    position_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DownloadTask(Base):
    __tablename__ = "download_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    episode_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    episode_name: Mapped[str] = mapped_column(String, default="", nullable=False)
    source_site_id: Mapped[int] = mapped_column(Integer, ForeignKey("sites.id"), nullable=False)
    source_video_id: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    suffix: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    total_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    downloaded_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String, default="queued", nullable=False, index=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class AppConfig(Base):
    __tablename__ = "app_config"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

---

### Task 3: Backend Schemas

**Files:**
- Create: `backend/app/schemas.py`

- [ ] **Step 1: Create schemas.py**

```python
from __future__ import annotations
from pydantic import BaseModel, Field

class Episode(BaseModel):
    ep_name: str
    url: str
    suffix: str
    index: int

class SourceRef(BaseModel):
    site_id: int
    original_id: str
    type: str | None = None
    category: str | None = None
    remarks: str | None = None
    updated_at: str | None = None

class AggregatedVideo(BaseModel):
    title: str
    year: int | None = None
    poster_url: str | None = None
    sources: list[SourceRef]

class AggregatedListResponse(BaseModel):
    items: list[AggregatedVideo]
    failed_sources: list[dict] = Field(default_factory=list)

class SourceDetail(BaseModel):
    site_id: int
    original_id: str
    title: str
    year: int | None = None
    poster_url: str | None = None
    intro: str | None = None
    area: str | None = None
    actors: str | None = None
    director: str | None = None
    episodes: list[Episode] = Field(default_factory=list)

class DetailRequest(BaseModel):
    title: str
    year: int | None = None
    sources: list[SourceRef]

class DetailResponse(BaseModel):
    title: str
    year: int | None = None
    sources: list[SourceDetail]

class DownloadTaskCreate(BaseModel):
    site_id: int
    original_id: str
    episode_index: int
    episode_name: str
    url: str
    suffix: str
    title: str
    year: int | None = None

class DownloadTaskOut(BaseModel):
    id: int
    title: str
    episode_index: int
    episode_name: str
    source_site_id: int
    source_video_id: str
    url: str
    suffix: str
    file_path: str
    total_bytes: int | None
    downloaded_bytes: int
    status: str
    error: str | None
    created_at: str | None = None
    updated_at: str | None = None

class PlayProgressIn(BaseModel):
    title: str
    year: int | None = None
    source_site_id: int
    source_video_id: str
    episode_index: int
    episode_name: str
    position_seconds: int
    duration_seconds: int | None = None

class PlayProgressOut(BaseModel):
    id: int
    title: str
    year: int | None = None
    source_site_id: int
    source_video_id: str
    episode_index: int
    episode_name: str
    position_seconds: int
    duration_seconds: int | None = None
    updated_at: str | None = None

class FavoriteIn(BaseModel):
    title: str
    year: int | None = None
    poster_url: str | None = None

class FavoriteOut(BaseModel):
    id: int
    title: str
    year: int | None = None
    poster_url: str | None = None
    created_at: str | None = None

class ProbeResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    error: str | None = None

class CategoryMapping(BaseModel):
    remote_id: str
    name: str

class SiteCategoriesOut(BaseModel):
    site_id: int
    categories: list[CategoryMapping]

class SiteCategoriesUpdate(BaseModel):
    categories: list[CategoryMapping]

class FailedSource(BaseModel):
    site_id: int | None = None
    site_name: str | None = None
    error: str
```

---

### Task 4: Service — Source Client

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/source_client.py`

- [ ] **Step 1: Create services/__init__.py**

Empty file.

- [ ] **Step 2: Create source_client.py**

```python
from __future__ import annotations
import logging
from urllib.parse import urlencode
import httpx

logger = logging.getLogger(__name__)

class SourceClient:
    def __init__(self, site_id: int, base_url: str, name: str):
        self.site_id = site_id
        self.base_url = base_url.rstrip("/")
        self.name = name
        self._client = httpx.AsyncClient(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": self.base_url,
            },
            timeout=httpx.Timeout(15.0),
        )

    async def _get(self, params: dict) -> dict:
        qs = urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{self.base_url}?{qs}"
        resp = await self._client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return data

    async def list(self, t: int | str | None = None, pg: int = 1, h: int | None = None, wd: str | None = None):
        params = {"ac": "list", "pg": pg}
        if t is not None:
            params["t"] = t
        if h is not None:
            params["h"] = h
        if wd is not None:
            params["wd"] = wd
        data = await self._get(params)
        return data.get("list", [])

    async def videolist(self, ids: list[str]):
        params = {"ac": "videolist", "ids": ",".join(ids)}
        data = await self._get(params)
        return data.get("list", [])
```

---

### Task 5: Service — Parser

**Files:**
- Create: `backend/app/services/parser.py`

- [ ] **Step 1: Create parser.py**

```python
from dataclasses import dataclass

@dataclass
class Episode:
    ep_name: str
    url: str
    suffix: str
    index: int

def parse_episodes(raw: str) -> list[Episode]:
    """Parse '集数$地址$后缀' multi-line format. Raises ValueError on bad lines."""
    episodes = []
    for idx, line in enumerate(raw.strip().splitlines()):
        line = line.strip()
        if not line:
            continue
        parts = line.split("$")
        if len(parts) != 3:
            raise ValueError(f"Line {idx + 1} must have exactly 3 $-segments: {line!r}")
        ep_name, url, suffix = parts
        episodes.append(Episode(ep_name=ep_name, url=url, suffix=suffix, index=idx))
    return episodes
```

---

### Task 6: Service — Aggregator

**Files:**
- Create: `backend/app/services/aggregator.py`

- [ ] **Step 1: Create aggregator.py**

```python
import re
from typing import Any

def normalize_title(title: str) -> str:
    t = title.strip()
    t = re.sub(r"[《》]", "", t)
    return t.casefold()

def aggregate_lists(per_source: list[tuple[int, str, list[dict]]]) -> list[dict]:
    """per_source: [(site_id, site_name, items), ...]
    Returns aggregated items keyed by (normalize_title, year).
    """
    groups: dict[tuple[str, int | None], dict] = {}
    for site_id, site_name, items in per_source:
        for item in items:
            raw_title = item.get("vod_name") or item.get("title") or ""
            year = item.get("vod_year") or item.get("year") or None
            if isinstance(year, str):
                try:
                    year = int(year)
                except ValueError:
                    year = None
            key = (normalize_title(raw_title), year)
            if key not in groups:
                groups[key] = {
                    "title": raw_title,
                    "year": year,
                    "poster_url": item.get("vod_pic") or item.get("poster_url") or None,
                    "sources": [],
                }
            groups[key]["sources"].append({
                "site_id": site_id,
                "original_id": str(item.get("vod_id") or item.get("id") or ""),
                "type": item.get("type"),
                "category": item.get("category"),
                "remarks": item.get("vod_remarks") or item.get("remarks"),
                "updated_at": item.get("vod_time") or item.get("updated_at"),
            })
    return list(groups.values())
```

---

### Task 7: Services — Health + Downloader

**Files:**
- Create: `backend/app/services/health.py`
- Create: `backend/app/services/downloader.py`

- [ ] **Step 1: Create health.py**

```python
import time
import httpx
from app.schemas import ProbeResult

async def probe(site, timeout: float = 5.0) -> ProbeResult:
    url = f"{site.base_url.rstrip('/')}?ac=list&pg=1"
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            if "list" not in data:
                return ProbeResult(ok=False, error="Invalid response: missing 'list'")
            latency = int((time.monotonic() - start) * 1000)
            return ProbeResult(ok=True, latency_ms=latency)
    except Exception as exc:
        return ProbeResult(ok=False, error=str(exc))
```

- [ ] **Step 2: Create downloader.py**

```python
from __future__ import annotations
import logging
from app.db import async_session_factory
from app.models import DownloadTask

logger = logging.getLogger(__name__)

async def start(task_id: int) -> None:
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "downloading"
            await session.commit()
    logger.info("TODO: start real download loop task_id=%s", task_id)

async def pause(task_id: int) -> None:
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "paused"
            await session.commit()
    logger.info("Paused task_id=%s", task_id)

async def resume(task_id: int) -> None:
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "downloading"
            await session.commit()
    logger.info("TODO: resume download task_id=%s", task_id)
```

---

### Task 8: API — Sites

**Files:**
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/sites.py`

- [ ] **Step 1: Create api/__init__.py**

Empty file.

- [ ] **Step 2: Create sites.py**

```python
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import Site
from app.schemas import CategoryMapping, ProbeResult, SiteCategoriesOut, SiteCategoriesUpdate
from app.services.health import probe

router = APIRouter(prefix="/sites", tags=["sites"])

@router.get("")
async def list_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).order_by(Site.sort, Site.id))
    return result.scalars().all()

@router.post("")
async def create_site(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    site = Site(
        name=body["name"],
        base_url=body["base_url"],
        enabled=body.get("enabled", True),
        sort=body.get("sort", 0),
    )
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return site

@router.put("/{site_id}")
async def update_site(site_id: int, body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    for k, v in body.items():
        if hasattr(site, k):
            setattr(site, k, v)
    await db.commit()
    await db.refresh(site)
    return site

@router.delete("/{site_id}")
async def delete_site(site_id: int, db: AsyncSession = Depends(get_db)):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.delete(site)
    await db.commit()
    return {"ok": True}

@router.post("/{site_id}/probe")
async def do_probe(site_id: int, db: AsyncSession = Depends(get_db)):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return await probe(site)

@router.get("/{site_id}/categories")
async def get_site_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    cats = site.categories or []
    return SiteCategoriesOut(
        site_id=site_id,
        categories=[CategoryMapping(**c) for c in cats],
    )

@router.put("/{site_id}/categories")
async def update_site_categories(site_id: int, body: SiteCategoriesUpdate, db: AsyncSession = Depends(get_db)):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site.categories = [c.model_dump() for c in body.categories]
    await db.commit()
    await db.refresh(site)
    return {"ok": True}

@router.post("/{site_id}/fetch-categories")
async def fetch_remote_categories(site_id: int, db: AsyncSession = Depends(get_db)):
    from app.services.source_client import SourceClient
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    client = SourceClient(site_id=site.id, base_url=site.base_url, name=site.name)
    data = await client.list()
    type_map = {}
    for item in data:
        tid = item.get("type_id")
        tname = item.get("type_name")
        if tid is not None and tname:
            type_map[str(tid)] = tname
    cats = [CategoryMapping(remote_id=k, name=v) for k, v in type_map.items()]
    site.categories = [c.model_dump() for c in cats]
    await db.commit()
    await db.refresh(site)
    return SiteCategoriesOut(site_id=site_id, categories=cats)
```

---

### Task 9: API — Videos

**Files:**
- Create: `backend/app/api/videos.py`

- [ ] **Step 1: Create videos.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio
from app.db import get_db
from app.models import Site
from app.schemas import AggregatedListResponse, DetailRequest, DetailResponse, SourceDetail, Episode, FailedSource
from app.services.source_client import SourceClient
from app.services.aggregator import aggregate_lists
from app.services.parser import parse_episodes

router = APIRouter(prefix="/videos", tags=["videos"])

def _resolve_remote_category(site: Site, category: str | None) -> int | str | None:
    if not category or not site.categories:
        return None
    for cat in site.categories:
        if cat.get("name") == category:
            return cat.get("remote_id")
    return None

@router.get("")
async def list_videos(t: int | str | None = None, pg: int = 1, h: int | None = None, category: str | None = None, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).where(Site.enabled == True).order_by(Site.sort))
    sites = result.scalars().all()
    coros = []
    for site in sites:
        remote_cat = _resolve_remote_category(site, category) if category else t
        client = SourceClient(site_id=site.id, base_url=site.base_url, name=site.name)
        coros.append(_fetch_list(client, site, remote_cat, pg, h))
    results = await asyncio.gather(*coros, return_exceptions=True)
    per_source = []
    failed = []
    for site, res in zip(sites, results):
        if isinstance(res, Exception):
            failed.append(FailedSource(site_id=site.id, site_name=site.name, error=str(res)))
        else:
            per_source.append((site.id, site.name, res))
    items = aggregate_lists(per_source)
    return AggregatedListResponse(items=items, failed_sources=[f.model_dump() for f in failed])

async def _fetch_list(client: SourceClient, site: Site, t, pg, h):
    return await client.list(t=t, pg=pg, h=h)

@router.post("/detail")
async def video_detail(req: DetailRequest, db: AsyncSession = Depends(get_db)):
    coros = []
    site_map = {}
    for src in req.sources:
        site = await db.get(Site, src.site_id)
        if not site or not site.enabled:
            continue
        site_map[src.site_id] = site
        client = SourceClient(site_id=site.id, base_url=site.base_url, name=site.name)
        coros.append(_fetch_detail(client, src.original_id))
    results = await asyncio.gather(*coros, return_exceptions=True)
    sources = []
    failed = []
    for src, res in zip(req.sources, results):
        site = site_map.get(src.site_id)
        if not site:
            continue
        if isinstance(res, Exception):
            failed.append(FailedSource(site_id=site.id, site_name=site.name, error=str(res)))
            continue
        if not res:
            continue
        item = res[0]
        play_raw = item.get("vod_play_url") or item.get("play_url") or ""
        dl_raw = item.get("vod_down_url") or item.get("down_url") or ""
        episodes = []
        for raw in (play_raw, dl_raw):
            if raw:
                try:
                    episodes = parse_episodes(raw)
                    break
                except ValueError:
                    continue
        sources.append(SourceDetail(
            site_id=site.id,
            original_id=src.original_id,
            title=item.get("vod_name") or item.get("title") or req.title,
            year=item.get("vod_year") or req.year,
            poster_url=item.get("vod_pic") or None,
            intro=item.get("vod_content") or item.get("intro") or None,
            area=item.get("vod_area") or None,
            actors=item.get("vod_actor") or None,
            director=item.get("vod_director") or None,
            episodes=[Episode(ep_name=e.ep_name, url=e.url, suffix=e.suffix, index=e.index) for e in episodes],
        ))
    if not sources and failed:
        raise HTTPException(status_code=502, detail="All sources failed")
    return DetailResponse(title=req.title, year=req.year, sources=sources)

async def _fetch_detail(client: SourceClient, original_id: str):
    return await client.videolist(ids=[original_id])

@router.get("/search")
async def search_videos(wd: str, pg: int = 1, category: str | None = None, db: AsyncSession = Depends(get_db)):
    return await list_videos(t=None, pg=pg, h=None, category=category, db=db)
```

---

### Task 10: API — Play

**Files:**
- Create: `backend/app/api/play.py`

- [ ] **Step 1: Create play.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import Site
from app.schemas import Episode
from app.services.parser import parse_episodes
from app.services.source_client import SourceClient

router = APIRouter(prefix="/play", tags=["play"])

@router.get("/episodes")
async def get_episodes(site_id: int, original_id: str, db: AsyncSession = Depends(get_db)):
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    client = SourceClient(site_id=site.id, base_url=site.base_url, name=site.name)
    items = await client.videolist(ids=[original_id])
    if not items:
        raise HTTPException(status_code=404, detail="Video not found")
    item = items[0]
    play_raw = item.get("vod_play_url") or item.get("play_url") or ""
    if not play_raw:
        return []
    try:
        episodes = parse_episodes(play_raw)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"parse error: {exc}")
    return [Episode(ep_name=e.ep_name, url=e.url, suffix=e.suffix, index=e.index) for e in episodes]
```

---

### Task 11: API — Downloads

**Files:**
- Create: `backend/app/api/downloads.py`

- [ ] **Step 1: Create downloads.py**

```python
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import AppConfig, DownloadTask
from app.schemas import DownloadTaskCreate
from app.services.downloader import pause as dl_pause, resume as dl_resume

router = APIRouter(prefix="/downloads", tags=["downloads"])

@router.get("")
async def list_downloads(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DownloadTask).order_by(DownloadTask.created_at.desc()))
    return result.scalars().all()

@router.post("")
async def create_download(req: DownloadTaskCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AppConfig).where(AppConfig.key == "download_root"))
    root_row = result.scalar_one_or_none()
    if not root_row:
        raise HTTPException(status_code=409, detail="download_root not configured")
    root = Path(root_row.value)
    safe_title = "".join(c if c.isalnum() or c in "._- " else "_" for c in req.title).strip()
    episode_name = "".join(c if c.isalnum() or c in "._- " else "_" for c in req.episode_name).strip()
    ext = req.suffix if req.suffix in ("mp4", "m3u8") else "mp4"
    file_path = str(root / safe_title / f"{episode_name}.{ext}")
    task = DownloadTask(
        title=req.title,
        episode_index=req.episode_index,
        episode_name=req.episode_name,
        source_site_id=req.site_id,
        source_video_id=req.original_id,
        url=req.url,
        suffix=req.suffix,
        file_path=file_path,
        status="queued",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task

@router.post("/{task_id}/pause")
async def pause_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_pause(task_id)
    return task

@router.post("/{task_id}/resume")
async def resume_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await dl_resume(task_id)
    return task

@router.delete("/{task_id}")
async def delete_download(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(DownloadTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
    return {"ok": True}
```

---

### Task 12: API — Progress + Favorites + Settings

**Files:**
- Create: `backend/app/api/progress.py`
- Create: `backend/app/api/favorites.py`
- Create: `backend/app/api/settings_api.py`

- [ ] **Step 1: Create progress.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import PlayProgress
from app.schemas import PlayProgressIn

router = APIRouter(prefix="/progress", tags=["progress"])

@router.post("")
async def upsert_progress(req: PlayProgressIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PlayProgress).where(PlayProgress.title == req.title, PlayProgress.year == req.year))
    row = result.scalar_one_or_none()
    if row:
        row.source_site_id = req.source_site_id
        row.source_video_id = req.source_video_id
        row.episode_index = req.episode_index
        row.episode_name = req.episode_name
        row.position_seconds = req.position_seconds
        row.duration_seconds = req.duration_seconds
    else:
        row = PlayProgress(**req.model_dump())
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row

@router.get("/recent")
async def list_recent(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PlayProgress).order_by(PlayProgress.updated_at.desc()).limit(50))
    return result.scalars().all()

@router.get("")
async def get_progress(title: str, year: int | None = None, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PlayProgress).where(PlayProgress.title == title, PlayProgress.year == year))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Progress not found")
    return row
```

- [ ] **Step 2: Create favorites.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import Favorite
from app.schemas import FavoriteIn

router = APIRouter(prefix="/favorites", tags=["favorites"])

@router.get("")
async def list_favorites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Favorite).order_by(Favorite.created_at.desc()))
    return result.scalars().all()

@router.post("")
async def add_favorite(req: FavoriteIn, db: AsyncSession = Depends(get_db)):
    fav = Favorite(title=req.title, year=req.year, poster_url=req.poster_url)
    db.add(fav)
    await db.commit()
    await db.refresh(fav)
    return fav

@router.delete("/{fav_id}")
async def remove_favorite(fav_id: int, db: AsyncSession = Depends(get_db)):
    fav = await db.get(Favorite, fav_id)
    if not fav:
        raise HTTPException(status_code=404, detail="Favorite not found")
    await db.delete(fav)
    await db.commit()
    return {"ok": True}
```

- [ ] **Step 3: Create settings_api.py**

```python
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import AppConfig

router = APIRouter(prefix="/settings", tags=["settings"])

@router.get("/download-root")
async def get_download_root(db: AsyncSession = Depends(get_db)):
    row = await db.get(AppConfig, "download_root")
    return row.value if row else None

@router.put("/download-root")
async def set_download_root(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    value = body.get("value", "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="value is required")
    row = await db.get(AppConfig, "download_root")
    if row:
        row.value = value
    else:
        row = AppConfig(key="download_root", value=value)
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"key": row.key, "value": row.value}
```

---

### Task 13: Main Assembly

**Files:**
- Create: `backend/app/main.py`

- [ ] **Step 1: Create main.py**

```python
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.db import init_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="Home Theater", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api import favorites, downloads, play, progress, settings_api, sites, videos

app.include_router(sites.router, prefix="/api")
app.include_router(videos.router, prefix="/api")
app.include_router(play.router, prefix="/api")
app.include_router(downloads.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(favorites.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")

@app.get("/api/health")
async def health():
    return {"status": "ok"}

_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
```

- [ ] **Step 2: Verify backend starts**

Run: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`
In another shell: `curl http://localhost:8000/api/health`
Expected: `{"status":"ok"}`

---

### Task 14: Frontend Project Skeleton

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "home-theater-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.55",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "vite": "^5.1.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Home Theater</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Create src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Install dependencies**

Run: `cd frontend && npm install`

---

### Task 15: Frontend Router + Types + Styles

**Files:**
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/router.tsx`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/styles/global.css`

- [ ] **Step 1: Create router.tsx**

```tsx
import { createBrowserRouter } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Detail from "./pages/Detail";
import Player from "./pages/Player";
import Downloads from "./pages/Downloads";
import Favorites from "./pages/Favorites";
import Progress from "./pages/Progress";
import Settings from "./pages/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "search", element: <Search /> },
      { path: "detail", element: <Detail /> },
      { path: "player", element: <Player /> },
      { path: "downloads", element: <Downloads /> },
      { path: "favorites", element: <Favorites /> },
      { path: "progress", element: <Progress /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
```

- [ ] **Step 2: Create types.ts**

```typescript
export interface Episode {
  ep_name: string;
  url: string;
  suffix: string;
  index: number;
}

export interface SourceRef {
  site_id: number;
  original_id: string;
  type?: string;
  category?: string;
  remarks?: string;
  updated_at?: string;
}

export interface AggregatedVideo {
  title: string;
  year?: number | null;
  poster_url?: string | null;
  sources: SourceRef[];
}

export interface AggregatedListResponse {
  items: AggregatedVideo[];
  failed_sources: FailedSource[];
}

export interface SourceDetail {
  site_id: number;
  original_id: string;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  intro?: string | null;
  area?: string | null;
  actors?: string | null;
  director?: string | null;
  episodes: Episode[];
}

export interface DetailRequest {
  title: string;
  year?: number | null;
  sources: SourceRef[];
}

export interface DetailResponse {
  title: string;
  year?: number | null;
  sources: SourceDetail[];
}

export interface DownloadTaskCreate {
  site_id: number;
  original_id: string;
  episode_index: number;
  episode_name: string;
  url: string;
  suffix: string;
  title: string;
  year?: number | null;
}

export interface DownloadTask {
  id: number;
  title: string;
  episode_index: number;
  episode_name: string;
  source_site_id: number;
  source_video_id: string;
  url: string;
  suffix: string;
  file_path: string;
  total_bytes?: number | null;
  downloaded_bytes: number;
  status: string;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PlayProgressIn {
  title: string;
  year?: number | null;
  source_site_id: number;
  source_video_id: string;
  episode_index: number;
  episode_name: string;
  position_seconds: number;
  duration_seconds?: number | null;
}

export interface PlayProgress {
  id: number;
  title: string;
  year?: number | null;
  source_site_id: number;
  source_video_id: string;
  episode_index: number;
  episode_name: string;
  position_seconds: number;
  duration_seconds?: number | null;
  updated_at?: string | null;
}

export interface FavoriteIn {
  title: string;
  year?: number | null;
  poster_url?: string | null;
}

export interface Favorite {
  id: number;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  created_at?: string | null;
}

export interface ProbeResult {
  ok: boolean;
  latency_ms?: number | null;
  error?: string | null;
}

export interface FailedSource {
  site_id?: number | null;
  site_name?: string | null;
  error: string;
}

export interface CategoryMapping {
  remote_id: string;
  name: string;
}

export interface Site {
  id: number;
  name: string;
  base_url: string;
  enabled: boolean;
  sort: number;
  categories?: CategoryMapping[] | null;
  created_at?: string | null;
}
```

- [ ] **Step 3: Create global.css**

```css
:root {
  --bg: #0d0d0f;
  --fg: #f5f5f7;
  --card: #1c1c1e;
  --border: #2d2d2f;
  --primary: #0a84ff;
  --accent: #0a84ff;
  --danger: #ff453a;
  --success: #30d158;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}

a { color: var(--accent); text-decoration: none; }
button { font-family: inherit; cursor: pointer; }

.row { display: flex; gap: 12px; align-items: center; }
.col { display: flex; flex-direction: column; gap: 12px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
}
.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.empty { text-align: center; padding: 48px 16px; opacity: 0.7; }

nav {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}
nav a { color: var(--fg); opacity: 0.8; }
nav a:hover, nav a.active { opacity: 1; color: var(--accent); }

.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  min-width: 200px;
}
.toast.error { border-color: var(--danger); }
.toast.success { border-color: var(--success); }
```

---

### Task 16: Frontend API Layer

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/sites.ts`
- Create: `frontend/src/api/videos.ts`
- Create: `frontend/src/api/play.ts`
- Create: `frontend/src/api/downloads.ts`
- Create: `frontend/src/api/progress.ts`
- Create: `frontend/src/api/favorites.ts`
- Create: `frontend/src/api/settings.ts`

- [ ] **Step 1: Create api/client.ts**

```typescript
import { toastError } from "../utils/toast";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(path, opts);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const err = new ApiError(resp.status, data.detail || `${resp.status} error`);
    toastError(err.detail);
    throw err;
  }
  return resp.json();
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const del = <T>(path: string) => request<T>("DELETE", path);
```

- [ ] **Step 2: Create api/sites.ts**

```typescript
import { get, post, put, del } from "./client";
import type { Site, ProbeResult, CategoryMapping } from "../types";

export const listSites = () => get<Site[]>("/api/sites");
export const createSite = (body: Partial<Site>) => post<Site>("/api/sites", body);
export const updateSite = (id: number, body: Partial<Site>) => put<Site>(`/api/sites/${id}`, body);
export const deleteSite = (id: number) => del<{ ok: boolean }>(`/api/sites/${id}`);
export const probeSite = (id: number) => post<ProbeResult>(`/api/sites/${id}/probe`);
export const getSiteCategories = (id: number) =>
  get<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/categories`);
export const updateSiteCategories = (id: number, categories: CategoryMapping[]) =>
  put(`/api/sites/${id}/categories`, { categories });
export const fetchRemoteCategories = (id: number) =>
  post<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/fetch-categories`);
```

- [ ] **Step 3: Create api/videos.ts**

```typescript
import { get, post } from "./client";
import type { AggregatedListResponse, DetailRequest, DetailResponse } from "../types";

export const listVideos = (params?: { t?: number | string; pg?: number; h?: number; category?: string }) => {
  const qs = new URLSearchParams();
  if (params?.t != null) qs.set("t", String(params.t));
  if (params?.pg != null) qs.set("pg", String(params.pg));
  if (params?.h != null) qs.set("h", String(params.h));
  if (params?.category) qs.set("category", params.category);
  return get<AggregatedListResponse>(`/api/videos?${qs}`);
};

export const searchVideos = (params: { wd: string; pg?: number; category?: string }) => {
  const qs = new URLSearchParams();
  qs.set("wd", params.wd);
  if (params.pg != null) qs.set("pg", String(params.pg));
  if (params.category) qs.set("category", params.category);
  return get<AggregatedListResponse>(`/api/videos/search?${qs}`);
};

export const getDetail = (req: DetailRequest) => post<DetailResponse>("/api/videos/detail", req);
```

- [ ] **Step 4: Create api/play.ts**

```typescript
import { get } from "./client";
import type { Episode } from "../types";

export const getEpisodes = (site_id: number, original_id: string) =>
  get<Episode[]>(`/api/play/episodes?site_id=${site_id}&original_id=${encodeURIComponent(original_id)}`);
```

- [ ] **Step 5: Create api/downloads.ts**

```typescript
import { get, post, del } from "./client";
import type { DownloadTask, DownloadTaskCreate } from "../types";

export const createDownload = (body: DownloadTaskCreate) => post<DownloadTask>("/api/downloads", body);
export const listDownloads = () => get<DownloadTask[]>("/api/downloads");
export const pauseDownload = (id: number) => post<DownloadTask>(`/api/downloads/${id}/pause`);
export const resumeDownload = (id: number) => post<DownloadTask>(`/api/downloads/${id}/resume`);
export const deleteDownload = (id: number) => del<{ ok: boolean }>(`/api/downloads/${id}`);
```

- [ ] **Step 6: Create api/progress.ts**

```typescript
import { get, post } from "./client";
import type { PlayProgress, PlayProgressIn } from "../types";

export const upsertProgress = (body: PlayProgressIn) => post<PlayProgress>("/api/progress", body);
export const listRecent = () => get<PlayProgress[]>("/api/progress/recent");
export const getProgress = (title: string, year?: number | null) => {
  const qs = new URLSearchParams();
  qs.set("title", title);
  if (year != null) qs.set("year", String(year));
  return get<PlayProgress>(`/api/progress?${qs}`);
};
```

- [ ] **Step 7: Create api/favorites.ts**

```typescript
import { get, post, del } from "./client";
import type { Favorite, FavoriteIn } from "../types";

export const addFavorite = (body: FavoriteIn) => post<Favorite>("/api/favorites", body);
export const listFavorites = () => get<Favorite[]>("/api/favorites");
export const removeFavorite = (id: number) => del<{ ok: boolean }>(`/api/favorites/${id}`);
```

- [ ] **Step 8: Create api/settings.ts**

```typescript
import { get, put } from "./client";

export const getDownloadRoot = () => get<string | null>("/api/settings/download-root");
export const setDownloadRoot = (value: string) =>
  put<{ key: string; value: string }>("/api/settings/download-root", { value });
```

---

### Task 17: Frontend Pages — Home + Search

**Files:**
- Create: `frontend/src/pages/Home.tsx`
- Create: `frontend/src/pages/Search.tsx`

- [ ] **Step 1: Create Home.tsx**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listSites } from "../api/sites";
import { listVideos } from "../api/videos";
import CategoryBar from "../components/CategoryBar";
import VideoCard from "../components/VideoCard";
import type { AggregatedVideo, Site, FailedSource } from "../types";

export default function Home() {
  const [sites, setSites] = useState<Site[]>([]);
  const [videos, setVideos] = useState<AggregatedVideo[]>([]);
  const [failed, setFailed] = useState<FailedSource[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadVideos = (category?: string) => {
    listVideos(category ? { category } : {}).then((r) => {
      setVideos(r.items);
      setFailed(r.failed_sources);
    });
  };

  useEffect(() => {
    listSites().then((s) => {
      setSites(s);
      if (s.length > 0) loadVideos();
    });
  }, []);

  useEffect(() => {
    if (sites.length > 0) loadVideos(activeCategory || undefined);
  }, [activeCategory]);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>暂无采集站</h2>
        <p>请先去「设置」页添加资源站点。</p>
        <button className="btn btn-primary" onClick={() => navigate("/settings")}>
          去设置
        </button>
      </div>
    );
  }

  return (
    <div>
      {failed.length > 0 && (
        <div style={{ padding: 8, background: "var(--card)", borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
          {failed.length} 个源加载失败
        </div>
      )}
      <CategoryBar sites={sites} activeCategory={activeCategory} onSelect={(cat) => setActiveCategory(cat)} />
      <div className="grid">
        {videos.map((v) => (
          <VideoCard key={`${v.title}-${v.year}`} item={v} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Search.tsx**

```tsx
import { useState } from "react";
import { searchVideos } from "../api/videos";
import VideoCard from "../components/VideoCard";
import type { AggregatedVideo, FailedSource } from "../types";

export default function Search() {
  const [wd, setWd] = useState("");
  const [videos, setVideos] = useState<AggregatedVideo[]>([]);
  const [failed, setFailed] = useState<FailedSource[]>([]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wd.trim()) return;
    searchVideos({ wd: wd.trim() }).then((r) => {
      setVideos(r.items);
      setFailed(r.failed_sources);
    });
  };

  return (
    <div>
      <form onSubmit={handleSearch} className="row" style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={wd}
          onChange={(e) => setWd(e.target.value)}
          placeholder="输入关键字搜索..."
          style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)" }}
        />
        <button type="submit" className="btn btn-primary">搜索</button>
      </form>
      {failed.length > 0 && (
        <div style={{ padding: 8, background: "var(--card)", borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
          {failed.length} 个源加载失败
        </div>
      )}
      <div className="grid">
        {videos.map((v) => (
          <VideoCard key={`${v.title}-${v.year}`} item={v} />
        ))}
      </div>
    </div>
  );
}
```

---

### Task 18: Frontend Pages — Detail + Player

**Files:**
- Create: `frontend/src/pages/Detail.tsx`
- Create: `frontend/src/pages/Player.tsx`

- [ ] **Step 1: Create Detail.tsx**

```tsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getDetail } from "../api/videos";
import { getDownloadRoot } from "../api/settings";
import { addFavorite } from "../api/favorites";
import { createDownload } from "../api/downloads";
import EpisodeList from "../components/EpisodeList";
import SourcePicker from "../components/SourcePicker";
import type { DetailResponse, SourceDetail, SourceRef } from "../types";

export default function Detail() {
  const location = useLocation();
  const navigate = useNavigate();
  const init = (location.state || {}) as { title?: string; year?: number | null; poster_url?: string | null; sources?: SourceRef[] };
  const [data, setData] = useState<DetailResponse | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"play" | "download" | null>(null);
  const [selectedEpIndex, setSelectedEpIndex] = useState(0);

  useEffect(() => {
    if (!init.title || !init.sources?.length) return;
    getDetail({ title: init.title, year: init.year, sources: init.sources }).then(setData);
  }, []);

  const handlePlay = (epIndex: number) => {
    setSelectedEpIndex(epIndex);
    setPickerMode("play");
    setPickerOpen(true);
  };

  const handleDownload = (epIndex: number) => {
    setSelectedEpIndex(epIndex);
    setPickerMode("download");
    setPickerOpen(true);
  };

  const onPickSource = async (source: SourceRef) => {
    const detail = data?.sources.find((s) => s.site_id === source.site_id && s.original_id === source.original_id);
    if (!detail) return;
    const ep = detail.episodes[selectedEpIndex];
    if (!ep) return;
    if (pickerMode === "play") {
      navigate(`/player?site_id=${source.site_id}&original_id=${encodeURIComponent(source.original_id)}&ep=${selectedEpIndex}`);
    } else if (pickerMode === "download") {
      const root = await getDownloadRoot();
      if (!root) {
        alert("请先设置下载根目录");
        navigate("/settings");
        return;
      }
      await createDownload({
        site_id: source.site_id,
        original_id: source.original_id,
        episode_index: ep.index,
        episode_name: ep.ep_name,
        url: ep.url,
        suffix: ep.suffix,
        title: data?.title || detail.title,
        year: data?.year,
      });
      alert("下载任务已创建");
    }
    setPickerOpen(false);
  };

  const sourcesForPicker = (data?.sources || []).map((s) => ({
    site_id: s.site_id,
    original_id: s.original_id,
    type: s.episodes[selectedEpIndex]?.suffix,
  }));

  return (
    <div className="col">
      {init.poster_url && (
        <img src={init.poster_url} alt={init.title} style={{ maxWidth: 240, borderRadius: 8, alignSelf: "flex-start" }} />
      )}
      <h2>{data?.title || init.title}</h2>
      {data?.year && <div>年份：{data.year}</div>}
      {data?.sources?.[0]?.area && <div>地区：{data.sources[0].area}</div>}
      {data?.sources?.[0]?.actors && <div>演员：{data.sources[0].actors}</div>}
      {data?.sources?.[0]?.director && <div>导演：{data.sources[0].director}</div>}
      {data?.sources?.[0]?.intro && (
        <div style={{ fontSize: 14, opacity: 0.8 }} dangerouslySetInnerHTML={{ __html: data.sources[0].intro }} />
      )}
      <div className="row">
        <button className="btn" onClick={() => addFavorite({ title: init.title || "", year: init.year, poster_url: init.poster_url })}>
          收藏
        </button>
      </div>
      {data?.sources.map((s) => (
        <div key={s.site_id} className="col" style={{ gap: 8 }}>
          <div>来源 #{s.site_id}</div>
          <EpisodeList
            episodes={s.episodes}
            onPick={(idx) => handlePlay(idx)}
          />
          <div className="row" style={{ gap: 8 }}>
            {s.episodes.map((ep) => (
              <button key={ep.index} className="btn" onClick={() => handleDownload(ep.index)}>
                下载 {ep.ep_name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <SourcePicker
        sources={sourcesForPicker}
        open={pickerOpen}
        title={pickerMode === "play" ? "选择播放源" : "选择下载源"}
        onCancel={() => setPickerOpen(false)}
        onConfirm={onPickSource}
        formatSubtitle={(s) => `类型: ${s.type || "-"}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create Player.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getEpisodes } from "../api/play";
import { upsertProgress } from "../api/progress";
import type { Episode } from "../types";

export default function Player() {
  const [searchParams] = useSearchParams();
  const site_id = Number(searchParams.get("site_id"));
  const original_id = searchParams.get("original_id") || "";
  const initialEp = Number(searchParams.get("ep") || "0");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(initialEp);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!site_id || !original_id) return;
    getEpisodes(site_id, original_id).then(setEpisodes);
  }, [site_id, original_id]);

  const current = episodes[currentIndex];

  useEffect(() => {
    if (!current) return;
    progressTimer.current = setInterval(() => {
      const pos = Math.floor(videoRef.current?.currentTime || 0);
      const dur = Math.floor(videoRef.current?.duration || 0);
      upsertProgress({
        title: current.ep_name,
        year: null,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      }).catch(() => {});
    }, 15000);

    const handleBeforeUnload = () => {
      const pos = Math.floor(videoRef.current?.currentTime || 0);
      const dur = Math.floor(videoRef.current?.duration || 0);
      const data = JSON.stringify({
        title: current.ep_name,
        year: null,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      });
      navigator.sendBeacon("/api/progress", new Blob([data], { type: "application/json" }));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [current, currentIndex, site_id, original_id]);

  if (!site_id || !original_id) return <div className="empty">参数缺失</div>;

  return (
    <div className="col">
      <div style={{ aspectRatio: "16/9", background: "#000", borderRadius: 8, overflow: "hidden" }}>
        <video ref={videoRef} src={current?.url} controls style={{ width: "100%", height: "100%" }} autoPlay />
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn" disabled={currentIndex <= 0} onClick={() => setCurrentIndex((i) => i - 1)}>上一集</button>
        <div>{current ? `${current.ep_name} (${current.suffix})` : "加载中..."}</div>
        <button className="btn" disabled={currentIndex >= episodes.length - 1} onClick={() => setCurrentIndex((i) => i + 1)}>下一集</button>
      </div>
      <div>
        <h4>选集</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {episodes.map((ep) => (
            <button
              key={ep.index}
              className="btn"
              style={{ borderColor: ep.index === currentIndex ? "var(--accent)" : undefined }}
              onClick={() => setCurrentIndex(ep.index)}
            >
              {ep.ep_name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

### Task 19: Frontend Pages — Downloads + Favorites + Progress

**Files:**
- Create: `frontend/src/pages/Downloads.tsx`
- Create: `frontend/src/pages/Favorites.tsx`
- Create: `frontend/src/pages/Progress.tsx`

- [ ] **Step 1: Create Downloads.tsx**

```tsx
import { useEffect, useState } from "react";
import { listDownloads, pauseDownload, resumeDownload, deleteDownload } from "../api/downloads";
import type { DownloadTask } from "../types";

export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const refresh = () => listDownloads().then(setTasks);
  useEffect(() => { refresh(); }, []);

  const statusText: Record<string, string> = {
    queued: "排队中", downloading: "下载中", paused: "已暂停", done: "完成", error: "错误",
  };

  return (
    <div className="col">
      <h2>下载任务</h2>
      {tasks.map((t) => (
        <div key={t.id} className="row" style={{ justifyContent: "space-between", padding: 10, background: "var(--card)", borderRadius: 6 }}>
          <div>
            <div style={{ fontWeight: 500 }}>{t.title} · {t.episode_name}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {statusText[t.status] || t.status} · {t.downloaded_bytes} / {t.total_bytes ?? "-"} bytes
            </div>
          </div>
          <div className="row">
            {t.status === "downloading" && (
              <button className="btn" onClick={() => pauseDownload(t.id).then(refresh)}>暂停</button>
            )}
            {t.status === "paused" && (
              <button className="btn" onClick={() => resumeDownload(t.id).then(refresh)}>继续</button>
            )}
            <button className="btn" onClick={() => deleteDownload(t.id).then(refresh)}>删除</button>
          </div>
        </div>
      ))}
      {tasks.length === 0 && <div className="empty">暂无下载任务</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create Favorites.tsx**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listFavorites, removeFavorite } from "../api/favorites";
import type { Favorite } from "../types";

export default function Favorites() {
  const [items, setItems] = useState<Favorite[]>([]);
  const navigate = useNavigate();
  useEffect(() => { listFavorites().then(setItems); }, []);

  return (
    <div>
      <h2>我的收藏</h2>
      <div className="grid" style={{ marginTop: 12 }}>
        {items.map((f) => (
          <div key={f.id} style={{ cursor: "pointer", position: "relative" }} onClick={() => navigate("/detail", { state: { title: f.title, year: f.year, poster_url: f.poster_url, sources: [] } })}>
            <div style={{ aspectRatio: "2/3", background: "var(--card)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
              {f.poster_url ? (
                <img src={f.poster_url} alt={f.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div className="empty" style={{ height: "100%" }}>无封面</div>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 14 }}>{f.title}</div>
            {f.year && <div style={{ fontSize: 12, opacity: 0.7 }}>{f.year}</div>}
            <button className="btn" style={{ position: "absolute", top: 4, right: 4, padding: "4px 8px", fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); removeFavorite(f.id).then(() => setItems((prev) => prev.filter((x) => x.id !== f.id))); }}>
              删除
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="empty">暂无收藏</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create Progress.tsx**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRecent } from "../api/progress";
import type { PlayProgress } from "../types";

export default function Progress() {
  const [items, setItems] = useState<PlayProgress[]>([]);
  const navigate = useNavigate();
  useEffect(() => { listRecent().then(setItems); }, []);

  return (
    <div>
      <h2>最近播放</h2>
      <div className="col" style={{ marginTop: 12 }}>
        {items.map((p) => (
          <div key={p.id} className="row" style={{ padding: 10, background: "var(--card)", borderRadius: 6, cursor: "pointer" }}
            onClick={() => navigate(`/player?site_id=${p.source_site_id}&original_id=${encodeURIComponent(p.source_video_id)}&ep=${p.episode_index}`)}>
            <div>
              <div style={{ fontWeight: 500 }}>{p.title}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {p.episode_name} · {formatTime(p.position_seconds)} / {p.duration_seconds ? formatTime(p.duration_seconds) : "-"}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="empty">暂无播放记录</div>}
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

---

### Task 20: Frontend Page — Settings

**Files:**
- Create: `frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Create Settings.tsx**

```tsx
import { useEffect, useState } from "react";
import { listSites, createSite, deleteSite, probeSite, updateSite } from "../api/sites";
import { getDownloadRoot, setDownloadRoot } from "../api/settings";
import CategorySettings from "../components/CategorySettings";
import type { ProbeResult, Site } from "../types";

export default function Settings() {
  const [sites, setSites] = useState<Site[]>([]);
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<number, ProbeResult>>({});

  useEffect(() => {
    listSites().then(setSites);
    getDownloadRoot().then((r) => { setSavedRoot(r); if (r) setRoot(r); });
  }, []);

  const addSite = () => {
    const name = prompt("站点名称");
    const base_url = prompt("站点地址（如 http://xxx.php）");
    if (!name || !base_url) return;
    createSite({ name, base_url, enabled: true, sort: 0 }).then((s) => setSites((prev) => [...prev, s]));
  };

  const doProbe = (id: number) => {
    probeSite(id).then((r) => setProbeResults((prev) => ({ ...prev, [id]: r })));
  };

  const saveRoot = () => {
    if (!root.trim()) return;
    setDownloadRoot(root.trim()).then((r) => setSavedRoot(r.value));
  };

  return (
    <div className="col">
      <section>
        <h2>采集站管理</h2>
        <div className="col" style={{ marginTop: 12 }}>
          {sites.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: "space-between", padding: 10, background: "var(--card)", borderRadius: 6 }}>
              <div>
                <div>{s.name}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{s.base_url}</div>
                {probeResults[s.id] && (
                  <div style={{ fontSize: 12, marginTop: 4, color: probeResults[s.id].ok ? "var(--success)" : "var(--danger)" }}>
                    {probeResults[s.id].ok ? `OK ${probeResults[s.id].latency_ms}ms` : `FAIL ${probeResults[s.id].error}`}
                  </div>
                )}
              </div>
              <div className="row">
                <button className="btn" onClick={() => doProbe(s.id)}>Probe</button>
                <button className="btn" onClick={() => updateSite(s.id, { enabled: !s.enabled }).then(() => listSites().then(setSites))}>
                  {s.enabled ? "禁用" : "启用"}
                </button>
                <button className="btn" onClick={() => deleteSite(s.id).then(() => setSites((prev) => prev.filter((x) => x.id !== s.id)))}>删除</button>
              </div>
            </div>
          ))}
          <button className="btn btn-primary" onClick={addSite} style={{ alignSelf: "flex-start" }}>+ 添加站点</button>
        </div>
      </section>
      <section>
        <h2>分类设置</h2>
        <CategorySettings sites={sites} />
      </section>
      <section>
        <h2>下载根目录</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <input type="text" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="例如 D:/Downloads"
            style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)" }} />
          <button className="btn btn-primary" onClick={saveRoot}>保存</button>
        </div>
        {savedRoot && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>当前：{savedRoot}</div>}
      </section>
    </div>
  );
}
```

---

### Task 21: Frontend Components — Layout + VideoCard + EpisodeList + SourcePicker

**Files:**
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/VideoCard.tsx`
- Create: `frontend/src/components/EpisodeList.tsx`
- Create: `frontend/src/components/SourcePicker.tsx`

- [ ] **Step 1: Create Layout.tsx**

```tsx
import { NavLink, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div>
      <nav>
        <NavLink to="/" end>首页</NavLink>
        <NavLink to="/search">搜索</NavLink>
        <NavLink to="/favorites">收藏</NavLink>
        <NavLink to="/progress">最近</NavLink>
        <NavLink to="/downloads">下载</NavLink>
        <NavLink to="/settings">设置</NavLink>
      </nav>
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create VideoCard.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDetail } from "../api/videos";
import type { AggregatedVideo } from "../types";

export default function VideoCard({ item }: { item: AggregatedVideo }) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [poster, setPoster] = useState<string | null>(item.poster_url || null);

  useEffect(() => {
    if (poster) return;
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && item.sources.length > 0) {
            getDetail({ title: item.title, year: item.year, sources: item.sources }).then((d) => {
              const p = d.sources?.[0]?.poster_url;
              if (p) setPoster(p);
            }).catch(() => {});
            obs.disconnect();
          }
        });
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [item, poster]);

  return (
    <div ref={cardRef} style={{ cursor: "pointer" }} onClick={() => navigate("/detail", { state: item })}>
      <div style={{ aspectRatio: "2/3", background: "var(--card)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
        {poster ? (
          <img src={poster} alt={item.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="empty" style={{ height: "100%" }}>无封面</div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 14 }}>{item.title}</div>
      {item.year && <div style={{ fontSize: 12, opacity: 0.7 }}>{item.year}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create EpisodeList.tsx**

```tsx
import type { Episode } from "../types";

export default function EpisodeList({ episodes, onPick }: { episodes: Episode[]; onPick: (index: number) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {episodes.map((ep) => (
        <button key={ep.index} className="btn" onClick={() => onPick(ep.index)} title={ep.url}>
          {ep.ep_name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create SourcePicker.tsx**

```tsx
import { useState } from "react";
import type { SourceRef } from "../types";

type SourcePickerProps = {
  sources: SourceRef[];
  open: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (source: SourceRef) => void;
  formatSubtitle?: (source: SourceRef) => string | undefined;
};

export default function SourcePicker(props: SourcePickerProps) {
  const { sources, open, title, onCancel, onConfirm, formatSubtitle } = props;
  const [picked, setPicked] = useState<SourceRef | null>(null);
  if (!open) return null;

  return (
    <div className="source-picker-mask" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: "var(--card, #1c1c1e)", color: "var(--fg, #f5f5f7)", padding: 20, borderRadius: 8, width: "min(420px, 92vw)", border: "1px solid var(--border, #2d2d2f)" }}>
        <h3 style={{ marginTop: 0 }}>{title ?? "请选择来源"}</h3>
        <p style={{ opacity: 0.7, fontSize: 13 }}>每个源由不同采集站提供，请显式点选一个再确认。</p>
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0", maxHeight: 320, overflowY: "auto" }}>
          {sources.length === 0 && <li style={{ opacity: 0.7, padding: 12 }}>无可用源</li>}
          {sources.map((s) => {
            const key = `${s.site_id}-${s.original_id}`;
            const isPicked = picked != null && picked.site_id === s.site_id && picked.original_id === s.original_id;
            return (
              <li key={key}>
                <button type="button" onClick={() => setPicked(s)} style={{ width: "100%", textAlign: "left", padding: "10px 12px", margin: "4px 0", border: isPicked ? "1px solid var(--accent, #0a84ff)" : "1px solid var(--border, #2d2d2f)", background: isPicked ? "rgba(10,132,255,0.12)" : "transparent", borderRadius: 6, color: "inherit", cursor: "pointer" }}>
                  <div style={{ fontWeight: 500 }}>站点 #{s.site_id} · 原始 ID {s.original_id}</div>
                  {formatSubtitle && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{formatSubtitle(s)}</div>}
                </button>
              </li>
            );
          })}
        </ul>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={picked == null} onClick={() => picked && onConfirm(picked)}>确定</button>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 22: Frontend Components — CategoryBar + CategorySettings + Toast

**Files:**
- Create: `frontend/src/components/CategoryBar.tsx`
- Create: `frontend/src/components/CategorySettings.tsx`
- Create: `frontend/src/utils/toast.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create CategoryBar.tsx**

```tsx
import { useMemo } from "react";
import type { Site } from "../types";

interface CategoryBarProps {
  sites: Site[];
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
}

export default function CategoryBar({ sites, activeCategory, onSelect }: CategoryBarProps) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const site of sites) {
      for (const cat of site.categories || []) {
        if (cat.name) set.add(cat.name);
      }
    }
    return Array.from(set).sort();
  }, [sites]);

  if (categories.length === 0) return null;

  return (
    <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      <button className="btn" style={{ background: activeCategory === null ? "var(--primary)" : undefined, color: activeCategory === null ? "#fff" : undefined }}
        onClick={() => onSelect(null)}>全部</button>
      {categories.map((name) => (
        <button key={name} className="btn" style={{ background: activeCategory === name ? "var(--primary)" : undefined, color: activeCategory === name ? "#fff" : undefined }}
          onClick={() => onSelect(name)}>{name}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create CategorySettings.tsx**

```tsx
import { useEffect, useState } from "react";
import { updateSiteCategories, fetchRemoteCategories } from "../api/sites";
import type { CategoryMapping, Site } from "../types";

interface CategoryRow {
  system_name: string;
  mappings: Record<number, string>;
}

export default function CategorySettings({ sites }: { sites: Site[] }) {
  const [remoteCats, setRemoteCats] = useState<Record<number, CategoryMapping[]>>({});
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAllRemote = () => {
    sites.forEach((site) => {
      fetchRemoteCategories(site.id).then((res) => {
        setRemoteCats((prev) => ({ ...prev, [site.id]: res.categories }));
      });
    });
  };

  const buildRowsFromSites = () => {
    const map: Record<string, Record<number, string>> = {};
    for (const site of sites) {
      for (const cat of site.categories || []) {
        const sys = cat.name || "";
        if (!sys) continue;
        if (!map[sys]) map[sys] = {};
        map[sys][site.id] = cat.remote_id;
      }
    }
    setRows(Object.entries(map).map(([system_name, mappings]) => ({ system_name, mappings: { ...mappings } })));
  };

  useEffect(() => { loadAllRemote(); buildRowsFromSites(); }, [sites]);

  const addRow = () => setRows((prev) => [...prev, { system_name: "", mappings: {} }]);
  const removeRow = (idx: number) => setRows((prev) => { const arr = [...prev]; arr.splice(idx, 1); return arr; });
  const updateRowName = (idx: number, val: string) => setRows((prev) => { const arr = [...prev]; arr[idx] = { ...arr[idx], system_name: val }; return arr; });
  const updateRowMapping = (idx: number, siteId: number, remoteId: string) =>
    setRows((prev) => { const arr = [...prev]; arr[idx] = { ...arr[idx], mappings: { ...arr[idx].mappings, [siteId]: remoteId } }; return arr; });

  const save = async () => {
    setLoading(true);
    try {
      for (const site of sites) {
        const cats: CategoryMapping[] = [];
        for (const row of rows) {
          const remoteId = row.mappings[site.id];
          if (row.system_name && remoteId) cats.push({ remote_id: remoteId, name: row.system_name });
        }
        await updateSiteCategories(site.id, cats);
      }
      alert("保存成功");
    } catch {
      alert("保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={loadAllRemote}>重新拉取各站分类</button>
        <button className="btn btn-primary" onClick={save} disabled={loading}>{loading ? "保存中…" : "保存映射"}</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)", minWidth: 120 }}>系统分类</th>
              {sites.map((s) => (
                <th key={s.id} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)", minWidth: 140 }}>{s.name} 映射</th>
              ))}
              <th style={{ width: 60, borderBottom: "1px solid var(--border)" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
                  <input type="text" value={row.system_name} onChange={(e) => updateRowName(idx, e.target.value)} placeholder="如：电影"
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }} />
                </td>
                {sites.map((s) => (
                  <td key={s.id} style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
                    <select value={row.mappings[s.id] || ""} onChange={(e) => updateRowMapping(idx, s.id, e.target.value)}
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }}>
                      <option value="">-- 不映射 --</option>
                      {(remoteCats[s.id] || []).map((c) => (
                        <option key={c.remote_id} value={c.remote_id}>{c.name} ({c.remote_id})</option>
                      ))}
                    </select>
                  </td>
                ))}
                <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
                  <button className="btn" onClick={() => removeRow(idx)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" onClick={addRow} style={{ alignSelf: "flex-start" }}>+ 新增分类映射</button>
    </div>
  );
}
```

- [ ] **Step 3: Create utils/toast.ts**

```typescript
export type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let listeners: ((toasts: ToastItem[]) => void)[] = [];
let toasts: ToastItem[] = [];
let nextId = 1;

function notify() {
  listeners.forEach((fn) => fn([...toasts]));
}

export function subscribe(fn: (toasts: ToastItem[]) => void) {
  listeners.push(fn);
  fn([...toasts]);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function toast(type: ToastType, message: string, duration = 3000) {
  const id = nextId++;
  toasts.push({ id, type, message });
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, duration);
}

export function toastError(message: string) {
  toast("error", message);
}

export function toastSuccess(message: string) {
  toast("success", message);
}
```

- [ ] **Step 4: Update App.tsx**

```tsx
import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { subscribe, type ToastType } from "./utils/toast";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    return subscribe(setToasts);
  }, []);
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  );
}
```

---

### Task 23: Final Verification

**Files:**
- Verify all backend endpoints via curl
- Verify frontend build succeeds
- Verify static hosting works

- [ ] **Step 1: Backend smoke test**

Run:
```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```
In another shell:
```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/sites
```
Expected: `{"status":"ok"}` and `[]` (or existing sites).

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: `tsc` passes, Vite builds dist/ without errors.

- [ ] **Step 3: Static hosting verification**

Ensure `frontend/dist/` exists after build.
Restart uvicorn.
Visit `http://localhost:8000/` in browser.
Expected: SPA loads, nav visible, Home page renders.

---

## Self-Review

### 1. Spec Coverage

| Spec Requirement | Task |
|---|---|
| FastAPI async + httpx concurrent fetch | Task 1, 4 |
| SQLAlchemy async + aiosqlite | Task 1, 2 |
| pydantic-settings | Task 1 |
| Site/Favorite/PlayProgress/DownloadTask/AppConfig models | Task 2 |
| All Pydantic schemas | Task 3 |
| source_client (ac/t/pg/wd/h/ids) | Task 4 |
| parser (集数$地址$后缀) | Task 5 |
| aggregator (normalize_title + year) | Task 6 |
| health.probe | Task 7 |
| downloader skeleton (TODO) | Task 7 |
| sites CRUD + probe + categories | Task 8 |
| videos list/detail/search | Task 9 |
| play/episodes | Task 10 |
| downloads CRUD + pause/resume + 409 on no root | Task 11 |
| progress upsert/recent/get | Task 12 |
| favorites add/list/remove | Task 12 |
| settings download_root | Task 12 |
| main.py router mount + static hosting | Task 13 |
| React + Vite + TS | Task 14 |
| react-router | Task 15 |
| types.ts matching schemas | Task 15 |
| global.css dark theme | Task 15 |
| api/client.ts + auto toastError | Task 16 |
| Home with CategoryBar | Task 17 |
| Search | Task 17 |
| Detail with SourcePicker | Task 18 |
| Player with progress reporting | Task 18 |
| Downloads | Task 19 |
| Favorites | Task 19 |
| Progress | Task 19 |
| Settings with CategorySettings | Task 20 |
| VideoCard lazy poster | Task 21 |
| SourcePicker no-default-selection | Task 21 |
| CategoryBar + CategorySettings | Task 22 |
| Toast system | Task 22 |
| Build + smoke test | Task 23 |

**No gaps.**

### 2. Placeholder Scan

- No "TBD", "TODO", "implement later" in any task code.
- downloader.py has a `TODO` comment about real download loop, which is explicitly allowed by the spec ("真正循环留 TODO").
- All steps contain complete code blocks.

### 3. Type Consistency

- `Episode` interface matches in types.ts, schemas.py, parser.py, and all usages.
- `SourceRef` fields consistent across backend/frontend.
- `DownloadTaskCreate` fields match between types.ts and schemas.py.
- `PlayProgressIn`/`PlayProgressOut` consistent.
- `FavoriteIn`/`FavoriteOut` consistent.
- Route paths (`/api/xxx`) consistent between backend routers and frontend api modules.

**All consistent.**
