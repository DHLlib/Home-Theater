-- AC-031: PostgreSQL 物化视图预聚合初始化脚本
-- 执行前提：已切换到 PostgreSQL 数据库，video_cache 表已存在且有数据

-- 1. 创建物化视图：按 (归一title, year) 聚合多源视频
--    聚合逻辑与后端 _refresh_aggregated_cache() 保持一致
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_aggregated_videos AS
WITH
-- 阶段 1：归一化标题 + 按 (norm_title, year) 分组
raw_agg AS (
    SELECT
        title,
        year,
        poster_url,
        jsonb_agg(
            jsonb_build_object(
                'site_id', site_id,
                'original_id', original_id,
                'type', type_name,
                'type_id', type_id,
                'remarks', remarks,
                'updated_at', source_updated_at
            )
        ) AS sources,
        MAX(source_updated_at) AS latest_updated_at,
        COUNT(*) AS source_count,
        -- 归一化标题（去《》/ 首尾空白 / lower）
        LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')) AS norm_title
    FROM video_cache
    GROUP BY
        LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')),
        year,
        title,
        poster_url
),
-- 阶段 2：计算每个归一化标题下出现最频繁的非 NULL year
year_freq AS (
    SELECT
        LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')) AS norm_title,
        year,
        COUNT(*) AS freq,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g'))
            ORDER BY COUNT(*) DESC, year DESC
        ) AS rn
    FROM video_cache
    WHERE year IS NOT NULL
    GROUP BY LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')), year
),
best_year AS (
    SELECT norm_title, year AS best_year
    FROM year_freq
    WHERE rn = 1
),
-- 阶段 3：合并可回填与不可回填的记录
combined AS (
    SELECT
        a.title,
        COALESCE(a.year, byw.best_year) AS year,
        a.poster_url,
        a.sources,
        a.latest_updated_at,
        a.source_count
    FROM raw_agg a
    LEFT JOIN best_year byw ON a.norm_title = byw.norm_title
    WHERE a.year IS NOT NULL OR byw.best_year IS NOT NULL

    UNION ALL

    SELECT
        a.title,
        NULL AS year,
        a.poster_url,
        a.sources,
        a.latest_updated_at,
        a.source_count
    FROM raw_agg a
    LEFT JOIN best_year byw ON a.norm_title = byw.norm_title
    WHERE a.year IS NULL AND byw.best_year IS NULL
)
-- 阶段 4：全局 ROW_NUMBER() 生成唯一 id
SELECT
    ROW_NUMBER() OVER (
        ORDER BY COALESCE(latest_updated_at, '') DESC
    )::INTEGER AS id,
    title,
    year,
    poster_url,
    sources,
    latest_updated_at,
    source_count
FROM combined;

-- 2. 创建唯一索引（REFRESH MATERIALIZED VIEW CONCURRENTLY 必需）
CREATE UNIQUE INDEX IF NOT EXISTS ix_mv_aggregated_videos_id
    ON mv_aggregated_videos (id);

-- 3. 创建 GIN 索引加速 sources JSON 查询（可选）
CREATE INDEX IF NOT EXISTS ix_mv_aggregated_videos_sources
    ON mv_aggregated_videos USING GIN (sources);

-- 4. 创建普通索引加速排序
CREATE INDEX IF NOT EXISTS ix_mv_aggregated_videos_updated
    ON mv_aggregated_videos (latest_updated_at DESC);

-- 5. 首次刷新
REFRESH MATERIALIZED VIEW mv_aggregated_videos;

-- 6. 验证
SELECT
    COUNT(*) AS total_rows,
    MAX(source_count) AS max_sources,
    AVG(source_count)::NUMERIC(10,2) AS avg_sources
FROM mv_aggregated_videos;
