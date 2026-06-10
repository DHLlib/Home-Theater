# ATDD: AC-031 — 物化视图预聚合（PostgreSQL MATERIALIZED VIEW）

## 场景一：首页从物化视图读取
**Given** 后台已完成刮削，物化视图已创建且已刷新
**When** 用户打开首页（`GET /api/videos`，无 category 参数）
**Then** 从物化视图 `mv_aggregated_videos` 读取数据
**And** 响应时间 < 20ms
**And** 返回聚合去重后的视频列表（按名称 + 年份聚合）

## 场景二：刮削完成后自动刷新
**Given** 全量或增量刮削任务完成
**When** 触发物化视图刷新
**Then** 执行 `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_aggregated_videos`
**And** 刷新过程不阻塞读查询（前端无感知）
**And** 刷新完成时间 < 30s（100000 条记录）

## 场景三：同名不同年视为不同视频
**Given** 数据库中存在同名但不同年份的视频，如《无间道》2002 和《无间道》2020
**When** 查询物化视图
**Then** 返回两条独立记录（聚合键为 normalize_title + year）
**And** 每条记录包含各自的年份和 sources 列表

## 场景四：year=None 回填最频繁年份
**Given** 存在多条同名记录，其中部分 year 为 NULL，其余 year=2020（出现最频繁）
**When** 物化视图聚合计算
**Then** year=NULL 的记录被归入 year=2020 的聚合桶
**And** 聚合后该视频显示年份为 2020

## 场景五：唯一索引确保 CONCURRENTLY 可用
**Given** 物化视图已创建
**When** 检查索引
**Then** 存在唯一索引 `CREATE UNIQUE INDEX idx_mv_agg_unique ON mv_aggregated_videos(id)`
**And** 该索引是 `REFRESH MATERIALIZED VIEW CONCURRENTLY` 的前提条件

## 场景六：按系统分类查询不走物化视图
**Given** 用户点击某个系统分类（如"动作片"）
**When** 请求 `GET /api/videos?category=动作片`
**Then** 走实时聚合查询（原聚合逻辑）
**And** 不读取物化视图（物化视图仅服务于无 category 参数的首页）

## 数据模型变更
```sql
-- 移除旧双缓冲表
DROP TABLE IF EXISTS aggregated_videos_v1;
DROP TABLE IF EXISTS aggregated_videos_v2;

-- 创建物化视图
CREATE MATERIALIZED VIEW mv_aggregated_videos AS
WITH year_filled AS (
    SELECT
        id,
        vod_name,
        COALESCE(year, (
            SELECT mode() WITHIN GROUP (ORDER BY year)
            FROM videocache v2
            WHERE normalize_title(v2.vod_name) = normalize_title(v1.vod_name)
            AND year IS NOT NULL
        )) AS filled_year,
        normalize_title(vod_name) AS norm_title,
        poster_url,
        vod_actor,
        type_name,
        remarks,
        sources
    FROM videocache v1
),
aggregated AS (
    SELECT
        MIN(id) AS id,
        vod_name,
        filled_year AS year,
        norm_title,
        MAX(poster_url) AS poster_url,
        MAX(vod_actor) AS vod_actor,
        array_agg(DISTINCT type_name) AS type_names,
        jsonb_agg(sources) AS sources
    FROM year_filled
    GROUP BY vod_name, filled_year, norm_title
)
SELECT * FROM aggregated;

-- 唯一索引（CONCURRENTLY 刷新必需）
CREATE UNIQUE INDEX idx_mv_agg_unique ON mv_aggregated_videos(id);
CREATE INDEX idx_mv_agg_year ON mv_aggregated_videos(year);
```

## 性能验收指标
| 指标 | 目标值 |
|------|--------|
| 首页查询响应时间 | < 20ms |
| 物化视图刷新时间（100000 条） | < 30s |
| 刷新期间读查询阻塞时间 | 0ms（CONCURRENTLY） |
| 物化视图存储占用 | < 原始表 50% |

## 错误场景
| 场景 | 输入 | 期望结果 |
|------|------|----------|
| 物化视图未刷新 | 刮削后未触发刷新 | 返回旧数据，不报错 |
| 唯一索引缺失 | 索引被误删 | `REFRESH CONCURRENTLY` 失败，回退到阻塞刷新并报警 |
| 首次创建无数据 | 空表 | 物化视图为空，查询返回空数组 |

## 依赖关系
- **blockedBy**: REFACTOR-DB-001
- **replaces**: AC-003（预聚合缓存功能，从双缓冲表升级为物化视图）
