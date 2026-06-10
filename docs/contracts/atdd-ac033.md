# ATDD: AC-033 — JSONB 查询优化

## 场景一：VideoCache sources 字段 JSONB 查询
**Given** `VideoCache` 表存储 JSON 数据于 `sources` 字段（类型 JSONB）
**When** 查询某条记录的 sources 信息
**Then** 使用 JSONB 操作符访问，如 `sources ->> 'site_id'`
**And** 查询利用 JSONB 索引（如有）

## 场景二：AggregatedVideo sources 列表过滤特定 site_id
**Given** `AggregatedVideo`（或物化视图）的 `sources` 字段为 JSONB 数组
**When** 过滤包含特定 site_id 的聚合视频
**Then** 使用 `@>` 操作符：`sources @> '[{"site_id": 1}]'`
**And** 查询走 GIN 索引（`USING GIN(sources jsonb_path_ops)`）

## 场景三：嵌套路径查询
**Given** `sources` 字段包含嵌套结构，如 `{"episodes": [{"name": "第一集", "url": "..."}]}`
**When** 查询特定嵌套路径
**Then** 使用路径操作符：`sources -> 'episodes' -> 0 ->> 'name'`
**And** 返回正确的嵌套值

## 场景四：空 JSON 处理
**Given** 某条记录的 `sources` 为 NULL 或 `'{}'`
**When** 使用 JSONB 操作符查询
**Then** 空 JSON 返回空结果（不报错）
**And** `sources @> '...'` 对 NULL 值返回 FALSE

## 场景五：JSONB 聚合操作
**Given** 多条记录的 sources 需要合并
**When** 执行聚合查询
**Then** 使用 `jsonb_agg(sources)` 合并为 JSONB 数组
**And** 结果可直接用于前端展示

## 数据模型变更
```sql
-- 所有 JSON 字段升级为 JSONB
ALTER TABLE videocache ALTER COLUMN sources TYPE jsonb USING sources::jsonb;
ALTER TABLE videocache ALTER COLUMN play_url_raw TYPE jsonb USING play_url_raw::jsonb;

-- 物化视图中的 JSONB 字段（在创建时指定）
-- sources jsonb

-- GIN 索引支持 JSONB 查询
CREATE INDEX idx_videocache_sources ON videocache USING GIN(sources jsonb_path_ops);
```

## 性能验收指标
| 指标 | 目标值 |
|------|--------|
| JSONB @> 查询（10000 条） | < 20ms |
| 嵌套路径查询（10000 条） | < 30ms |
| jsonb_agg 聚合（1000 条） | < 50ms |
| 对比 TEXT 存储 JSON 解析 | 快 3x+ |

## 错误场景
| 场景 | 输入 | 期望结果 |
|------|------|----------|
| 无效 JSON | 插入非 JSON 字符串 | 插入失败，返回 400 |
| 路径不存在 | `-> '不存在的键'` | 返回 NULL，不报错 |
| 数组越界 | `-> 'episodes' -> 999` | 返回 NULL，不报错 |
| 类型不匹配 | 对字符串用 `->`（而非 `->>`） | 返回 JSONB 字符串（含引号），符合 PostgreSQL 语义 |

## 依赖关系
- **blockedBy**: REFACTOR-DB-001
