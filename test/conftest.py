import os
import sys
from pathlib import Path

_BACKEND_DIR = str(Path(__file__).parent.parent / "backend")
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

os.environ["DB_PATH"] = ":memory:"

# Import config first so settings pick up :memory:
from app.config import settings

# Create a shared in-memory engine with StaticPool before any downstream imports
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

_test_engine = create_async_engine(
    settings.db_url,
    echo=False,
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
_test_async_session_factory = async_sessionmaker(_test_engine, expire_on_commit=False)

# Inject into app.db BEFORE other modules import it
import app.db as _db_module
_db_module.engine = _test_engine
_db_module.async_session_factory = _test_async_session_factory

# Now safe to import everything else
from collections.abc import AsyncGenerator
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete

from app.models import Base
from app.db import get_db

from fastapi import FastAPI
from app.api import favorites, downloads, play, progress, settings_api, sites, sse, videos

test_app = FastAPI()
test_app.include_router(sites.router, prefix="/api")
test_app.include_router(videos.router, prefix="/api")
test_app.include_router(play.router, prefix="/api")
test_app.include_router(downloads.router, prefix="/api")
test_app.include_router(progress.router, prefix="/api")
test_app.include_router(favorites.router, prefix="/api")
test_app.include_router(settings_api.router, prefix="/api")
test_app.include_router(sse.router, prefix="/api")


@test_app.get("/api/health")
async def _health():
    return {"status": "ok"}


@pytest_asyncio.fixture(scope="session")
async def test_engine() -> AsyncGenerator:
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield _test_engine
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await _test_engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator:
    async with _test_async_session_factory() as session:
        yield session
        # Truncate all tables after each test for isolation
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(delete(table))
        await session.commit()


@pytest_asyncio.fixture
async def async_client(db_session) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator:
        yield db_session

    test_app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    test_app.dependency_overrides.clear()
