# ATDD: AC-030 — 全文搜索优化（PostgreSQL tsvector）

## 场景一：搜索使用 tsvector
**Given** 用户在搜索框输入关键词"动作"
**When** 执行搜索请求 `GET /api/videos?wd=动作`
**Then** 后端使用 `to_tsvector('chinese', vod_name) @@ plainto_tsquery('chinese', '动作')` 进行查询
**And** 响应时间 < 50ms
**And** 响应格式与原有搜索接口完全一致（字段、结构不变）

## 场景二：tsvector 列与索引就绪
**Given** `VideoCache` 表已有 10000 条记录
**When** 检查表结构
**Then** 存在 `search_vector` 列，类型为 `tsvector`
**And** 存在 GIN 索引 `CREATE INDEX idx_video_search ON videocache USING GIN(search_vector)`
**And** 所有现有记录的 `search_vector` 已填充（非 NULL）

## 场景三：自动更新触发器
**Given** `VideoCache` 表已配置 tsvector
**When** 插入或更新一条记录（`vod_name` 或 `vod_actor` 变更）
**Then** `search_vector` 自动更新为新值的 tsvector 表示
**And** 无需应用层手动维护该字段

## 场景四：空关键词处理
**Given** 用户输入空字符串或仅空白字符作为关键词
**When** 执行搜索
**Then** 返回空结果集（`[]`）
**And** 不执行 tsvector 查询（避免全表扫描）
**And** HTTP 状态码 200

## 场景五：特殊字符处理
**Given** 用户输入包含特殊字符的关键词，如 `"动作 & 科幻 | 剧情"`、`"<script>"`、`"' OR '1'='1"`
**When** 执行搜索
**Then** 特殊字符被正确转义，不引发语法错误或 SQL 注入
**And** 返回与关键词匹配的结果或空结果集

## 场景六：性能对比验证
**Given** `VideoCache` 表有 50000 条记录
**When** 分别执行 LIKE 查询和 tsvector 查询同一关键词
**Then** LIKE 查询耗时 ~200ms（基准）
**And** tsvector 查询耗时 < 50ms
**And** 两者返回结果集一致（忽略排序差异）

## 数据模型变更
```sql
-- VideoCache 表新增列
ALTER TABLE videocache ADD COLUMN search_vector tsvector;

-- GIN 索引
CREATE INDEX idx_video_search ON videocache USING GIN(search_vector);

-- 自动更新触发器
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('chinese', COALESCE(NEW.vod_name, '') || ' ' || COALESCE(NEW.vod_actor, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_search_vector
BEFORE INSERT OR UPDATE ON videocache
FOR EACH ROW EXECUTE FUNCTION update_search_vector();
```

## 性能验收指标
| 指标 | 目标值 |
|------|--------|
| tsvector 搜索响应时间（10000 条） | < 50ms |
| tsvector 搜索响应时间（50000 条） | < 100ms |
| 索引构建时间（10000 条） | < 5s |
| 触发器更新延迟 | < 1ms/行 |

## 错误场景
| 场景 | 输入 | 期望结果 |
|------|------|----------|
| 中文分词器未安装 | `to_tsvector('chinese', ...)` | 安装 zhparser 或降级使用 'simple'，日志警告 |
| 空关键词 | `wd=""` | 返回空数组，不执行查询 |
| 超长关键词 | > 100 字符 | 截断至 100 字符后查询 |

## 依赖关系
- **blockedBy**: REFACTOR-DB-001
- **replaces**: AC-004（全文搜索功能，底层实现从 LIKE 升级为 tsvector）
