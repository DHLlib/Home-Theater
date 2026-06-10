# Baseline Snapshot — REFACTOR-DB-001

**日期**: 2026-06-09
**分支**: home-theater-v2
**基线目标**: SQLite 版本，迁移前快照

---

## Git 状态

```
M docs/contracts/acceptance-criteria.md
M docs/contracts/delta-ac-report.md
M docs/registry/traceability.yaml
?? docs/architecture/*.md
?? docs/contracts/atdd-*.md
```

> 文档变更是 Factory 流程产出，不影响代码基线。

## 测试基线

```bash
pytest test/ -v --tb=short
```

**结果**: 70 passed, 3 failed, 3 warnings in 24.86s

### 已知失败（非回归，迁移前已存在）

| 测试 | 失败原因 | 状态 |
|------|---------|------|
| `test_ac006_playback_url_parsing::test_dytt_*` | Step definition not found（BDD 步骤未实现）| 历史遗留 |
| `test_video_cache_eviction_at_limit` | assert 5001 == 5000（AC-014 已取消 5000 行上限）| 预期失败 |
| `test_video_cache_eviction_multiple` | assert 5005 == 5000（同上）| 预期失败 |

### 通过测试分布

| 模块 | 数量 | 说明 |
|------|------|------|
| test_sites.py | 18 | 站点 CRUD、分类映射 |
| test_favorites.py | 7 | 收藏管理 |
| test_downloads.py | 10 | 下载任务 |
| test_videos.py | 8 | 视频列表、搜索 |
| test_video_cache.py | 2（其余）| 缓存写入、upsert |
| test_e2e_video_lifecycle.py | 8 | E2E 场景 |
| test_ac012_resume_download.py | 6 | 断点续传 |
| test_ac013_site_health_monitoring.py | 6 | 健康监控 |
| test_ac006_playback_url_parsing.py | 1（其余）| 播放解析 |

## 关键性能基线（SQLite）

| 指标 | 当前值 | 测试环境 |
|------|--------|---------|
| 首页聚合查询 | ~26ms | 本地 SQLite |
| 搜索 LIKE 查询 | ~200ms | 本地 SQLite |
| 全量刮削 | 20-40分钟 | 本地 SQLite |

## 迁移后对比目标

迁移完成后（baseline_compare），验证以下等价维度：

| 维度 | 通过标准 |
|------|---------|
| 功能等价 | 70 个通过测试继续通过 |
| API 响应 | REST API 响应格式不变 |
| SSE 推送 | 事件格式不变 |
| 性能 | 首页 ≤ 20ms，搜索 ≤ 50ms |

---

*此快照在 REFACTOR-DB-001 TDD 阶段前创建，用于 baseline_compare 对比。*
