> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。

# REFACTOR-DB-001 数据库引擎迁移架构设计

## 文档信息

| 字段 | 值 |
|---|---|
| 编号 | REFACTOR-DB-001 |
| 标题 | SQLite + aiosqlite → PostgreSQL + asyncpg |
| 状态 | 架构设计 |
| 依赖 | 无 |
| 阻塞 | AC-030, AC-031, AC-032, AC-033, AC-034 |

---

## 1. 迁移方案（文件变更清单）

### 1.1 核心变更文件

| 文件 | 动作 | 变更内容 |
|---|---|---|
| `backend/pyproject.toml` | 修改 | 移除 `aiosqlite>=0.20`，添加 `asyncpg>=0.29` |
| `backend/app/config.py` | 修改 | `db_url` 从 SQLite 文件路径改为 PostgreSQL DSN；支持 `DATABASE_URL` 环境变量 |
| `backend/app/db.py` | 重写 | 移除 PRAGMA、`_ensure_columns`；配置 PostgreSQL 连接池；新增健康检查 |
| `backend/app/main.py` | 修改 | `lifespan` 中 `init_db()` 前增加数据库连通性检查；健康检查端点增强 |
| `backend/app/models.py` | 修改 | `Base` 类添加 `type_annotation_map` 确保 JSON → JSONB；`autoincrement=True` 保留兼容 |
| `backend/app/api/videos.py` | 修改 | `sqlite_insert` → `postgresql_insert`；`on_conflict_do_update` 语法适配 |
| `backend/app/services/crawler.py` | 修改 | `sqlite_insert` → `postgresql_insert`；批量 upsert 语法适配 |

### 1.2 无变更文件（确认兼容）

| 文件 | 说明 |
|---|---|
| `backend/app/api/sites.py` | 纯 CRUD + 业务逻辑，无方言依赖 |
| `backend/app/api/downloads.py` | 纯 CRUD，无方言依赖 |
| `backend/app/api/favorites.py` | 纯 CRUD，无方言依赖 |
| `backend/app/api/play.py` | 纯业务逻辑，无方言依赖 |
| `backend/app/api/progress.py` | 纯 CRUD，无方言依赖 |
| `backend/app/api/settings_api.py` | 纯 CRUD，无方言依赖 |
| `backend/app/api/sse.py` | 纯 SSE 推送，无方言依赖 |
| `backend/app/api/system_categories.py` | 纯 CRUD，无方言依赖 |
| `backend/app/services/scheduler.py` | 调度逻辑，无方言依赖 |
| `backend/app/services/downloader.py` | 下载逻辑，无方言依赖 |
| `backend/app/services/source_client.py` | HTTP 客户端，无方言依赖 |
| `backend/app/services/parser.py` | 文本解析，无方言依赖 |
| `backend/app/services/resolver.py` | URL 解析，无方言依赖 |
| `backend/app/services/aggregator.py` | 聚合逻辑，无方言依赖 |
| `backend/app/services/smart_matcher.py` | 纯函数匹配，无方言依赖 |
| `backend/app/services/template_manager.py` | 纯函数逻辑，无方言依赖 |
| `backend/app/services/health.py` | 站点探测，无方言依赖 |
| `backend/app/services/event_bus.py` | 内存事件总线，无方言依赖 |
| `backend/app/schemas.py` | Pydantic schema，无方言依赖 |
| `backend/app/constants.py` | 常量定义，无方言依赖 |

---

## 2. 连接配置设计

### 2.1 环境变量

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/ht` | 完整 DSN，优先级最高 |
| `DB_HOST` | `localhost` | 数据库主机 |
| `DB_PORT` | `5432` | 数据库端口 |
| `DB_NAME` | `ht` | 数据库名 |
| `DB_USER` | `postgres` | 用户名 |
| `DB_PASSWORD` | `postgres` | 密码 |
| `DB_POOL_SIZE` | `5` | 连接池固定大小 |
| `DB_MAX_OVERFLOW` | `10` | 连接池溢出上限 |
| `DB_POOL_TIMEOUT` | `30` | 获取连接超时（秒） |

### 2.2 配置实现（config.py）

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 优先使用完整 DSN；若未设置，从分项变量组装
    database_url: str | None = None
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "ht"
    db_user: str = "postgres"
    db_password: str = "postgres"

    host: str = "0.0.0.0"
    port: int = 8000
    default_download_root: str | None = None

    # 连接池参数
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
```

### 2.3 连接池配置（db.py）

```python
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

engine = create_async_engine(
    settings.db_url,
    echo=False,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    pool_pre_ping=True,
    # 开发/测试环境可设 poolclass=NullPool 禁用连接池
)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        yield session


async def check_db_connection() -> bool:
    """检查数据库连通性，返回是否可用。"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def init_db() -> None:
    from app.models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

---

## 3. init_db 新实现

### 3.1 启动流程变更（main.py）

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()

    # 1. 先检查数据库连通性
    from app.db import check_db_connection
    if not await check_db_connection():
        logger.error("Database connection failed — service unavailable")
        # 不阻塞启动，但标记为不健康；后续请求会 503
        app.state.db_available = False
    else:
        app.state.db_available = True
        await init_db()
        await _init_default_categories()

    worker_task = asyncio.create_task(download_worker())
    scheduler_task = await init_scheduler()
    yield
    worker_task.cancel()
    scheduler_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
```

### 3.2 健康检查端点（main.py）

```python
@app.get("/api/health")
async def health():
    from app.db import check_db_connection
    db_ok = await check_db_connection()
    if not db_ok:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        )
    return {"status": "ok", "database": "connected"}
```

### 3.3 数据库不可用时的 503 处理

方案：在 lifespan 中即使数据库不可用也继续启动（让静态文件服务可用），但 API 请求通过依赖注入的 `get_db` 抛出 503。

```python
async def get_db() -> AsyncSession:
    try:
        async with async_session_factory() as session:
            yield session
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        ) from exc
```

> **决策说明**：选择"启动不阻塞 + 请求时 503"而非"启动失败退出"，原因是：
> 1. 静态文件服务（前端 SPA）仍可正常访问
> 2. 用户能看到前端界面和友好的错误提示
> 3. 数据库恢复后无需重启服务，自动恢复

---

## 4. 模型兼容性分析

### 4.1 JSON → JSONB 自动映射

SQLAlchemy 2.0 的 `JSON` 类型在 PostgreSQL 中自动映射为 `JSONB`，无需手动调整。

验证：
```python
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

# 以下两种写法在 PostgreSQL 中等价
# 1. 通用写法（推荐，跨数据库兼容）
column = mapped_column(JSON, nullable=True)
# 2. PostgreSQL 专用写法
# column = mapped_column(JSONB, nullable=True)
```

但为了显式控制和确保行为一致，建议在 `Base` 类中配置 `type_annotation_map`：

```python
from typing import Optional
from sqlalchemy import JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {
        dict: JSON,
        list: JSON,
    }
```

### 4.2 字段兼容性矩阵

| 字段类型 | SQLite 行为 | PostgreSQL 行为 | 是否需要调整 |
|---|---|---|---|
| `Integer, primary_key=True, autoincrement=True` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL` / `GENERATED ALWAYS AS IDENTITY` | 否，SQLAlchemy 自动处理 |
| `Boolean` | `INTEGER` (0/1) | `BOOLEAN` | 否，SQLAlchemy 自动转换 |
| `DateTime` | `DATETIME` | `TIMESTAMP` | 否，SQLAlchemy 自动处理 |
| `String` | `VARCHAR` | `VARCHAR` | 否 |
| `Text` | `TEXT` | `TEXT` | 否 |
| `JSON` | `JSON` | `JSONB` | 否，自动映射 |
| `ForeignKey` | 外键约束 | 外键约束 | 否 |
| `Index` | B-tree | B-tree | 否 |
| `UniqueConstraint` | 唯一约束 | 唯一约束 | 否 |

### 4.3 需要关注的差异

#### 4.3.1 `source_updated_at` 字符串排序

`VideoCache.source_updated_at` 和 `AggregatedVideo*.latest_updated_at` 是 `String` 类型，存储 ISO 格式时间字符串。在 PostgreSQL 中字符串排序与 SQLite 一致（字典序），无需调整。

#### 4.3.2 `func.count()` 返回值

PostgreSQL 中 `func.count()` 返回 `BIGINT`（Python `int`），SQLite 返回 `int`。代码中已使用 `int(r.detail_cnt or 0)` 转换，兼容。

#### 4.3.3 `case()` 表达式

`crawler.py` 中使用 `func.sum(case((VideoCache.has_detail.is_(True), 1), else_=0))`，在 PostgreSQL 中 `has_detail.is_(True)` 正确解析为布尔比较，无需调整。

#### 4.3.4 `DateTime` 时区处理

当前代码中 `datetime.now(timezone.utc)` 生成带时区的 datetime，但存储到 `DateTime` 列时 SQLAlchemy 会去掉时区信息。PostgreSQL 的 `TIMESTAMP`（无时区）与 SQLite 的 `DATETIME` 行为一致。如需保留时区，应改用 `DateTime(timezone=True)`，但当前行为已满足需求，**不调整**。

### 4.4 模型文件变更（models.py）

```python
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {
        dict: JSON,
        list: JSON,
    }


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ... 以下模型定义不变 ...
```

---

## 5. SQLite 专用代码清理清单

### 5.1 删除项

| 位置 | 内容 | 处理方式 |
|---|---|---|
| `db.py:25` | `await conn.execute(text("PRAGMA journal_mode=WAL"))` | 删除 |
| `db.py:26` | `await conn.execute(text("PRAGMA busy_timeout=30000"))` | 删除 |
| `db.py:29` | `await _ensure_columns(conn)` | 删除 |
| `db.py:32-66` | `_ensure_columns` 函数定义 | 删除 |
| `db.py:9` | `connect_args={"timeout": 30.0}` | 删除（PostgreSQL 无此参数） |
| `config.py:12` | `db_path: str = "data/app.db"` | 删除 |
| `config.py:17-19` | `db_url` property 中的 SQLite 硬编码 | 重写为 PostgreSQL DSN |
| `crawler.py:20` | `from sqlalchemy.dialects.sqlite import insert as sqlite_insert` | 改为 `from sqlalchemy.dialects.postgresql import insert as pg_insert` |
| `videos.py:9` | `from sqlalchemy.dialects.sqlite import insert` | 改为 `from sqlalchemy.dialects.postgresql import insert as pg_insert` |

### 5.2 upsert 语法变更

SQLite 和 PostgreSQL 的 `on_conflict_do_update` 语法在 SQLAlchemy 中 API 相同，只需更换导入：

```python
# 变更前（SQLite）
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

stmt = sqlite_insert(VideoCache).values(**entry)
stmt = stmt.on_conflict_do_update(
    index_elements=["site_id", "original_id"],
    set_={...},
)

# 变更后（PostgreSQL）
from sqlalchemy.dialects.postgresql import insert as pg_insert

stmt = pg_insert(VideoCache).values(**entry)
stmt = stmt.on_conflict_do_update(
    index_elements=["site_id", "original_id"],
    set_={...},
)
```

> **注意**：PostgreSQL 的 `on_conflict_do_update` 要求 `index_elements` 对应唯一约束或唯一索引。当前 `VideoCache` 表有 `UniqueConstraint("site_id", "original_id", name="uix_video_cache")`，满足条件。`AppConfig` 表以 `key` 为主键，也满足条件。

---

## 6. 部署注意事项

### 6.1 PostgreSQL 初始化

#### 6.1.1 Docker 快速启动（开发环境）

```bash
docker run -d \
  --name ht-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ht \
  -p 5432:5432 \
  -v ht_pg_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

#### 6.1.2 手动初始化（生产环境）

```sql
-- 创建数据库
CREATE DATABASE ht;

-- 创建用户（如不使用默认 postgres）
CREATE USER ht_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ht TO ht_user;

-- 连接 ht 数据库后，授予 schema 权限
\c ht
GRANT ALL ON SCHEMA public TO ht_user;
```

### 6.2 环境变量配置示例（.env）

```bash
# 方式一：完整 DSN（推荐）
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/ht

# 方式二：分项配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ht
DB_USER=postgres
DB_PASSWORD=postgres
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10

# 其他配置
HOST=0.0.0.0
PORT=8181
```

### 6.3 数据迁移（SQLite → PostgreSQL）

本方案为**引擎替换**而非**在线迁移**。首次切换到 PostgreSQL 时：

1. 启动服务，`Base.metadata.create_all` 自动建表
2. 系统分类、站点配置需重新配置（或编写一次性迁移脚本）
3. 刮削数据从空开始，首次全量刮削自动触发

如需保留历史数据，可使用 `pgloader` 或 Python 脚本迁移：

```bash
# 使用 pgloader（需安装）
pgloader sqlite:///path/to/app.db postgresql://postgres:postgres@localhost/ht
```

> **决策说明**：不内置自动迁移逻辑。原因：
> 1. 刮削数据可从资源站重新获取（全量刮削 20-40 分钟）
> 2. 站点配置、分类映射等配置数据量小，手动重新配置成本可控
> 3. 迁移脚本增加复杂度，且是一次性代码

---

## 7. 回滚策略

### 7.1 代码回滚

所有变更集中在以下文件，回滚时恢复这些文件即可：

- `backend/pyproject.toml`
- `backend/app/config.py`
- `backend/app/db.py`
- `backend/app/models.py`
- `backend/app/main.py`
- `backend/app/api/videos.py`
- `backend/app/services/crawler.py`

### 7.2 数据回滚

PostgreSQL 和 SQLite 数据互不干扰：

1. 回滚代码后，服务自动连接回 `data/app.db`
2. 原 SQLite 数据库文件未被修改，数据完整保留
3. 无需数据迁移操作

### 7.3 快速回滚检查清单

```bash
# 1. 恢复代码（git）
git checkout -- backend/pyproject.toml backend/app/config.py backend/app/db.py backend/app/models.py backend/app/main.py backend/app/api/videos.py backend/app/services/crawler.py

# 2. 重新安装依赖
pip install -e ./backend

# 3. 重启服务
# SQLite 数据库文件 data/app.db 自动恢复使用
```

---

## 8. 性能预期

| 指标 | SQLite | PostgreSQL | 备注 |
|---|---|---|---|
| 首页聚合查询 | ~26ms（预聚合缓存） | ~20ms | 预聚合缓存机制保留 |
| 连接建立 | ~10ms | ~15ms | 连接池复用后忽略 |
| 批量写入（500条） | ~200ms | ~100ms | PostgreSQL 写入并发更优 |
| 全量刮削（25站） | 20-40分钟 | 15-30分钟 | 站点并发可从 2 提升到 6 |
| 并发连接数 | 1（串行写入） | pool_size + max_overflow | 刮削可提升并发 |

---

## 9. 风险点

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| `on_conflict_do_update` 在 PostgreSQL 中行为差异 | upsert 失败 | 低 | 测试所有 upsert 路径（crawler.py 4处 + videos.py 1处） |
| JSONB 查询语法与 JSON 不同 | 未来如用 JSONB 运算符需调整 | 低 | 当前只用 JSON 存储/读取，无查询操作 |
| 连接池耗尽 | 请求超时 | 低 | pool_size=5, max_overflow=10；监控连接数 |
| 数据库不可用时静态文件也 503 | 前端白屏 | 低 | lifespan 中不阻塞启动，get_db 异常才 503 |
| autoincrement 主键冲突 | 插入失败 | 极低 | SQLAlchemy 自动处理 SERIAL |
