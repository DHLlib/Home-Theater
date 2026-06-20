> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# QA Report — REFACTOR-DB-001（数据库迁移）

**审计日期**: 2026-06-09
**审计范围**: `backend/app/config.py`, `db.py`, `models.py`, `main.py`, `api/videos.py`, `services/crawler.py`, `test/conftest.py`
**测试命令**: `python -m pytest test/ -v`
**测试结果**: 90 passed, 1 failed（已知 dytt BDD 失败，非本变更引入）

---

## 终审结论: PASS

所有边界测试通过，SQLite 兼容性验证通过，PostgreSQL 代码路径语法验证通过。无回归。

---

## 1. 边界测试矩阵（新增 19 个用例）

| 测试类 | 用例 | 验证目标 | 结果 |
|--------|------|---------|------|
| `TestConfigIsPostgres` | `test_config_is_postgres_empty_string` | `database_url=""` 时 `is_postgres=False`，回退 SQLite | PASS |
| `TestConfigIsPostgres` | `test_config_is_postgres_sqlite` | `database_url=None` 时默认 SQLite | PASS |
| `TestConfigIsPostgres` | `test_config_is_postgres_postgresql` | `database_url="postgresql://..."` 时 `is_postgres=True` | PASS |
| `TestConfigIsPostgres` | `test_config_is_postgres_sqlite_explicit` | 显式 SQLite URL 时 `is_postgres=False` | PASS |
| `TestDbSQLitePragma` | `test_db_sqlite_pragma` | SQLite PRAGMA 查询可执行 | PASS |
| `TestDbSQLitePragma` | `test_init_db_skips_postgres_view` | `init_db` 逻辑正确跳过 `mv_aggregated_videos` | PASS |
| `TestVideosInsertCls` | `test_insert_cls_sqlite` | `videos.py` 中 `insert_cls` 在 SQLite 下正确 upsert | PASS |
| `TestVideosInsertCls` | `test_insert_cls_upsert_existing` | upsert 对已存在记录执行 update | PASS |
| `TestVideosInsertClsPostgresMock` | `test_insert_cls_postgres` | 模拟 PostgreSQL 配置，`pg_insert` 语法正确 | PASS |
| `TestCrawlerInsertCls` | `test_crawler_insert_cls_sqlite` | `crawler.py` 批量 upsert 在 SQLite 下工作 | PASS |
| `TestCrawlerInsertCls` | `test_crawler_appconfig_upsert` | `crawler.py` AppConfig upsert 逻辑正确 | PASS |
| `TestModelsPostgresCompat` | `test_search_vector_sqlite_type` | SQLite 下 `search_vector` 为 `String` 类型 | PASS |
| `TestModelsPostgresCompat` | `test_aggregated_video_model_exists` | `AggregatedVideo` 物化视图模型定义正确 | PASS |
| `TestAggregatedCacheSQLite` | `test_aggregated_v1_v2_tables_exist` | V1/V2 预聚合表在 SQLite 下已创建 | PASS |
| `TestAggregatedCacheSQLite` | `test_aggregated_v1_insert_and_query` | 可向预聚合表插入并查询 | PASS |
| `TestPostgresCodeSyntax` | `test_videos_py_compiles` | `videos.py` py_compile 通过 | PASS |
| `TestPostgresCodeSyntax` | `test_crawler_py_compiles` | `crawler.py` py_compile 通过 | PASS |
| `TestPostgresCodeSyntax` | `test_db_py_compiles` | `db.py` py_compile 通过 | PASS |
| `TestPostgresCodeSyntax` | `test_models_py_compiles` | `models.py` py_compile 通过 | PASS |

---

## 2. 全部现有测试回归检查

| 检查项 | 结果 |
|--------|------|
| 测试总数 | 91 |
| 通过 | 90 |
| 失败 | 1（已知 dytt BDD 步骤定义缺失，非本变更引入） |
| 新增测试 | 19（`test/test_db_migration.py`） |
| 原有测试回归 | 无 regression |

---

## 3. 兼容性检查

### SQLite（当前环境）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| PRAGMA 执行 | 通过 | `journal_mode`/`busy_timeout` 查询可执行 |
| 表创建 | 通过 | `video_cache`, `aggregated_videos_v1/v2`, `app_config` 等正常 |
| upsert (sqlite.insert) | 通过 | `videos.py` 和 `crawler.py` 单条/批量 upsert 均工作 |
| 预聚合缓存 | 通过 | V1/V2 双缓冲表可读写 |
| 物化视图跳过 | 通过 | `init_db` 逻辑正确排除 `mv_aggregated_videos` |

### PostgreSQL（代码语法验证）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `pg_insert` 导入 | 通过 | `sqlalchemy.dialects.postgresql.insert` 可导入 |
| `pg_insert` upsert 语法 | 通过 | `on_conflict_do_update` 编译为 SQL 正确 |
| 代码 py_compile | 通过 | `videos.py`, `crawler.py`, `db.py`, `models.py` 均通过 |
| 连接池参数 | 通过 | `pool_size`, `max_overflow`, `pool_timeout`, `pool_pre_ping` 已配置 |

---

## 4. 关键发现

### 4.1 已验证的变更点

1. **`config.py`**: `Settings.database_url` 为 `str | None`，`is_postgres` property 正确检测 `postgresql://` 前缀，空字符串回退 SQLite。
2. **`db.py`**: 条件创建引擎（SQLite 带 `connect_args.timeout`，PostgreSQL 带连接池参数）；`init_db` 条件执行 PRAGMA 并跳过 `mv_aggregated_videos`。
3. **`models.py`**: `search_vector` 条件类型（SQLite `String` / PostgreSQL `TSVECTOR`）；`AggregatedVideo` 标记为 `is_view`。
4. **`videos.py`**: 模块级 `insert_cls` 条件导入（`sqlite.insert` / `postgresql.insert`）；查询路由区分 PostgreSQL 物化视图和 SQLite 双缓冲表。
5. **`crawler.py`**: 模块级 `insert_cls` 条件导入；`_refresh_aggregated_cache` 区分 PostgreSQL（物化视图刷新）和 SQLite（双缓冲表）。

### 4.2 环境限制说明

- **当前环境无 PostgreSQL**：PostgreSQL 专用测试通过 mock/条件实例化验证，未做真实数据库集成测试。
- **in-memory 数据库差异**: `:memory:` 数据库的 `journal_mode` 为 `memory`（而非 `wal`），这是 SQLite 本身的限制，不影响文件级数据库行为。

---

## 5. 风险与建议

| 风险 | 等级 | 说明 |
|------|------|------|
| PostgreSQL 真实环境未验证 | 中 | 代码语法正确，但建议在 PostgreSQL 环境中做一次集成测试 |
| `mv_aggregated_videos` 物化视图 | 低 | SQLite 下被跳过，但 conftest 的 `Base.metadata.create_all` 会创建它（测试环境无害） |
| `search_vector` 全文搜索 | 低 | SQLite 下为 `String` 占位，实际使用 `LIKE` 回退；PostgreSQL 下需额外配置 tsvector 触发器 |

---

## 6. 产出清单

- [x] 新增测试文件 `test/test_db_migration.py`（19 个用例）
- [x] 全部测试运行结果（90 passed, 1 failed）
- [x] QA 报告 `docs/registry/qa-report-refactor-db-001.md`
