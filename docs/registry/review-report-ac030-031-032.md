> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# Code Review Report: AC-030 / AC-031 / AC-032

**Review Date:** 2026-06-09
**Reviewer:** Code Reviewer
**Scope:** PostgreSQL 全文搜索 (AC-030)、物化视图预聚合 (AC-031)、LISTEN/NOTIFY 事件推送 (AC-032)

---

## Executive Summary

| AC | 代码质量评分 | 建议 |
|---|---|---|
| AC-030 (全文搜索) | 6/10 | 条件通过，需修复 2 处 CRITICAL |
| AC-031 (物化视图) | 7/10 | 条件通过，需修复 1 处 CRITICAL + 1 处 WARNING |
| AC-032 (LISTEN/NOTIFY) | 5/10 | 条件通过，需修复 3 处 CRITICAL + 1 处 WARNING |

**总体建议：三个 AC 均条件通过 review，但必须在合并前修复标注的 CRITICAL 项。**

---

## AC-030: PostgreSQL 全文搜索

### 修改文件
- `backend/app/models.py` — search_vector 字段
- `backend/app/api/videos.py` — 搜索逻辑 tsvector 分支
- `backend/app/sql/ac030_fts_setup.sql` — 触发器/索引 SQL

### 审查发现

#### CRITICAL-1: `to_tsvector('chinese', ...)` 词典可能不存在，导致搜索完全失效

**位置：** `ac030_fts_setup.sql` 第 27-30 行、第 43-47 行

**问题：** SQL 脚本直接使用 `'chinese'` 配置创建 tsvector，但标准 PostgreSQL 安装并不自带中文全文搜索配置。`pg_trgm` 扩展（第 5 行）提供的是三元组匹配，不是中文分词。如果 `chinese` 配置不存在，触发器和回填 UPDATE 都会报错失败。

**影响：** 首次执行 SQL 脚本即失败，全文搜索功能完全不可用。

**建议修复：**
1. 脚本中增加 `chinese` 配置存在性检测，不存在时使用 `'simple'` 降级；或
2. 在文档中明确标注需先安装 `zhparser` / `pg_jieba` 等中文分词扩展；或
3. 代码层（`videos.py`）增加运行时词典检测并缓存，与 design doc 中 2.5 节的 `_check_chinese_dict_available` 方案对齐。

#### CRITICAL-2: `hasattr(VideoCache, 'search_vector')` 在运行时不可靠

**位置：** `backend/app/api/videos.py` 第 182 行

```python
if settings.is_postgres and hasattr(VideoCache, 'search_vector'):
```

**问题：** `VideoCache` 模型在 `models.py` 中通过 `if settings.is_postgres` 条件定义了 `search_vector` 字段的类型（TSVECTOR vs String），但类属性始终存在。`hasattr` 检查的是类上是否有该属性名，而不管其类型。在 SQLite 下该字段为 `String` 类型但属性名相同，`hasattr` 仍返回 `True`。虽然外层有 `settings.is_postgres` 保护，但双条件冗余且容易误导维护者。

**实际影响：** 当前逻辑因 `settings.is_postgres` 在前，不会走到错误分支，但 `hasattr` 检查无意义，应移除或改为有意义的检查。

**建议修复：** 移除 `hasattr` 检查，简化为 `if settings.is_postgres:`。如果担心模型未同步，可在应用启动时校验。

#### WARNING-1: 搜索未使用 `ts_rank` 排序，GIN 索引收益受限

**位置：** `backend/app/api/videos.py` 第 183-188 行

**问题：** 当前 tsvector 查询仅用 `@@` 操作符做过滤，未按 `ts_rank` 排序。这意味着搜索结果不按相关性排列，与用户期望的全文搜索体验有差距。设计文档 2.5 节明确建议用 `ts_rank` 排序。

**建议：** 后续迭代中增加 `ts_rank` 排序分支，或至少保留 TODO 注释。

#### INFO-1: 触发器字段覆盖不全

**位置：** `ac030_fts_setup.sql` 第 23-33 行

**问题：** 触发器在 `UPDATE` 时未限定字段（即任意字段更新都触发 recalculation），而 design doc 中建议 `BEFORE INSERT OR UPDATE OF title, actors, director`。当前实现会不必要的频繁重算 `search_vector`（如 `play_url_raw` 更新时）。

**建议：** 将触发器改为 `BEFORE INSERT OR UPDATE OF title, actors, director, intro`，与设计文档对齐，减少不必要开销。

#### INFO-2: `search_vector` 在 SQLite 下为 String 占位，但 ORM 可能尝试写入

**位置：** `backend/app/models.py` 第 147-150 行

**问题：** SQLite 下 `search_vector` 映射为 `String`，但刮削代码（`crawler.py`）在构建 entry 时并未填充此字段。`upsert` 时该字段为 NULL，不会触发问题，但如果未来有代码尝试写入 tsvector 字符串到 SQLite，会静默存储无意义数据。

**建议：** 在 `VideoCache` 模型上添加 `doc` 注释说明此字段的 PG-only 语义。

---

## AC-031: 物化视图预聚合

### 修改文件
- `backend/app/models.py` — AggregatedVideo 物化视图映射
- `backend/app/services/aggregator.py` — refresh_aggregated_view
- `backend/app/services/crawler.py` — 双路径刷新
- `backend/app/api/videos.py` — 首页查询双路径
- `backend/app/sql/ac031_mv_setup.sql` — 物化视图 SQL

### 审查发现

#### CRITICAL-1: 物化视图 SQL 中 `ROW_NUMBER()` 生成的 `id` 不保证唯一性

**位置：** `ac031_mv_setup.sql` 第 56-57 行、第 72-73 行

**问题：** 两个 `UNION ALL` 分支各自使用独立的 `ROW_NUMBER() OVER (...)` 窗口函数生成 `id`，如果两个分支产生相同序号，则 `id` 不唯一。虽然 `UNION ALL` 的结果集中 `id` 冲突概率低（取决于排序重叠），但这不是确定性的。`REFRESH MATERIALIZED VIEW CONCURRENTLY` 要求严格唯一索引。

**建议修复：** 使用全局唯一的 `ROW_NUMBER()`，例如：
```sql
ROW_NUMBER() OVER (ORDER BY ...)::INTEGER AS id
```
放在最外层 SELECT 中，而非每个 UNION 分支内部。

#### WARNING-1: `refresh_aggregated_view` 的 fallback 非并发刷新未处理事务状态

**位置：** `backend/app/services/aggregator.py` 第 81-95 行

**问题：** 当 `CONCURRENTLY` 刷新失败时，代码尝试 fallback 到普通 `REFRESH MATERIALIZED VIEW`。但此时前一个 `await db.commit()` 可能已经提交了空事务（`text()` 执行失败时是否自动 rollback 取决于驱动行为）。如果异常发生在 `execute` 后 `commit` 前，事务状态不确定。

**更深层问题：** `refresh_aggregated_view` 函数内两次 `await db.commit()`，但调用方 `crawler.py` 第 896 行在调用前也持有一个 db session（通过 `async with self._db_factory() as db`）。这意味着同一个刷新操作涉及多层 session 嵌套，虽然 SQLAlchemy async session 支持嵌套，但事务边界模糊。

**建议修复：**
1. `refresh_aggregated_view` 不应内部 commit，应由调用方统一控制事务；或
2. 明确文档化：调用方传入的 session 仅用于读取时间戳，刷新操作使用独立连接。

#### INFO-1: 物化视图 `sources` 字段结构与 SQLite 双缓冲表不一致

**位置：** `ac031_mv_setup.sql` 第 14-22 行

**问题：** 物化视图中 `sources` 的 JSON 结构包含 `type`, `remarks`, `updated_at`，而 SQLite 双缓冲表中的 `sources` 结构由 `crawler.py` 写入，包含 `site_id`, `original_id`, `type`, `remarks`, `updated_at`。两者字段一致，但物化视图缺少 `site_name`（设计文档 3.1 中有 `cached_at`，实际 SQL 中没有）。

**验证：** 经核对，`videos.py` 中 `_query_aggregated_cache` 对 PostgreSQL 和 SQLite 分支都使用 `SourceRef(**s)` 解析，`SourceRef` 模型中所有字段均为 Optional，所以结构差异不会导致运行时错误。前端无感知。

#### INFO-2: `AggregatedVideo` 模型声明了 `cached_at` 但物化视图 SQL 中没有

**位置：** `backend/app/models.py` 第 185-202 行

**问题：** `AggregatedVideo` ORM 模型未声明 `cached_at` 字段（与设计文档一致），但物化视图 SQL 也没有此字段。这是正确的，无需修复。

#### INFO-3: 双缓冲表 `AggregatedVideoV1/V2` 在 PostgreSQL 下仍会被创建

**位置：** `backend/app/db.py` 第 38-44 行

**问题：** `init_db()` 在 PostgreSQL 下只跳过 `mv_aggregated_videos`，但 `AggregatedVideoV1` 和 `AggregatedVideoV2` 表仍会被创建。这是有意保留的（兼容现有 SQLite 部署），但在纯 PostgreSQL 环境下是死表。

**建议：** 非阻塞，可后续清理。当前设计是 SQLite/PG 双路径共存，保留 V1/V2 对 SQLite 用户是必要的。

---

## AC-032: LISTEN/NOTIFY 事件推送

### 修改文件
- `backend/app/services/notify_sender.py` — 新增
- `backend/app/services/listen_manager.py` — 新增
- `backend/app/api/sse.py` — SSE 端点双路径
- `backend/app/services/downloader.py` — notify_sender.send
- `backend/app/services/scheduler.py` — notify_sender.send
- `backend/app/api/downloads.py` — notify_sender.send
- `backend/app/main.py` — listen_manager 生命周期

### 审查发现

#### CRITICAL-1: `notify_sender._send_postgres` 每发一条 NOTIFY 新建一个数据库连接

**位置：** `backend/app/services/notify_sender.py` 第 27-42 行

**问题：** 每次调用 `send()` 都通过 `asyncpg.connect()` 创建新连接、执行 `NOTIFY`、然后关闭。下载进度事件中 `_batch_commit` 每 5 秒或每 100 个 segment 就发送一次事件，高并发下载时会产生大量短连接，严重浪费资源。

**影响：** 连接风暴，PostgreSQL 端连接数暴涨，性能急剧下降。

**建议修复：** 使用连接池或持久连接。最简单方案：复用 SQLAlchemy 的 engine 连接（`engine.connect()` 获取原始连接执行 `NOTIFY`），或在 `NotifySender` 中维护一个持久 `asyncpg` 连接。

#### CRITICAL-2: `NOTIFY` 语句存在 SQL 注入风险

**位置：** `backend/app/services/notify_sender.py` 第 37 行

```python
await conn.execute(f"NOTIFY {channel}, $1", payload)
```

**问题：** `channel` 名通过 f-string 直接拼接到 SQL 中。虽然当前调用方使用硬编码的 `"download_events"` 和 `"health_events"`，但 `channel` 是函数参数，未来如果被不可信输入调用，存在注入风险。PostgreSQL 的 `NOTIFY` 语法不支持参数化 channel 名，但应至少对 channel 做白名单校验。

**建议修复：**
```python
ALLOWED_CHANNELS = {"download_events", "health_events"}
if channel not in ALLOWED_CHANNELS:
    raise ValueError(f"Invalid channel: {channel}")
```

#### CRITICAL-3: `listen_manager._listen_loop` 的保活机制有缺陷，连接断开后无法及时检测

**位置：** `backend/app/services/listen_manager.py` 第 58-96 行

**问题：** 当前保活通过 `await asyncio.wait_for(self._shutdown_event.wait(), timeout=5.0)` 实现，即每 5 秒检查一次是否 shutdown。但如果 PostgreSQL 连接在底层断开（如网络中断、PG 重启），`asyncpg` 的 `add_listener` 回调不会主动抛出异常，循环会永远卡在 `wait_for(shutdown_event, 5.0)` 上，不会触发重连。

**根本原因：** 代码没有真正监听 `asyncpg` 的通知流（`connection.notifies()` 迭代器），而是依赖 `shutdown_event` 的超时循环。`add_listener` 注册的是回调函数，连接断开后回调不再被调用，但也不会报错。

**建议修复：** 使用 `asyncpg` 的 `connection.notifies()` 异步迭代器替代 `add_listener` + `shutdown_event` 超时循环：

```python
async for msg in conn.notifies():
    if self._shutdown_event.is_set():
        break
    self._on_notification(None, msg.pid, msg.channel, msg.payload)
```

这样连接断开时 `notifies()` 会抛出异常，触发外层 except 进入重连逻辑。

#### WARNING-1: SSE 双路径下数据格式不一致

**位置：** `backend/app/api/sse.py` 第 20-72 行

**问题：** SQLite 路径（`_event_stream_sqlite`）从 `event_bus` 获取的数据已经是 JSON 字符串（`publish()` 中 `json.dumps` 的结果），直接 yield：`f"data: {data}\n\n"`。PostgreSQL 路径（`_event_stream_postgres`）从 `listen_manager` 获取的是 Python dict，再 `json.dumps` 一次：`f"data: {json.dumps(data)}\n\n"`。

虽然两者最终都是合法 JSON，但如果 `event_bus.publish()` 的格式和 `notify_sender` 的 payload 结构不完全一致，前端解析会有差异。当前代码中：
- `event_bus.publish()` 产出 `{"type": ..., "payload": ...}` 的 JSON 字符串
- `notify_sender._send_postgres()` 发送的 payload 也是 `{"type": ..., "payload": ...}` 的 JSON 字符串
- `listen_manager._on_notification()` 将 payload JSON parse 为 dict
- `_event_stream_postgres` 又将 dict dump 为 JSON

所以最终 SSE 数据格式一致，但存在冗余的 parse/dump 往返。

**建议：** 统一为 dict 传递，只在最后 yield 时 dump。或统一为字符串传递，避免往返。

#### INFO-1: `event_bus` 未被删除，与设计文档的"完全替换"策略矛盾

**位置：** `backend/app/services/event_bus.py`

**问题：** AC-032 设计文档 5.3 节明确列出"删除 `app/services/event_bus.py`"，但实际代码中 `event_bus.py` 仍然存在，且被 `sse.py`（SQLite 路径）和 `notify_sender.py`（SQLite 路径）引用。

**实际影响：** 这是正确的双路径实现——SQLite 下仍需 `event_bus`。设计文档的"完全替换"策略假设已迁移到 PostgreSQL，但当前代码支持 SQLite/PG 双路径，保留 `event_bus` 是合理的。文档与实现存在预期差异，但实现更务实。

#### INFO-2: `listen_manager` 在 SQLite 下仍被实例化

**位置：** `backend/app/services/listen_manager.py` 第 121-124 行

**问题：** 全局实例 `listen_manager = ListenConnectionManager(...)` 在模块导入时即创建，不检查 `settings.is_postgres`。虽然 `start()` 方法会跳过，但实例本身（包括 DSN 计算）在导入时即执行。SQLite 下 `_dsn_for_asyncpg()` 返回 `sqlite+aiosqlite://...` 的 URL，不会被实际使用，但模块级副作用存在。

**建议：** 非阻塞，但建议改为懒加载或工厂函数。

#### INFO-3: `downloader.py` 中 `notify_sender.send` 调用点过多，可能产生事件洪水

**位置：** `backend/app/services/downloader.py` 第 54, 65, 76, 223, 335-342, 430, 620 行

**问题：** 下载进度事件在 m3u8 模式下每下载一个 `.ts` 片段都通过 `_batch_commit` 触发 `notify_sender.send`。如果片段数上千，会产生大量 NOTIFY。虽然 `_batch_commit` 有批量控制（每 5 秒或每 100 个 segment），但在高并发下载时仍可能对 PG 造成压力。

**建议：** 当前实现可接受，但建议在 `notify_sender` 中增加本地缓冲/节流机制，或改用批量发送。

---

## 跨 AC 综合发现

### 1. 双路径切换逻辑总体正确

`settings.is_postgres` 作为统一开关，在以下位置正确使用：
- `models.py`: 条件导入 TSVECTOR，条件定义 search_vector 类型
- `db.py`: 条件创建引擎，条件跳过 mv_aggregated_videos
- `videos.py`: 条件使用 tsvector 搜索，条件路由物化视图/双缓冲表
- `aggregator.py`: 条件执行 REFRESH MATERIALIZED VIEW
- `crawler.py`: 条件路由刷新逻辑
- `sse.py`: 条件路由 LISTEN / event_bus
- `notify_sender.py`: 条件路由 NOTIFY / event_bus
- `listen_manager.py`: 条件启动 LISTEN 循环

**未发现双路径切换遗漏或错误。**

### 2. 前端兼容性验证

- SSE 端点 (`/api/sse`) 返回的 `text/event-stream` 格式在 SQLite/PG 双路径下一致
- `videos.py` 的 list/search API 返回的 `AggregatedListResponse` 结构不变
- 搜索 API 的 `wd` 参数语义不变
- 物化视图和双缓冲表返回的 `sources` 字段均通过 `SourceRef(**s)` 解析，兼容 Optional 字段

**前端无感知，验证通过。**

### 3. 未实现的设计文档内容

| 设计文档内容 | 实现状态 | 说明 |
|---|---|---|
| 中文词典运行时检测 (`_check_chinese_dict_available`) | 未实现 | AC-030 当前硬编码 `'chinese'` |
| `ts_rank` 排序 | 未实现 | AC-030 仅用 `@@` 过滤 |
| 物化视图 `cached_at` 字段 | 未实现 | 设计文档有，实际 SQL 和模型均无，不影响功能 |
| `event_bus.py` 删除 | 未执行 | SQLite 路径仍需，合理保留 |
| `health.py` 中 notify_sender 调用 | 未找到 | 设计文档要求 health.py 发送 health_events，但当前 `scheduler.py` 已覆盖站点健康事件 |

---

## 修复优先级清单

### P0（阻塞合并）

1. **AC-032 CRITICAL-1**: `notify_sender` 每发一条事件新建一个连接，必须使用连接池或持久连接
2. **AC-032 CRITICAL-2**: `NOTIFY` 的 channel 名存在注入风险，需加白名单校验
3. **AC-032 CRITICAL-3**: `listen_manager` 使用 `add_listener` + `shutdown_event` 超时循环，无法检测连接断开，需改用 `connection.notifies()` 迭代器
4. **AC-030 CRITICAL-1**: 中文全文搜索 `'chinese'` 配置可能不存在，需增加降级逻辑或文档标注
5. **AC-031 CRITICAL-1**: 物化视图 `id` 生成不保证唯一，需将 `ROW_NUMBER()` 移到最外层

### P1（建议本轮修复）

6. **AC-030 CRITICAL-2**: 移除 `hasattr(VideoCache, 'search_vector')` 的无意义检查
7. **AC-031 WARNING-1**: `refresh_aggregated_view` 事务边界模糊，建议由调用方统一控制

### P2（可后续迭代）

8. **AC-030 WARNING-1**: 增加 `ts_rank` 排序支持
9. **AC-030 INFO-1**: 触发器限定字段范围，减少不必要重算
10. **AC-032 WARNING-1**: 统一 SSE 双路径的数据传递格式，消除冗余 parse/dump
11. **AC-032 INFO-2**: `listen_manager` 改为懒加载实例

---

## 评分说明

### AC-030: 6/10
- 基础功能实现正确，双路径切换无误
- 扣分点：中文词典硬编码（生产环境可能直接失败）、未使用 ts_rank 排序、`hasattr` 检查无意义

### AC-031: 7/10
- 物化视图 SQL 逻辑与后端聚合逻辑一致，双路径查询正确
- 扣分点：`id` 唯一性不保证、事务边界模糊

### AC-032: 5/10
- 架构设计合理，双路径 SSE 兼容
- 扣分点：每事件新建连接（性能灾难级）、SQL 注入风险、连接断开检测失效——这三项都是生产环境不可接受的缺陷

---

*Report generated by Code Reviewer*
