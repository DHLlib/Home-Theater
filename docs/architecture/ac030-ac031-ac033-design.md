> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# AC-030 / AC-031 / AC-033: PostgreSQL 特性统一设计方案

## 1. 背景与目标

当前系统使用 SQLite + 双缓冲预聚合表（`aggregated_videos_v1` / `v2`）解决首页聚合查询性能问题。迁移至 PostgreSQL 后，需充分利用其原生特性：

- **AC-030**：全文搜索（Full-Text Search）替代 LIKE 模糊查询
- **AC-031**：物化视图（Materialized View）替代双缓冲预聚合表
- **AC-033**：JSONB 操作符优化 sources 字段查询

三者共享同一数据模型变更，统一设计以避免重复迁移。

---

## 2. AC-030: 全文搜索设计

### 2.1 新增列

```sql
ALTER TABLE video_cache ADD COLUMN search_vector tsvector;
```

`search_vector` 不映射到 SQLAlchemy 模型字段（纯数据库层维护），或通过 `mapped_column(TSVECTOR)` 声明但由触发器写入、应用层不直接操作。

### 2.2 GIN 索引

```sql
CREATE INDEX idx_video_search ON video_cache USING GIN(search_vector);
```

### 2.3 触发器（自动维护 search_vector）

```sql
-- 辅助函数：将 title/actors/director 合并为 tsvector
CREATE OR REPLACE FUNCTION video_cache_search_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('chinese', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('chinese', COALESCE(NEW.actors, '')), 'B') ||
        setweight(to_tsvector('chinese', COALESCE(NEW.director, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- INSERT / UPDATE 触发器
DROP TRIGGER IF EXISTS trg_video_cache_search ON video_cache;
CREATE TRIGGER trg_video_cache_search
    BEFORE INSERT OR UPDATE OF title, actors, director
    ON video_cache
    FOR EACH ROW
    EXECUTE FUNCTION video_cache_search_update();
```

> **权重说明**：title 权重 A（最高），actors 权重 B，director 权重 C。搜索排序时可用 `ts_rank` 按权重加权计分。

### 2.4 现有数据回填

```sql
UPDATE video_cache SET search_vector =
    setweight(to_tsvector('chinese', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('chinese', COALESCE(actors, '')), 'B') ||
    setweight(to_tsvector('chinese', COALESCE(director, '')), 'C');
```

### 2.5 搜索 API 查询改写

**原 SQLite 查询（LIKE 模式）**：

```python
# 原实现：多字段 OR + LIKE，无法利用索引
query = query.filter(
    or_(
        VideoCache.title.ilike(f"%{keyword}%"),
        VideoCache.actors.ilike(f"%{keyword}%"),
        VideoCache.director.ilike(f"%{keyword}%"),
    )
)
```

**新 PostgreSQL 查询（tsvector）**：

```python
from sqlalchemy import text, func
from sqlalchemy.dialects.postgresql import TSVECTOR

# 方案 A：plainto_tsquery（推荐，自动处理短语分词）
search_query = func.plainto_tsquery('chinese', keyword)
query = query.filter(
    VideoCache.search_vector.op('@@')(search_query)
).order_by(
    func.ts_rank(VideoCache.search_vector, search_query).desc()
)

# 方案 B：降级 simple（chinese 词典未安装时）
search_query = func.plainto_tsquery('simple', keyword)
query = query.filter(
    VideoCache.search_vector.op('@@')(search_query)
)
```

**运行时词典检测（启动时执行一次）**：

```python
async def _check_chinese_dict_available(db: AsyncSession) -> bool:
    result = await db.execute(text(
        "SELECT EXISTS (SELECT 1 FROM pg_ts_dict WHERE dictname = 'chinese')"
    ))
    return result.scalar()

# 缓存到 AppConfig: key="fts_dict", value="chinese" | "simple"
```

### 2.6 与现有搜索的兼容

- 保留 `wd=` 参数语义不变
- 当 PostgreSQL 不可用时（测试环境），回退到 `title ILIKE`（单字段）
- 搜索返回结构不变：仍返回 `AggregatedVideo` 列表

---

## 3. AC-031: 物化视图预聚合设计

### 3.1 移除双缓冲表

```sql
DROP TABLE IF EXISTS aggregated_videos_v1;
DROP TABLE IF EXISTS aggregated_videos_v2;
```

对应模型类 `AggregatedVideoV1` / `AggregatedVideoV2` 从 `models.py` 中删除。

### 3.2 创建物化视图

```sql
CREATE MATERIALIZED VIEW mv_aggregated_videos AS
WITH normalized AS (
    SELECT
        id,
        site_id,
        original_id,
        title,
        year,
        poster_url,
        source_updated_at,
        cached_at,
        -- 标题规范化：去空格、转小写
        lower(regexp_replace(trim(title), '\s+', '', 'g')) AS norm_title
    FROM video_cache
),
year_filled AS (
    SELECT
        n.*,
        COALESCE(
            n.year,
            -- 对 year=NULL 的记录，回填同名最频繁的非 NULL year
            (
                SELECT mode() WITHIN GROUP (ORDER BY year)
                FROM normalized
                WHERE norm_title = n.norm_title AND year IS NOT NULL
            )
        ) AS filled_year
    FROM normalized n
)
SELECT
    -- 使用 norm_title + filled_year 作为聚合键的伪主键
    -- 实际唯一索引建在 (norm_title, filled_year) 上
    MIN(id) AS id,
    MAX(title) AS title,
    filled_year AS year,
    MAX(poster_url) AS poster_url,
    -- sources: JSONB 数组，每项包含来源信息
    jsonb_agg(
        jsonb_build_object(
            'site_id', site_id,
            'original_id', original_id,
            'source_updated_at', source_updated_at,
            'cached_at', cached_at
        ) ORDER BY cached_at DESC
    ) AS sources,
    MAX(source_updated_at) AS latest_updated_at,
    COUNT(*) AS source_count
FROM year_filled
GROUP BY norm_title, filled_year;
```

> **说明**：
> - `mode() WITHIN GROUP` 取众数，即同名记录中出现最频繁的年份
> - `jsonb_agg` 生成 JSONB 数组，比 JSON 更紧凑且支持索引
> - `MIN(id)` 作为代理主键，仅用于 ORM 映射兼容性

### 3.3 唯一索引（CONCURRENTLY 刷新必需）

```sql
-- 物化视图上的唯一索引是 REFRESH CONCURRENTLY 的前提
CREATE UNIQUE INDEX idx_mv_agg_unique
    ON mv_aggregated_videos (lower(regexp_replace(trim(title), '\s+', '', 'g')), COALESCE(year, 0));

-- 辅助索引：按 source_count 排序（首页热门）
CREATE INDEX idx_mv_agg_count ON mv_aggregated_videos (source_count DESC);

-- 辅助索引：按 latest_updated_at 排序（最近更新）
CREATE INDEX idx_mv_agg_updated ON mv_aggregated_videos (latest_updated_at DESC);
```

> **注意**：唯一索引列必须与物化视图的 GROUP BY 键一一对应。这里用 `COALESCE(year, 0)` 处理 NULL year（回填后理论上不应有 NULL，但防御性保留）。

### 3.4 刷新机制

**刷新 SQL**：

```sql
-- 不阻塞读（需要唯一索引支持）
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_aggregated_videos;
```

**刷新时机**：

| 场景 | 行为 |
|------|------|
| 全量刮削完成 | 自动触发 REFRESH CONCURRENTLY |
| 增量刮削完成 | 自动触发 REFRESH CONCURRENTLY |
| 手动触发 | 保留 `POST /api/videos/crawler/refresh-aggregated` 接口 |

**Python 封装**：

```python
async def refresh_aggregated_view(db: AsyncSession) -> None:
    """刷新物化视图，使用 CONCURRENTLY 避免锁表。"""
    await db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_aggregated_videos"))
    await db.commit()
```

**防抖动**：

```python
# 在 crawler.py 中，增量更新批次完成后统一刷新一次，而非每页刷新
# 全量刮削：每完成一个站点后刷新（或全部完成后一次性刷新）
_last_refresh_time: float = 0
_MIN_REFRESH_INTERVAL: float = 60.0  # 最短 60 秒

async def _maybe_refresh_view(db: AsyncSession) -> None:
    global _last_refresh_time
    now = asyncio.get_event_loop().time()
    if now - _last_refresh_time >= _MIN_REFRESH_INTERVAL:
        await refresh_aggregated_view(db)
        _last_refresh_time = now
```

### 3.5 ORM 映射

```python
from sqlalchemy import Integer, String, DateTime, JSON
from sqlalchemy.orm import mapped_column

class AggregatedVideo(Base):
    """物化视图的 ORM 映射（只读）。"""
    __tablename__ = "mv_aggregated_videos"

    id = mapped_column(Integer, primary_key=True)
    title = mapped_column(String, nullable=False)
    year = mapped_column(Integer, nullable=True)
    poster_url = mapped_column(String, nullable=True)
    sources = mapped_column(JSON, default=list)  # PostgreSQL 自动为 JSONB
    latest_updated_at = mapped_column(String, nullable=True)
    source_count = mapped_column(Integer, default=1, nullable=False)
    # cached_at 从物化视图中移除（无意义），如需时间戳可用 MAX(cached_at)
```

> **注意**：物化视图是只读的，ORM 映射仅用于查询。不要对其执行 INSERT/UPDATE/DELETE。

---

## 4. AC-033: JSONB 优化设计

### 4.1 JSONB 自动生效

SQLAlchemy 的 `mapped_column(JSON)` 在 PostgreSQL 方言下自动映射为 `JSONB`，无需额外配置。

### 4.2 JSONB 查询示例

#### 4.2.1 过滤包含特定 site_id 的 sources（`@>` 操作符）

```python
from sqlalchemy import text

# 查询 sources 中包含 site_id=1 的聚合视频
query = select(AggregatedVideo).where(
    AggregatedVideo.sources.op('@>')(text("'[{"""site_id""": 1}]'"))
)
```

**使用场景**：详情页需要知道某视频在特定站点是否有源时，可先查物化视图做快速过滤。

#### 4.2.2 提取嵌套字段（`->>` 操作符）

```python
# 提取 sources 第一个元素的 site_id（SQL 层面）
query = select(
    AggregatedVideo.title,
    func.jsonb_path_query_first(
        AggregatedVideo.sources,
        text("'$[0].site_id'")
    ).label("first_site_id")
)
```

#### 4.2.3 在物化视图上创建 JSONB GIN 索引（可选）

```sql
-- 如果频繁按 site_id 过滤 sources，可建 GIN 索引
CREATE INDEX idx_mv_agg_sources_gin ON mv_aggregated_videos USING GIN (sources jsonb_path_ops);
```

> **建议**：初期不建此索引，待实际查询模式明确后再评估。JSONB GIN 索引写入成本高。

### 4.3 与现有代码的衔接

当前 `sources` 字段结构（从 v1/v2 表继承）：

```json
[
  {
    "site_id": 1,
    "original_id": "12345",
    "source_updated_at": "2024-01-15 10:30:00",
    "cached_at": "2024-01-15T10:30:00"
  }
]
```

迁移到 JSONB 后结构不变，Python 层反序列化逻辑不变（SQLAlchemy 自动处理）。

---

## 5. 模型变更汇总

### 5.1 models.py 变更

```python
# === 删除 ===
class AggregatedVideoV1(Base):   # 删除整个类
class AggregatedVideoV2(Base):   # 删除整个类

# === 修改 ===
class VideoCache(Base):
    # ... 现有字段不变 ...

    # 新增：tsvector 字段（可选映射，触发器维护）
    search_vector = mapped_column(
        TSVECTOR,
        nullable=True,
        doc="PostgreSQL 全文搜索向量，由触发器自动维护"
    )

class AggregatedVideo(Base):
    """物化视图 mv_aggregated_videos 的只读 ORM 映射。"""
    __tablename__ = "mv_aggregated_videos"

    id = mapped_column(Integer, primary_key=True)
    title = mapped_column(String, nullable=False)
    year = mapped_column(Integer, nullable=True)
    poster_url = mapped_column(String, nullable=True)
    sources = mapped_column(JSON, default=list)  # PostgreSQL -> JSONB
    latest_updated_at = mapped_column(String, nullable=True)
    source_count = mapped_column(Integer, default=1, nullable=False)
```

### 5.2 新增导入

```python
from sqlalchemy.dialects.postgresql import TSVECTOR
```

### 5.3 删除的代码

- `AppConfig key="aggregated_active_version"` 及相关切换逻辑
- `_refresh_aggregated_cache()` 双缓冲写入逻辑
- `aggregated_videos_v1` / `v2` 表的 CREATE TABLE 语句

---

## 6. 实现顺序建议

```
Phase 1: 基础迁移
  1.1 确认 PostgreSQL 连接配置（asyncpg / psycopg）
  1.2 修改 models.py：删除 V1/V2，新增 search_vector，修改 AggregatedVideo
  1.3 运行 Alembic 迁移（或 Base.metadata.create_all）生成新表结构
  1.4 验证 VideoCache 表正常读写

Phase 2: AC-030 全文搜索
  2.1 执行触发器 SQL + GIN 索引创建
  2.2 回填现有数据 search_vector
  2.3 修改搜索 API：添加 tsvector 查询分支
  2.4 添加词典检测逻辑（chinese vs simple）
  2.5 验证搜索排序质量

Phase 3: AC-031 物化视图
  3.1 执行物化视图 CREATE MATERIALIZED VIEW SQL
  3.2 创建唯一索引 + 辅助索引
  3.3 修改首页查询路由：读 mv_aggregated_videos
  3.4 修改刮削完成回调：触发 REFRESH CONCURRENTLY
  3.5 删除旧双缓冲代码
  3.6 验证首页查询性能

Phase 4: AC-033 JSONB 优化
  4.1 验证 sources 字段自动为 JSONB（\d mv_aggregated_videos）
  4.2 在需要的地方使用 @> / ->> 操作符优化查询
  4.3 按需添加 GIN 索引

Phase 5: 清理与验证
  5.1 删除 aggregated_videos_v1 / v2 表（确认无误后）
  5.2 运行全量测试：搜索、首页、详情、刮削
  5.3 性能基准测试：对比 SQLite 方案
```

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `pg_trgm` / `zhparser` 中文词典未安装 | 全文搜索无法使用 `chinese` 配置 | 启动时检测，自动降级 `simple`；文档中标注安装命令 |
| 物化视图 REFRESH CONCURRENTLY 需要唯一索引 | 刷新失败或锁表 | 确保唯一索引列与 GROUP BY 完全对应；首次刷新用普通 REFRESH |
| 物化视图刷新耗时过长（数据量大时） | 刮削完成后卡顿 | 异步刷新（后台任务）；设置最小刷新间隔 60s；监控刷新耗时 |
| JSONB 写入性能低于 JSON | 刮削批量插入变慢 | 物化视图的 JSONB 由数据库生成（jsonb_agg），非应用层写入；VideoCache 的 play_url_raw 等大字段仍用 TEXT |
| 迁移期间数据丢失 | 生产数据（如有）丢失 | 先备份；使用 Alembic 迁移脚本；双缓冲表延迟删除 |
| ORM 对物化视图的支持有限 | 某些 SQLAlchemy 特性不可用 | 物化视图仅用于查询，不映射关系；避免 cascade、backref |
| `mode() WITHIN GROUP` 在旧版 PG 不支持 | year 回填逻辑失效 | 要求 PostgreSQL >= 9.4（mode() 支持）；或改用子查询 COUNT 取众数 |

---

## 8. 附录：一键部署 SQL

```sql
-- ============================================================
-- AC-030 + AC-031 + AC-033 统一部署脚本
-- 在 PostgreSQL 中执行（已创建 video_cache 表后）
-- ============================================================

-- AC-030: 全文搜索
-- -----------------------------------------------------------
ALTER TABLE video_cache ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_video_search ON video_cache USING GIN(search_vector);

CREATE OR REPLACE FUNCTION video_cache_search_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('chinese', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('chinese', COALESCE(NEW.actors, '')), 'B') ||
        setweight(to_tsvector('chinese', COALESCE(NEW.director, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_video_cache_search ON video_cache;
CREATE TRIGGER trg_video_cache_search
    BEFORE INSERT OR UPDATE OF title, actors, director
    ON video_cache
    FOR EACH ROW
    EXECUTE FUNCTION video_cache_search_update();

-- 回填现有数据
UPDATE video_cache SET search_vector =
    setweight(to_tsvector('chinese', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('chinese', COALESCE(actors, '')), 'B') ||
    setweight(to_tsvector('chinese', COALESCE(director, '')), 'C');

-- AC-031: 物化视图（先清理旧表）
-- -----------------------------------------------------------
DROP TABLE IF EXISTS aggregated_videos_v1;
DROP TABLE IF EXISTS aggregated_videos_v2;

DROP MATERIALIZED VIEW IF EXISTS mv_aggregated_videos;

CREATE MATERIALIZED VIEW mv_aggregated_videos AS
WITH normalized AS (
    SELECT
        id,
        site_id,
        original_id,
        title,
        year,
        poster_url,
        source_updated_at,
        cached_at,
        lower(regexp_replace(trim(title), '\s+', '', 'g')) AS norm_title
    FROM video_cache
),
year_filled AS (
    SELECT
        n.*,
        COALESCE(
            n.year,
            (SELECT mode() WITHIN GROUP (ORDER BY year)
             FROM normalized
             WHERE norm_title = n.norm_title AND year IS NOT NULL)
        ) AS filled_year
    FROM normalized n
)
SELECT
    MIN(id) AS id,
    MAX(title) AS title,
    filled_year AS year,
    MAX(poster_url) AS poster_url,
    jsonb_agg(
        jsonb_build_object(
            'site_id', site_id,
            'original_id', original_id,
            'source_updated_at', source_updated_at,
            'cached_at', cached_at
        ) ORDER BY cached_at DESC
    ) AS sources,
    MAX(source_updated_at) AS latest_updated_at,
    COUNT(*) AS source_count
FROM year_filled
GROUP BY norm_title, filled_year;

-- 唯一索引（CONCURRENTLY 刷新必需）
CREATE UNIQUE INDEX idx_mv_agg_unique
    ON mv_aggregated_videos (lower(regexp_replace(trim(title), '\s+', '', 'g')), COALESCE(year, 0));

CREATE INDEX idx_mv_agg_count ON mv_aggregated_videos (source_count DESC);
CREATE INDEX idx_mv_agg_updated ON mv_aggregated_videos (latest_updated_at DESC);

-- AC-033: JSONB GIN 索引（可选，按需启用）
-- -----------------------------------------------------------
-- CREATE INDEX idx_mv_agg_sources_gin ON mv_aggregated_videos USING GIN (sources jsonb_path_ops);
```

---

## 9. 性能预期

| 指标 | SQLite（当前） | PostgreSQL（目标） |
|------|---------------|-------------------|
| 首页聚合查询 | ~26ms（预聚合表） | ~10-20ms（物化视图） |
| 全文搜索 | 无（LIKE 全表扫） | <50ms（GIN 索引） |
| 刮削批量写入 | 500 条/batch | 1000-2000 条/batch（COPY 或批量 INSERT） |
| 并发读取 | WAL 模式串行写 | 真正读写并发 |
