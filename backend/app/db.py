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
    自动遍历所有模型，对比实际表结构，无需手动维护列清单。"""
    from sqlalchemy import inspect
    from app.models import Base

    def _sync_ensure(sync_conn):
        inspector = inspect(sync_conn)
        for table_name, table in Base.metadata.tables.items():
            try:
                existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
            except Exception:
                continue  # 表可能还不存在
            for col in table.columns:
                if col.name in existing_cols:
                    continue
                col_type = col.type.compile(dialect=sync_conn.dialect)
                nullable = " NULL" if col.nullable else " NOT NULL"
                default = ""
                if col.default is not None:
                    arg = getattr(col.default, "arg", None)
                    if arg is not None and not callable(arg):
                        if isinstance(arg, bool):
                            default = f" DEFAULT {1 if arg else 0}"
                        elif isinstance(arg, (int, float)):
                            default = f" DEFAULT {arg}"
                        elif isinstance(arg, str):
                            default = f" DEFAULT '{arg}'"
                sql = f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}{nullable}{default}"
                try:
                    sync_conn.execute(text(sql))
                except Exception:
                    pass  # 列已存在或类型不兼容，忽略

    await conn.run_sync(_sync_ensure)
