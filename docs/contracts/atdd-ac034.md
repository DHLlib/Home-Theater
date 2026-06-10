# ATDD: AC-034 — 批量导入优化（PostgreSQL COPY）

## 场景一：全量刮削使用 COPY 批量写入
**Given** 全量刮削产生 5000 条 `VideoCache` 记录
**When** 写入数据库
**Then** 使用 `COPY videocache (...) FROM STDIN` 或 `executemany` 批量插入
**And** 不使用逐条 `INSERT` + `commit`

## 场景二：吞吐量提升 5x+
**Given** 相同的 5000 条记录
**When** 分别对比逐条 INSERT 和 COPY/executemany 批量写入
**Then** 逐条 INSERT 吞吐量作为基准（如 100 条/秒）
**And** COPY/executemany 吞吐量 >= 500 条/秒（5x 提升）

## 场景三：批量失败时回滚
**Given** 5000 条记录批量写入过程中发生错误（如第 3000 条违反唯一约束）
**When** 写入失败
**Then** 整个批次回滚，数据库中无该批次任何记录
**And** 返回错误信息，包含失败原因和失败行号（如可能）

## 场景四：部分成功时记录失败行
**Given** 批量写入使用 `COPY ... ON CONFLICT` 或分段提交策略
**When** 部分记录冲突（如重复键）
**Then** 非冲突记录成功写入
**And** 冲突记录被记录到日志或失败队列
**And** 最终返回：成功数、失败数、失败详情

## 场景五：增量刮削批量更新
**Given** 增量刮削产生 200 条更新 + 100 条新增
**When** 写入数据库
**Then** 新增记录使用批量 INSERT
**And** 更新记录使用批量 UPDATE（`UPDATE ... FROM` 或 `executemany`）
**And** 总耗时 < 2s

## 场景六：与 tsvector 触发器兼容
**Given** `VideoCache` 表已配置 tsvector 自动更新触发器（AC-030）
**When** 使用 COPY 批量导入数据
**Then** 触发器正常工作，`search_vector` 字段被正确填充
**And** 或：COPY 后执行批量 `UPDATE` 触发触发器，或 COPY 时直接填充 `search_vector`

## 数据模型变更
- 无表结构变更
- 新增批量写入工具函数/模块

## 性能验收指标
| 指标 | 目标值 |
|------|--------|
| COPY 批量写入（5000 条） | < 10s |
| 逐条 INSERT 基准（5000 条） | ~50s |
| 吞吐量提升倍数 | >= 5x |
| 增量批量更新（300 条） | < 2s |
| 内存占用（批量缓冲） | < 100MB |

## 错误场景
| 场景 | 输入 | 期望结果 |
|------|------|----------|
| 整批失败 | 5000 条中有一条数据类型错误 | 整批回滚，返回错误详情 |
| 部分冲突 | 100 条中有 10 条重复键 | 90 条成功，10 条记录到失败日志 |
| 空批次 | 0 条记录 | 立即返回，不执行任何操作 |
| 超大批次 | 50000 条记录 | 自动分片为多个子批次（如每批 5000），逐批提交 |

## 依赖关系
- **blockedBy**: REFACTOR-DB-001
- **note**: 需与 AC-030（tsvector 触发器）协调，确保 COPY 后 search_vector 正确填充
