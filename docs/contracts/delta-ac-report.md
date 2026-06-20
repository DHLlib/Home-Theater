> ⚠️ 历史快照：本分支已全面 PostgreSQL 化，下文 SQLite 相关描述仅为当时记录。
>
# Delta AC Report — PostgreSQL 深度适配 Sprint

**变更描述**: 数据库引擎迁移（SQLite → PostgreSQL）及配套优化
**日期**: 2026-06-09

---

## 1. 新增 AC 列表（6 个）

| AC ID | 标题 | 关键验收点 | 状态 |
|-------|------|------------|------|
| **REFACTOR-DB-001** | 数据库引擎迁移（SQLite → PostgreSQL） | 依赖替换（aiosqlite→asyncpg）、db.py 清理、config.py URL 变更、503 错误处理 | 新建 |
| **AC-030** | 全文搜索优化（PostgreSQL tsvector） | tsvector 列 + GIN 索引 + 触发器、< 50ms、特殊字符安全 | 新建 |
| **AC-031** | 物化视图预聚合（PostgreSQL MATERIALIZED VIEW） | mv_aggregated_videos、CONCURRENTLY 刷新、唯一索引、< 20ms | 新建 |
| **AC-032** | LISTEN/NOTIFY 事件推送 | NOTIFY 发送、SSE 接收、自动重连、移除内存 event_bus | 新建 |
| **AC-033** | JSONB 查询优化 | JSONB 类型、@> 操作符、嵌套路径 ->>、GIN 索引 | 新建 |
| **AC-034** | 批量导入优化（PostgreSQL COPY） | COPY FROM / executemany、5x+ 吞吐提升、回滚/失败处理 | 新建 |

## 2. 受影响已有 AC

| 原 AC | 功能描述 | 替换者 | 说明 |
|-------|----------|--------|------|
| **AC-003** | 预聚合缓存（双缓冲表） | **AC-031** | 原 `AggregatedVideoV1`/`V2` 双缓冲表被物化视图 `mv_aggregated_videos` 替代。接口契约不变（`GET /api/videos` 无 category 时返回聚合列表），底层存储从应用层双表切换改为数据库原生 `REFRESH MATERIALIZED VIEW CONCURRENTLY`。 |
| **AC-004** | 全文搜索（LIKE 查询） | **AC-030** | 原 `vod_name LIKE '%关键词%'` 实现被 PostgreSQL `tsvector` + `plainto_tsquery` 替代。接口契约不变（`GET /api/videos?wd=...`），响应格式不变，性能从 ~200ms 提升至 < 50ms。 |
| **AC-016** | 事件推送（内存 event_bus） | **AC-032** | 原内存 `event_bus` / `asyncio.Queue` 事件总线被 PostgreSQL `LISTEN/NOTIFY` 替代。SSE 接口契约不变（`/api/downloads/events`），推送机制从进程内队列改为数据库通道，支持多实例部署。 |

## 3. 接口契约变更

**无接口契约变更。**

所有外部接口（REST API + SSE）的请求参数、响应格式、状态码保持不变。变更仅限于底层实现：

| 接口 | 变更前 | 变更后 | 用户感知 |
|------|--------|--------|----------|
| `GET /api/videos` | 读 `AggregatedVideoV1/V2` | 读 `mv_aggregated_videos` | 无（更快） |
| `GET /api/videos?wd=...` | `LIKE '%wd%'` | `tsvector @@ query` | 无（更快） |
| `GET /api/downloads/events` | 内存 event_bus | `LISTEN download_events` | 无（更稳定） |
| `POST /api/videos/crawler/...` | 逐条 INSERT | COPY / executemany | 无（更快） |

## 4. 数据模型变更

### 4.1 移除

| 对象 | 类型 | 说明 |
|------|------|------|
| `aggregated_videos_v1` | 表 | 预聚合双缓冲表（活跃版本） |
| `aggregated_videos_v2` | 表 | 预聚合双缓冲表（非活跃版本） |
| `AppConfig.aggregated_active_version` | 配置项 | 双缓冲版本切换标记 |
| `_ensure_columns` | 函数 | SQLite 动态列迁移 |

### 4.2 新增

| 对象 | 类型 | 说明 |
|------|------|------|
| `mv_aggregated_videos` | 物化视图 | 预聚合视频数据 |
| `idx_mv_agg_unique` | 唯一索引 | 物化视图 CONCURRENTLY 刷新必需 |
| `search_vector` | 列（tsvector） | `VideoCache` 表全文搜索向量 |
| `idx_video_search` | GIN 索引 | `search_vector` 搜索加速 |
| `trg_update_search_vector` | 触发器 | 自动维护 search_vector |
| `download_events` | NOTIFY 通道 | 下载状态变更事件通道 |

### 4.3 类型提升

| 字段 | 原类型 | 新类型 | 影响 |
|------|--------|--------|------|
| `VideoCache.sources` | JSON (TEXT) | JSONB | 支持 @> 操作符、GIN 索引 |
| `VideoCache.play_url_raw` | JSON (TEXT) | JSONB | 同上 |
| `AggregatedVideo.sources` | JSON (TEXT) | JSONB | 同上 |

## 5. 依赖关系图

```
REFACTOR-DB-001（数据库引擎迁移）
    ├── blocks → AC-030（tsvector）
    ├── blocks → AC-031（物化视图）
    ├── blocks → AC-032（LISTEN/NOTIFY）
    ├── blocks → AC-033（JSONB）
    └── blocks → AC-034（COPY）

AC-030 → replaces AC-004
AC-031 → replaces AC-003
AC-032 → replaces AC-016

AC-034 → note: 需与 AC-030 协调（tsvector 触发器兼容）
```

## 6. 实施建议顺序

1. **Phase 1**: REFACTOR-DB-001（基础迁移，所有后续 AC 的前提）
2. **Phase 2**: AC-033（JSONB 类型提升，无业务逻辑变更）
3. **Phase 3**: AC-030（tsvector 全文搜索，依赖 JSONB 就绪）
4. **Phase 4**: AC-031（物化视图预聚合，核心性能优化）
5. **Phase 5**: AC-034（批量导入，需与 tsvector 触发器兼容）
6. **Phase 6**: AC-032（LISTEN/NOTIFY，事件推送重构）

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 中文分词器（zhparser）未安装 | AC-030 无法使用 'chinese' 配置 | 降级使用 'simple'，文档标注安装步骤 |
| 物化视图刷新阻塞 | 首页查询卡顿 | 使用 `CONCURRENTLY`，确保唯一索引存在 |
| COPY 绕过触发器 | search_vector 为空 | COPY 后批量 UPDATE 触发器，或 COPY 时预计算 tsvector |
| LISTEN/NOTIFY 连接泄漏 | 数据库连接数耗尽 | 使用连接池，设置 max_overflow 限制 |
| 迁移期间数据丢失 | 生产数据丢失 | 先备份 SQLite，迁移脚本可回滚 |

---

# Delta AC Report — 分类系统 A+D+E 重构

**变更描述**: 分类设置功能增强（智能映射 + 父分类/叶子层级 + 模板预设）
**日期**: 2026-06-07

---

## 影响范围

### 新增 AC

| AC ID | 标题 | 说明 |
|-------|------|------|
| AC-026 | 智能分类映射 | 后端根据分类名称关键词自动匹配推荐系统分类 |
| AC-027 | 分类层级展示 | 按父分类分组展示子分类，支持折叠/展开 |
| AC-028 | 分类映射模板预设 | 一键应用已知资源站的常见分类映射 |

### 修改 AC

| AC ID | 标题 | 影响说明 |
|-------|------|---------|
| AC-002 | 分类映射（互斥约束） | UI 增强，互斥约束核心逻辑不变，impl_files 新增依赖 |

### 受影响组件

| 组件 | 变更类型 | 说明 |
|------|---------|------|
| frontend/src/components/CategorySettings.tsx | 主要修改 | 新增智能映射 UI、层级展示、模板预设按钮 |
| frontend/src/pages/Settings.tsx | 轻微修改 | 可能需调整分类设置区域布局 |
| backend/app/api/sites.py | 增强 | fetch-categories 返回父分类信息；新增 smart-match API |
| backend/app/schemas.py | 新增 | SmartMatchRequest/Response, CategoryTemplate 等 |
| frontend/src/types.ts | 新增 | 相关类型定义 |
| backend/app/models.py | 不变 | Site.categories 字段格式不变 |

### 处理模式

**Delta 变更** — 新增 3 个 AC，AC-002 的 impl_files 范围扩展但核心契约不变。

### 风险点

- **前端性能**: 25+ 站点 x 每站 10-30 个分类 = 可能 500+ 分类条目同时渲染，需虚拟滚动/按需渲染
- **智能映射准确率**: 关键词匹配可能误匹配（如"国产"可能同时匹配"国产剧"和"国产动漫"），需置信度阈值
- **模板维护**: 新增资源站时需更新模板，模板硬编码需文档化

### 用户约束

- 系统分类保持扁平，不新增"电影""连续剧"等父级大类
- 成人内容分类（福利视频、三级伦理等）不纳入系统分类映射
- 直播类（直播、央视、卫视）归入"其他"系统分类
- **前端性能优先**: 分类设置页面不能因数据量大而卡死
