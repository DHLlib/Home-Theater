> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# Code Review Report: AC-033 JSONB 查询优化

**审查日期**: 2026-06-09
**审查范围**: `backend/app/api/videos.py`, `backend/app/services/resolver.py`
**审查人**: Claude Code Reviewer

---

## 1. 变更摘要

AC-033 在 `_query_aggregated_cache()`、`list_videos()`、`video_detail()` 中添加了可选 `site_id` 参数，支持在数据库层面（PostgreSQL JSONB）或 Python 层面（SQLite）按站点过滤 `sources`。

---

## 2. 逐项审查

### 2.1 JSONB 操作符使用（PostgreSQL 路径）

**代码位置**: `backend/app/api/videos.py:345-351`

```python
jsonb_filter = text(f"'[{{\"site_id\": {site_id}}}]'")
count_query = count_query.where(
    AggregatedVideoModel.sources.op("@>")(jsonb_filter)
)
```

**审查结论**: **WARNING**

`@>` 是 PostgreSQL JSONB 的「包含」操作符，语义上要求左操作数（字段值）包含右操作数（查询值）。此处右操作数 `'[{"site_id": N}]'` 是一个 JSON 数组，而 `sources` 字段存储的也是一个 JSON 数组（元素为 `{"site_id": ..., "original_id": ...}` 对象）。

**问题**: `@>` 对 JSON 数组的包含语义是「左数组包含右数组的全部元素」，而不是「左数组中某个元素包含右对象的键值对」。

具体而言：
- `sources` = `[{"site_id": 1, "original_id": "abc"}]`
- 查询值 = `[{"site_id": 1}]`

`@>` 比较的是数组元素级别的包含：`{"site_id": 1, "original_id": "abc"}` 是否包含 `{"site_id": 1}`？对于 JSONB 对象，`@>` 确实支持「对象包含」语义——即左对象的键值对是右对象的超集。因此 `"{\"a\":1,\"b\":2}"::jsonb @> "{\"a\":1}"::jsonb` 返回 `true`。

**但是**，数组层面的 `@>` 要求右数组的每个元素都能在左数组中找到「被包含」的对应元素。`[{"site_id": 1, "original_id": "abc"}] @> [{"site_id": 1}]` 在 PostgreSQL 中确实返回 `true`，因为数组元素 `{"site_id": 1, "original_id": "abc"}` 包含 `{"site_id": 1}`。

**然而**，这种写法依赖于 JSONB 对象的超集语义，且右操作数被包装为单元素数组 `[{"site_id": N}]`。如果 `sources` 字段中存储的对象不包含 `site_id` 键（理论上不应发生），或 `site_id` 类型不匹配（整数 vs 字符串），过滤会失败。

**更稳健的做法**是使用 `jsonb_path_exists` 或确保 GIN 索引支持 `@>`：

```sql
-- 更明确的写法（需要 PostgreSQL 12+）
jsonb_path_exists(sources, '$[*] ? (@.site_id == $sid)', '{"sid": 1}')
```

但考虑到兼容性和现有代码风格，当前 `@>` 写法在功能上是正确的，只是语义略晦涩。

**建议**: 在 `sources` 字段上添加 GIN 索引以支持 `@>` 操作符的高效执行：

```sql
CREATE INDEX ix_mv_aggregated_videos_sources_gin ON mv_aggregated_videos USING GIN (sources);
```

否则每次查询都会做全表顺序扫描 + 逐行 JSONB 解析，性能反而比 Python 端过滤更差。

---

### 2.2 双路径处理（SQLite / PostgreSQL）

**代码位置**: `backend/app/api/videos.py:324-422`

**审查结论**: **INFO**

- **PostgreSQL 路径**: 使用 `@>` 在数据库端过滤，然后 Python 端做二次确认（`_filter_sources_by_site_id`），双重保险，合理。
- **SQLite 路径**: 完全在 Python 端过滤，不尝试用 SQLite 的 JSON 函数（`json_extract` 等），这是正确的——SQLite 的 JSON1 扩展在 `aiosqlite` 环境下不一定可用，且预聚合表数据量不大（已分页到每页 20 条），Python 端过滤开销可忽略。

**一个小问题**: PostgreSQL 路径中，`count_query` 和 `query` 都加了 `where` 条件，但 `count == 0` 时返回 `None` 触发 fallback。这个逻辑在 `site_id` 过滤下可能产生误导——返回 `None` 可能是因为活跃版本表为空，也可能是因为没有匹配 `site_id` 的记录。调用方 `list_videos` 会把 `None` 当作「预聚合表未初始化」而 fallback 到实时聚合路径，这是预期行为。

---

### 2.3 `site_id` 参数可选性

**代码位置**: `backend/app/api/videos.py:451`, `backend/app/api/videos.py:581`

**审查结论**: **INFO**

- `list_videos()` 中 `site_id: int | None = None`，默认 `None`，不影响现有 API 契约。
- `video_detail()` 中 `site_id: int | None = None`，默认 `None`，不影响现有 API 契约。

两处参数签名均正确，向后兼容。

---

### 2.4 查询性能

**审查结论**: **WARNING**

**PostgreSQL 路径的性能隐患**:

1. **缺少 GIN 索引**: `mv_aggregated_videos` 物化视图的 `sources` 字段如果没有 GIN 索引，`@>` 操作符将退化为全表扫描 + 逐行 JSONB 解析。预聚合表的数据量可能达到数万到数十万条，这种扫描成本不可忽略。

2. **物化视图未刷新**: `mv_aggregated_videos` 是物化视图，如果数据已变更但未 `REFRESH MATERIALIZED VIEW`，查询结果会过期。这是现有架构已知的问题，与 AC-033 无关，但需注意。

**SQLite 路径的性能**:

SQLite 路径先取分页后的记录（最多 20 条），再在 Python 端过滤 `sources`，每条记录的 `sources` 通常只有 1-5 个元素。时间复杂度 O(per_page * avg_sources_per_video)，完全可以忽略。

---

### 2.5 SQL 注入风险

**代码位置**: `backend/app/api/videos.py:345`

**审查结论**: **CRITICAL**

```python
jsonb_filter = text(f"'[{{\"site_id\": {site_id}}}]'")
```

**存在 SQL 注入风险**。

`site_id` 虽然是 `int | None` 类型，但 FastAPI 的类型校验只能保证传入值是整数类型。如果攻击者通过某种方式（如直接构造请求）传入非整数值，或更关键的是——`site_id` 参数通过 `text()` 直接拼接到 SQL 中，没有使用参数绑定。

虽然 `site_id` 被声明为 `int`，FastAPI 会尝试将其转换为整数，转换失败会返回 422。但如果传入一个精心构造的值（例如通过直接调用底层函数绕过 FastAPI 校验），`text()` 会直接将其嵌入 SQL。

**更安全的写法**应使用 SQLAlchemy 的 `bindparam` 或类型安全的构造方式：

```python
from sqlalchemy import bindparam, type_coerce
from sqlalchemy.dialects.postgresql import JSONB

# 方案 1：使用 bindparam
jsonb_filter = bindparam('filter_val', value=[{"site_id": site_id}], type_=JSONB)
count_query = count_query.where(
    AggregatedVideoModel.sources.op("@>")(jsonb_filter)
)

# 方案 2：使用 cast
count_query = count_query.where(
    AggregatedVideoModel.sources.op("@>")(
        func.cast(f'[{{"site_id": {site_id}}}]', JSONB)
    )
)
```

实际上，由于 `site_id` 是 `int` 类型且 FastAPI 已做类型校验，实际利用难度较高。但**安全原则是不信任任何外部输入**，即使已做类型校验，也应使用参数化查询。

**建议**: 将 `text()` 替换为参数化绑定方式。

---

### 2.6 `video_detail()` 中 `site_id` 的使用

**代码位置**: `backend/app/api/videos.py:578-601`

**审查结论**: **INFO**

```python
# AC-033: 如有 site_id 过滤需求，在查询层面过滤
if site_id is not None:
    cache_q = cache_q.where(VideoCache.site_id == site_id)

# AC-033: 对传入的 sources 也支持按 site_id 过滤
sources = _filter_sources_by_site_id(sources, site_id)
```

- 当 `req.sources` 为空时，通过 `title+year` 查 `VideoCache`，此时在查询层面用 `VideoCache.site_id == site_id` 过滤，正确。
- 当 `req.sources` 非空时，用 `_filter_sources_by_site_id()` 在 Python 端过滤，正确。
- 双重过滤逻辑清晰，没有遗漏。

---

### 2.7 `_filter_sources_by_site_id()` 函数

**代码位置**: `backend/app/api/videos.py:429-433`

**审查结论**: **INFO**

```python
def _filter_sources_by_site_id(sources: list[SourceRef], site_id: int | None) -> list[SourceRef]:
    if site_id is None:
        return sources
    return [s for s in sources if s.site_id == site_id]
```

- 函数职责单一，逻辑清晰。
- `site_id is None` 时短路返回，避免不必要的列表推导。
- 类型签名正确。

---

## 3. 评分

| 维度 | 得分 | 说明 |
|------|------|------|
| 功能正确性 | 8/10 | `@>` 语义正确，但依赖 JSONB 对象超集语义，略显晦涩 |
| 安全性 | 5/10 | `text()` 拼接存在 SQL 注入风险（虽利用难度高） |
| 性能 | 6/10 | PostgreSQL 路径缺少 GIN 索引，可能退化为全表扫描 |
| 代码质量 | 8/10 | 双路径处理清晰，参数可选性保持向后兼容 |
| 可维护性 | 7/10 | 注释充分，但 JSONB 查询语义对维护者不直观 |

**综合评分: 6.8/10**（取整 **7/10**）

---

## 4. 发现清单

| 级别 | 编号 | 问题 | 位置 | 建议修复 |
|------|------|------|------|----------|
| **CRITICAL** | CR-001 | `text()` 直接拼接 `site_id` 到 SQL，存在 SQL 注入风险 | `videos.py:345` | 使用 `bindparam` 或 `func.cast(..., JSONB)` 参数化绑定 |
| **WARNING** | WR-001 | PostgreSQL `@>` 缺少 GIN 索引支持，可能全表扫描 | `models.py` / 数据库迁移 | 在 `mv_aggregated_videos.sources` 上创建 GIN 索引 |
| **WARNING** | WR-002 | `@>` 的 JSONB 数组包含语义较晦涩，维护成本高 | `videos.py:345-351` | 添加注释说明 `@>` 的对象超集语义；或改用 `jsonb_path_exists` |
| **INFO** | IN-001 | `site_id` 参数默认 `None`，向后兼容，不影响现有 API | `videos.py:451, 581` | 无需修改 |
| **INFO** | IN-002 | SQLite 路径 Python 端过滤合理，数据量小开销可忽略 | `videos.py:409-422` | 无需修改 |
| **INFO** | IN-003 | `video_detail()` 双重过滤（查询层 + Python 层）逻辑完整 | `videos.py:592-601` | 无需修改 |

---

## 5. 修复建议（优先级排序）

### 5.1 CR-001: 修复 SQL 注入风险（最高优先级）

将 `text()` 拼接改为参数化绑定：

```python
from sqlalchemy import bindparam
from sqlalchemy.dialects.postgresql import JSONB

# 替换原来的 text() 拼接
if site_id is not None:
    jsonb_filter = bindparam('site_id_filter', value=[{"site_id": site_id}], type_=JSONB)
    count_query = count_query.where(
        AggregatedVideoModel.sources.op("@>")(jsonb_filter)
    )
    query = query.where(
        AggregatedVideoModel.sources.op("@>")(jsonb_filter)
    )
```

### 5.2 WR-001: 添加 GIN 索引

在数据库初始化或迁移脚本中添加：

```sql
CREATE INDEX IF NOT EXISTS ix_mv_agg_sources_gin
ON mv_aggregated_videos USING GIN (sources);
```

### 5.3 WR-002: 添加注释说明 `@>` 语义

```python
# AC-033: JSONB 包含查询。
# @> 对 JSONB 数组的语义：左数组必须包含右数组的每个元素。
# 右操作数 [{"site_id": N}] 是单元素数组，@> 会检查 sources 中
# 是否存在某个元素对象包含 {"site_id": N}（JSONB 对象超集语义）。
```

---

## 6. 结论

AC-033 的变更在功能层面是正确的，双路径（PostgreSQL/SQLite）处理得当，`site_id` 参数保持了向后兼容。但存在一个 **CRITICAL** 级别的 SQL 注入风险（`text()` 拼接），以及一个 **WARNING** 级别的性能隐患（缺少 GIN 索引）。建议在合并前修复 CR-001，并在后续迭代中补充 GIN 索引。
