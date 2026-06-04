from sqlalchemy import text
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
        # 自动补齐 SQLite 表中缺失的列
        await _ensure_columns(conn)


async def _ensure_columns(conn) -> None:
    """为已有表添加 models 中新增但表中不存在的列（SQLite 专用）。
    所有列名、类型、默认值均为内部硬编码常量，禁止从外部传入。"""
    _ALLOWED = {
        "download_tasks": [
            ("total_segments", "INTEGER", "NULL"),
            ("downloaded_segments", "INTEGER", "0"),
            ("auto_disabled_at", "DATETIME", "NULL"),
        ],
        "video_cache": [
            ("type_id", "INTEGER", "NULL"),
            ("type_name", "VARCHAR", "NULL"),
            ("remarks", "VARCHAR", "NULL"),
            ("play_from", "VARCHAR", "NULL"),
            ("has_detail", "BOOLEAN", "0"),
        ],
        "favorites": [
            ("sources", "TEXT", "NULL"),
        ],
    }
    async with conn.begin_nested():
        for table, alterations in _ALLOWED.items():
            for col_name, col_type, col_default in alterations:
                try:
                    await conn.execute(
                        text(
                            f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type} DEFAULT {col_default}"
                        )
                    )
                except Exception:
                    pass
