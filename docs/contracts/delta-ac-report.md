# Delta AC 报告 — 日志精细化

**变更描述**: 区分日志格式，精细化日志
**分析日期**: 2026-06-06
**分析模式**: Delta 变更

---

## 新增 AC

### AC-024 source_client 日志精细化

**Given** 后端通过 `source_client` 发起资源站请求
**When** 请求完成并记录日志时
**Then** 日志中包含 `op` 字段标识操作场景：首页列表(`home_list`)、搜索(`search`)、刮削全量(`crawler_full`)、刮削增量(`crawler_incremental`)、健康探测(`health_probe`)、详情回源(`detail_resolve`)、播放解析(`play_resolve`)

**技术要点**:
- `source_client.py` 的 `_get`/`list`/`videolist` 增加 `op` 参数
- 各调用方（crawler、health、play、videos）传入对应 `op` 标识
- 日志格式统一增加 `op={标识}` 字段

**impl_files**:
- backend/app/services/source_client.py
- backend/app/services/crawler.py
- backend/app/services/health.py
- backend/app/api/play.py
- backend/app/api/videos.py

---

## 影响范围总结

| 维度 | 影响 |
|------|------|
| 新增 AC | AC-024 |
| 修改 AC | 无 |
| 删除 AC | 无 |
| 受影响后端组件 | source_client.py, crawler.py, health.py, play.py, videos.py |
| 接口契约变更 | 无（仅日志格式） |
| 处理模式 | Delta 变更 |
| 回退阶段 | 新 AC 从 atdd 开始 |

---

## 风险点

1. **调用方遗漏**: 新增 `op` 参数后，需确保所有调用方都正确传入，避免默认空值导致日志不完整
2. **日志解析兼容性**: 如外部系统依赖现有日志格式，增加字段可能破坏解析（本项目无此场景）
