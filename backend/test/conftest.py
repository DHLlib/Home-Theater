import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Base

TEST_DATABASE_URL = os.environ.get(
    "TEST_DB_URL",
    settings.database_url.rsplit("/", 1)[0] + "/home_theater_test",
)

engine = create_async_engine(
    TEST_DATABASE_URL,
    echo=False,
    pool_size=2,
    max_overflow=0,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _prepare_database():
    """会话级 fixture：建表、安装 pg_trgm 扩展。"""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """每个测试独立 session：开始前 truncate 所有业务表保证隔离。"""
    async with async_session_factory() as session:
        async with session.begin():
            for table in reversed(Base.metadata.sorted_tables):
                await session.execute(text(f"TRUNCATE TABLE {table.name} CASCADE"))
        await session.commit()
        yield session
