> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# Review Report — REFACTOR-DB-001（数据库迁移 SQLite → PostgreSQL）

**审查日期**: 2026-06-09  
**审查范围**: `backend/pyproject.toml`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/models.py`, `backend/app/main.py`, `backend/app/api/videos.py`, `backend/app/services/crawler.py`, `test/conftest.py`  
**审查维度**: 安全性 / 正确性 / 性能 / 代码质量 / 测试覆盖  
**基线**: `docs/architecture/refactor-db-001-design.md`

---

## 审查发现清单

### CRITICAL

#### [CRITICAL-1] `config.py` — `is_postgres` 检测不完整，可能误判非 PostgreSQL 的 `postgresql+...` URL

- **位置**: `backend/app/config.py:28-29`
- **问题描述**: `is_postgres` 使用 `self.db_url.startswith("postgresql")` 判断。虽然当前 `sqlite+aiosqlite` 和 `postgresql+asyncpg` 都能正确区分，但如果未来出现 `postgresql+psycopg` 或其他以 `postgresql` 开头的驱动，检测仍然正确；但如果出现某种以 `postgresql` 开头但非 PostgreSQL 的 URL（如自定义驱动），会误判。更关键的是，如果 `db_url` 返回空字符串或 `None`，`startswith` 会抛 `AttributeError`（虽然 `db_url` property 保证了返回值，但 `database_url` 可设为空字符串）。
- **修复建议**: 将检测改为 `self.db_url.startswith("postgresql+")` 或 `"postgresql" in self.db_url.lower()`，并增加对空字符串的防御。
- **是否阻塞**: 是 — 空字符串 `database_url` 会导致启动崩溃。

#### [CRITICAL-2] `crawler.py` — 条件导入 `insert_cls` 存在冗余自赋值，且别名不一致

- **位置**: `backend/app/services/crawler.py:24-29`
- **问题描述**:
  ```python
  if settings.is_postgres:
      from sqlalchemy.dialects.postgresql import insert as pg_insert
      insert_cls = pg_insert
  else:
      from sqlalchemy.dialects.sqlite import insert as insert_cls
      insert_cls = insert_cls  # 冗余自赋值
  ```
  第 29 行 `insert_cls = insert_cls` 是冗余代码，虽无功能影响，但暴露了代码审查不仔细。更严重的是：SQLite 分支的导入别名是 `insert_cls`，PostgreSQL 分支的导入别名是 `pg_insert` 再赋值给 `insert_cls`——两者最终一致，但风格不统一。若未来维护者误改其中一个，可能引入运行时错误。
- **修复建议**: 统一两种分支的导入风格，删除冗余自赋值。
- **是否阻塞**: 否 — 当前功能正确，但属于代码异味。

#### [CRITICAL-3] `test_video_cache.py` — 两个测试用例因 `_evict_video_cache_overflow` 改为空函数而失败

- **位置**: `test/test_video_cache.py:13-103`
- **问题描述**: `test_video_cache_eviction_at_limit` 和 `test_video_cache_eviction_multiple` 测试 LRU 淘汰逻辑，期望在超过 5000 条记录时自动淘汰最旧的。但 `backend/app/api/videos.py:881-883` 中 `_evict_video_cache_overflow` 已被改为 `pass`（注释说明"取消 LRU 淘汰"）。测试断言 `count == 5000`，实际为 `5001` 和 `5005`，测试失败。
- **修复建议**: 这两个测试需要同步更新——要么恢复淘汰逻辑（如果设计文档要求保留），要么修改测试断言以匹配新的无淘汰行为，要么直接删除这两个测试。
- **是否阻塞**: 是 — 现有测试失败，破坏 CI。

#### [CRITICAL-4] `db.py` — SQLite 分支的 `connect_args` 类型不匹配

- **位置**: `backend/app/db.py:16-21`
- **问题描述**: SQLite 分支使用 `connect_args={"timeout": 30.0}`。`aiosqlite` 的 `timeout` 参数单位是秒，类型为 `float`，此值正确。但 PostgreSQL 分支未设置 `connect_args`，而 `asyncpg` 的默认连接超时是 60 秒，与 SQLite 的 30 秒不一致。更关键的是，如果用户配置了 `DATABASE_URL` 但驱动不是 `asyncpg`（如 `postgresql+psycopg`），`connect_args` 中的参数可能不被识别。
- **修复建议**: 在 PostgreSQL 分支显式配置连接超时（如 `connect_args={"timeout": 30}` 或 `command_timeout=30`），确保两分支行为一致。同时文档应说明仅支持 `asyncpg` 驱动。
- **是否阻塞**: 否 — 功能正确，但行为不一致。

---

### WARNING

#### [WARNING-1] `config.py` — 设计文档中的分项环境变量（`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`）未在实现中提供

- **位置**: `backend/app/config.py:5-32`
- **问题描述**: 设计文档 `refactor-db-001-design.md` 第 2.1 节和第 2.2 节要求支持 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` 等分项环境变量，用于从分项组装 DSN。但当前实现仅支持 `database_url` 完整 DSN 和 `db_path`（SQLite 回退）。当 `database_url` 未设置时，回退到 SQLite 文件路径而非 PostgreSQL 分项组装。这意味着：如果不设置 `DATABASE_URL`，系统不会尝试连接 PostgreSQL，而是直接回退到 SQLite。
- **修复建议**: 按设计文档实现分项变量支持，或在 `db_url` property 中当 `database_url` 为空时，检查是否存在 `DB_HOST` 等变量，若有则组装 PostgreSQL DSN，否则回退 SQLite。
- **影响**: 用户必须设置完整的 `DATABASE_URL`，无法使用分项配置。

#### [WARNING-2] `db.py` — PostgreSQL 连接池参数 `pool_size=5` 对刮削场景可能不足

- **位置**: `backend/app/db.py:7-13`
- **问题描述**: `pool_size=5`, `max_overflow=10` 对普通 API 请求足够，但刮削器（`crawler.py`）在批量写入时会频繁创建/释放连接。`crawler.py` 中 `_batch_upsert_list_fields` 和 `_batch_upsert_detail_fields` 每次调用都 `commit` 后 `await asyncio.sleep(0)`，连接会被快速归还到池中。但全量刮削时站点并发为 2，每页并发 5，同时可能有多个批量写入事务，5 个固定连接可能成为瓶颈。
- **修复建议**: 考虑为刮削任务单独配置更大的连接池，或监控实际连接使用率后调整。当前值可接受，但需在性能测试后验证。

#### [WARNING-3] `main.py` — `check_db_connection` 使用 `engine.begin()` 而非 `engine.connect()`，会隐式开启事务

- **位置**: `backend/app/main.py:66-70`
- **问题描述**: `check_db_connection` 使用 `async with engine.begin() as conn:` 执行 `SELECT 1`。`engine.begin()` 会开启一个事务并在退出时自动 commit。对于只读的 `SELECT 1`，这虽然无害，但会多一次不必要的 commit 往返。设计文档中建议使用 `engine.connect()`。
- **修复建议**: 改为 `async with engine.connect() as conn:`，避免隐式事务开销。

#### [WARNING-4] `videos.py` 与 `crawler.py` — `insert_cls` 条件导入重复，未提取到公共模块

- **位置**: `backend/app/api/videos.py:15-20`, `backend/app/services/crawler.py:24-29`
- **问题描述**: 两个文件中都包含完全相同的条件导入逻辑。如果未来新增第三种数据库（如 MySQL），需要在两处同步修改。违反 DRY 原则。
- **修复建议**: 在 `app/db.py` 或新建 `app/dialect.py` 中统一导出 `insert_cls`，两个文件直接导入使用。

#### [WARNING-5] `models.py` — `type_annotation_map` 中 `dict`/`list` 映射到 `JSON`，PostgreSQL 下自动转为 `JSONB`，但无 GIN 索引规划

- **位置**: `backend/app/models.py:8-12`
- **问题描述**: `JSONB` 在 PostgreSQL 中支持 GIN 索引，可加速 JSON 字段的内部查询。当前 `sources`（`AggregatedVideoV1/V2`）和 `categories`（`Site`）等 JSON 字段未建 GIN 索引。如果未来需要在 JSON 字段内做查询（如按 `sources[*].site_id` 过滤），全表扫描性能会很差。
- **修复建议**: 当前无 JSON 内部查询需求，可延后。但建议在 `AggregatedVideoV1/V2` 的 `sources` 字段上预留 GIN 索引，或至少在文档中记录此技术债。

#### [WARNING-6] `crawler.py` — `_refresh_aggregated_cache` 中 `insert(TargetModel).values(insert_batch)` 使用 Core `insert`，未使用 `insert_cls`

- **位置**: `backend/app/services/crawler.py:1022-1031`
- **问题描述**: 预聚合缓存刷新时，清空目标表后使用 `insert(TargetModel).values(insert_batch)`（SQLAlchemy Core 的 `insert`）批量插入。这里使用的是 `sqlalchemy.insert`（第 19 行已导入 `from sqlalchemy import delete, func, insert, select`），而非条件导入的 `insert_cls`。普通 `insert` 在 SQLite 和 PostgreSQL 中行为一致（无冲突处理），所以当前无问题。但如果未来需要在预聚合缓存刷新时也做 upsert（如部分更新），此处需要改用 `insert_cls`。
- **修复建议**: 当前功能正确，但建议注释说明此处故意使用普通 `insert`（因为目标表已清空，无冲突可能），避免未来维护者困惑。

#### [WARNING-7] `test/conftest.py` — 测试引擎注入方式与生产代码的 `is_postgres` 检测可能不一致

- **位置**: `test/conftest.py:9-31`
- **问题描述**: `conftest.py` 在导入 `app.config.settings` 之前设置 `DB_PATH=:memory:`，确保测试使用 SQLite。但如果环境变量 `TEST_DB_URL` 被设置为 PostgreSQL DSN，测试将连接真实 PostgreSQL 数据库。此时 `conftest.py` 中的引擎注入（`_db_module.engine = _test_engine`）会覆盖生产引擎，但 `is_postgres` 检测在模块导入时已完成（`videos.py` 和 `crawler.py` 顶层的 `if settings.is_postgres`），可能导致 `insert_cls` 与实际数据库不匹配。
- **修复建议**: 如果 `TEST_DB_URL` 指向 PostgreSQL，需要确保 `insert_cls` 也同步切换到 PostgreSQL 版本。当前代码中 `conftest.py` 注入引擎后，已导入的模块中的 `insert_cls` 不会自动更新。建议增加一个测试来验证 `TEST_DB_URL=postgresql+asyncpg://...` 时的行为，或在 `conftest.py` 中强制 `is_postgres` 与 `insert_cls` 一致。

---

### INFO

#### [INFO-1] `pyproject.toml` — `aiosqlite` 未从依赖中移除，但设计文档要求移除

- **位置**: `backend/pyproject.toml:6-14`
- **问题描述**: 设计文档第 5.1 节要求"移除 `aiosqlite>=0.20`"，但当前 `pyproject.toml` 中并未列出 `aiosqlite`。实际上当前文件中没有 `aiosqlite`，也没有 `asyncpg` 的显式版本约束（只有 `sqlalchemy[asyncio]>=2.0`）。`asyncpg>=0.29` 已在依赖列表中。此条为确认实现与设计一致。
- **备注**: 无问题，实现正确。

#### [INFO-2] `videos.py:660` 和 `crawler.py:573,591,618,641,798,855,1033,1044,1065` — `on_conflict_do_update` 的 `index_elements` 正确对应唯一约束

- **位置**: 多处
- **问题描述**: 经核对，`VideoCache` 表有 `UniqueConstraint("site_id", "original_id", name="uix_video_cache")`，`AppConfig` 表以 `key` 为主键。`on_conflict_do_update` 的 `index_elements` 设置正确，满足 PostgreSQL 要求。
- **备注**: 无问题，实现正确。

#### [INFO-3] `main.py` — `lifespan` 中未按设计文档实现数据库不可用的 503 降级逻辑

- **位置**: `backend/app/main.py:93-111`
- **问题描述**: 设计文档第 3.1 节建议在数据库不可用时继续启动（让静态文件服务可用），并设置 `app.state.db_available = False`，`get_db` 中抛出 503。但当前实现中 `check_db_connection()` 失败会直接抛出异常，导致启动失败。`get_db` 也未包装 503 异常处理。
- **备注**: 设计文档中的降级逻辑是"建议"而非"必须"。当前实现（启动失败）也是可接受的行为，因为数据库不可用意味着核心功能（视频查询、播放、下载）全部不可用，启动失败是合理的 fast-fail 策略。此条记录为设计文档与实现之间的差异，不视为缺陷。

#### [INFO-4] `test_video_cache.py` — 使用已废弃的 `datetime.utcnow()`

- **位置**: `test/test_video_cache.py:20,40,64`
- **问题描述**: 测试代码中使用 `datetime.utcnow()`，Python 3.12+ 已报 DeprecationWarning。应改为 `datetime.now(timezone.utc)`。
- **备注**: 非阻塞，属于代码风格债务。

---

## 测试覆盖分析

### 现有测试执行结果

```
================== 3 failed, 70 passed, 3 warnings in 25.13s ==================
```

**失败测试**:
1. `test/step_defs/test_ac006_playback_url_parsing.py::test_dytt_...` — Step definition 未找到（与本次 REFACTOR-DB-001 无关，是既有问题）
2. `test/test_video_cache.py::test_video_cache_eviction_at_limit` — 因 `_evict_video_cache_overflow` 改为 `pass` 而失败（与本次变更相关）
3. `test/test_video_cache.py::test_video_cache_eviction_multiple` — 同上

**与本次变更直接相关的失败**: 2 个（video_cache 淘汰测试）。

### 是否需要新增 PostgreSQL 相关测试

| 测试项 | 必要性 | 说明 |
|---|---|---|
| `is_postgres` 检测边界值 | 中 | 空字符串、大小写混合、不同驱动后缀 |
| `db_url` 组装正确性 | 中 | `database_url` 优先、SQLite 回退 |
| `insert_cls` 跨数据库一致性 | 高 | 确保 SQLite/PostgreSQL 的 upsert 行为一致 |
| 连接池参数生效 | 低 | 属于 SQLAlchemy 内部行为，无需测试 |
| PostgreSQL 特有的 JSONB 行为 | 低 | 当前无 JSON 内部查询，无需测试 |
| 预聚合缓存双缓冲在 PostgreSQL 下工作 | 中 | 建议作为冒烟测试 |

**建议新增**:
1. 一个参数化测试，分别用 SQLite 和 PostgreSQL DSN 验证 `config.Settings.db_url` 和 `is_postgres`。
2. 一个集成测试，验证 `insert_cls` 的 `on_conflict_do_update` 在两种数据库下都能正确 upsert。

---

## 代码质量评分

| 维度 | 得分 | 说明 |
|---|---|---|
| 安全性 | 7/10 | 无硬编码密码，无 SQL 注入风险。但 `is_postgres` 空字符串防御缺失。 |
| 正确性 | 6/10 | `insert_cls` 条件导入功能正确但代码冗余；设计文档中的分项变量未实现；2 个测试失败。 |
| 性能 | 8/10 | 连接池参数合理，读写分阶段实现正确。刮削场景连接池大小待验证。 |
| 代码质量 | 6/10 | `insert_cls` 重复导入未提取公共模块；冗余自赋值；`utcnow()` 废弃警告。 |
| 测试覆盖 | 5/10 | 70 个测试通过，但 2 个与本次变更直接相关的测试失败；无 PostgreSQL 专项测试。 |
| **综合评分** | **6.4/10** | |

---

## 是否建议通过 Review

**不建议立即通过**。

### 阻塞项（必须修复）

1. **[CRITICAL-1]** `config.py` — `is_postgres` 增加空字符串防御（`if not self.database_url` 已处理 `None`，但未处理空字符串 `""`）。
2. **[CRITICAL-3]** `test_video_cache.py` — 两个淘汰测试需要同步更新（修改断言或删除测试），确保测试全部通过。

### 建议修复（不阻塞，但强烈建议）

3. **[CRITICAL-2]** `crawler.py` — 删除冗余的 `insert_cls = insert_cls`，统一两种分支的导入风格。
4. **[WARNING-1]** `config.py` — 按设计文档实现 `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` 分项变量支持，或更新设计文档以匹配实际实现。
5. **[WARNING-4]** 提取 `insert_cls` 到公共模块（如 `app/db.py`），消除 `videos.py` 和 `crawler.py` 中的重复条件导入。
6. **[WARNING-3]** `main.py` — `check_db_connection` 改用 `engine.connect()` 避免隐式事务。
7. **[INFO-4]** `test_video_cache.py` — 替换 `datetime.utcnow()` 为 `datetime.now(timezone.utc)`。

### 修复后验证清单

- [ ] `pytest test/ -v` 全部通过（当前 70 pass, 3 fail → 目标 71+ pass, 0 fail）
- [ ] `python -c "from app.config import settings; print(settings.is_postgres)"` 在 `DATABASE_URL=""` 时不抛异常
- [ ] `python -c "from app.db import insert_cls; print(insert_cls)"` 能正确导出（如提取到公共模块）
