> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# QA Report: AC-030 + AC-031 + AC-032

**Date:** 2026-06-09
**QA Agent:** QA Validation Agent
**Scope:** PostgreSQL 迁移 Factory 流程 — 全文搜索、物化视图预聚合、LISTEN/NOTIFY 事件推送

---

## 1. 测试套件回归验证

### 执行命令
```bash
python -m pytest test/ -v --tb=short
```

### 结果
| 指标 | 数值 |
|------|------|
| Passed | 90 |
| Failed | 1 |
| Warnings | 6 |

### 失败项分析
- **Failed:** `test_dytt_����ҳ����Ϊ��ʵ_m3u8_���滻��׺Ϊ_ffm3u8`
- **原因:** `StepDefinitionNotFoundError` — BDD feature 文件中 "Given ����һ�� dytt ����ҳ" 步骤缺少对应的 Python step definition
- **结论:** 已知问题，与 AC-030/031/032 无关，不阻塞本次 QA

### 回归结论
无 regression。所有与数据库迁移、搜索、聚合、事件推送相关的测试均通过。

---

## 2. Python 语法检查

| 文件 | 结果 |
|------|------|
| `backend/app/services/notify_sender.py` | PASS |
| `backend/app/services/listen_manager.py` | PASS |

---

## 3. 逻辑验证

### 3.1 AC-030 全文搜索 (`videos.py`)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 使用 `settings.is_postgres` 判断 | PASS | 第 182 行：`if settings.is_postgres:` |
| 无 `hasattr` 残留 | PASS | 全文搜索 `hasattr` 已移除 |
| 使用 `plainto_tsquery('simple', keyword)` | PASS | 第 184 行，降级到 'simple' 避免 'chinese' 配置不存在导致失败 |
| SQLite 回退为 `LIKE` | PASS | 第 188 行：`VideoCache.title.ilike(f"%{keyword}%")` |

### 3.2 AC-030 SQL 脚本 (`ac030_fts_setup.sql`)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `_ht_ts_config()` 辅助函数 | PASS | 动态检测 'chinese' 配置存在性，不存在则降级到 'simple' |
| 触发器限定字段 | PASS | `BEFORE INSERT OR UPDATE OF title, actors, director, intro` |
| GIN 索引 | PASS | `ix_video_cache_search_vector` |
| 数据回填 | PASS | `UPDATE ... WHERE search_vector IS NULL` |

### 3.3 AC-031 物化视图 (`ac031_mv_setup.sql`)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `ROW_NUMBER()` 在最外层 SELECT | PASS | 第 80-90 行，在 `combined` CTE 上生成全局唯一 id |
| 唯一索引 | PASS | `ix_mv_aggregated_videos_id`，满足 `REFRESH MATERIALIZED VIEW CONCURRENTLY` 要求 |
| GIN 索引 | PASS | `ix_mv_aggregated_videos_sources` 加速 JSONB 查询 |
| 聚合逻辑一致性 | PASS | 与后端 `_refresh_aggregated_cache()` 两阶段聚合逻辑对齐 |

### 3.4 AC-032 LISTEN/NOTIFY (`listen_manager.py`)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 使用 `conn.notifies()` 异步迭代器 | PASS | 第 79 行：`async for msg in conn.notifies()` |
| 已移除 `add_listener` | PASS | 无 `add_listener` 残留 |
| 自动重连 | PASS | 指数退避（1s ~ 60s），连接断开抛异常触发重连 |
| 优雅关闭 | PASS | `shutdown_event` + `task.cancel()` |

### 3.5 AC-032 Notify 发送 (`notify_sender.py`)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `_ALLOWED_CHANNELS` 白名单 | PASS | `frozenset({"download_events", "health_events"})` |
| 持久连接复用 | PASS | `self._conn` lazy init，断线后标记为 None 下次重建 |
| SQLite 退化 | PASS | 非 PostgreSQL 时调用 `event_bus.publish()` |

---

## 4. 配置层验证 (`config.py`)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `is_postgres` 为 property | PASS | 第 27-29 行，判断 `database_url.startswith("postgresql")` |
| 默认值安全 | PASS | `database_url=None` 时回退到 SQLite |

---

## 5. 总结

| AC | 验证项 | 状态 |
|----|--------|------|
| AC-030 | 全文搜索 | PASS |
| AC-031 | 物化视图预聚合 | PASS |
| AC-032 | LISTEN/NOTIFY 事件推送 | PASS |

**整体结论:** 所有 P0 阻塞项已修复，代码逻辑正确，测试无 regression。AC-030/031/032 通过 QA 验证，可进入下一阶段。
