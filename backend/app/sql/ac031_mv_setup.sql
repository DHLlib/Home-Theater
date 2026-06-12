-- AC-031: PostgreSQL 物化视图预聚合初始化脚本
-- 执行前提：已切换到 PostgreSQL 数据库，video_cache 表已存在且有数据
SET enable_mergejoin = off;
-- 0. 删除旧视图（确保结构更新能生效）
DROP MATERIALIZED VIEW IF EXISTS mv_aggregated_videos CASCADE;

-- 1. 创建物化视图：按 (归一title, year) 聚合多源视频
--    聚合逻辑与后端 _refresh_aggregated_cache() 保持一致
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_aggregated_videos AS
WITH
-- 阶段 0：归一化标题
norm AS (
    SELECT
        title,
        year,
        poster_url,
        site_id,
        original_id,
        type_name,
        type_id,
        remarks,
        source_updated_at,
        LOWER(REGEXP_REPLACE(TRIM(title), '[《》<>]', '', 'g')) AS norm_title
    FROM video_cache
),
-- 阶段 1：按 (norm_title, year) 聚合
-- 注意：不按 poster_url 分组，避免同一视频因封面不同拆成多条；用 MAX 优先取非空封面
raw_agg AS (
    SELECT
        title,
        year,
        MAX(poster_url) AS poster_url,
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
        ARRAY_AGG(DISTINCT type_name) FILTER (WHERE type_name IS NOT NULL) AS types,
        MAX(source_updated_at) AS latest_updated_at,
        COUNT(*) AS source_count,
        norm_title
    FROM norm
    GROUP BY norm_title, year, title
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
        a.types,
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
        a.types,
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
    types,
    latest_updated_at,
    source_count
FROM combined;

-- 2. 创建唯一索引（REFRESH MATERIALIZED VIEW CONCURRENTLY 必需）
CREATE UNIQUE INDEX IF NOT EXISTS ix_mv_aggregated_videos_id
    ON mv_aggregated_videos (id);

-- 3. 创建 GIN 索引加速 sources JSON 查询（可选）
CREATE INDEX IF NOT EXISTS ix_mv_aggregated_videos_sources
    ON mv_aggregated_videos USING GIN (sources);

-- 3.5 创建 GIN 索引加速 types 数组查询（推荐 API 用）
CREATE INDEX IF NOT EXISTS ix_mv_aggregated_videos_types
    ON mv_aggregated_videos USING GIN (types);

-- 4. 创建普通索引加速排序
CREATE INDEX IF NOT EXISTS ix_mv_aggregated_videos_updated
    ON mv_aggregated_videos (latest_updated_at DESC);

-- 5. 首次刷新
REFRESH MATERIALIZED VIEW mv_aggregated_videos;

-- 7. 预计算推荐视频物化视图
--    把 6+3+3+3 的复杂分类计算提前完成，API 直接 O(1) 读取
DROP MATERIALIZED VIEW IF EXISTS mv_recommended_videos CASCADE;

CREATE MATERIALIZED VIEW mv_recommended_videos AS
WITH
parent_cats AS (
    SELECT id, name FROM system_categories
    WHERE parent_id IS NULL AND name IN ('电影', '连续剧', '综艺', '动漫')
),
child_cats AS (
    SELECT p.name as parent_name, c.name as child_name
    FROM parent_cats p
    JOIN system_categories c ON c.parent_id = p.id
),
matched AS (
    SELECT DISTINCT ON (mv.title, pc.parent_name)
        mv.title,
        mv.year,
        mv.poster_url,
        mv.latest_updated_at,
        mv.source_count,
        mv.sources,
        pc.parent_name
    FROM mv_aggregated_videos mv
    JOIN child_cats pc ON pc.child_name = ANY(mv.types)
    ORDER BY mv.title, pc.parent_name, mv.latest_updated_at DESC NULLS LAST
),
ranked AS (
    SELECT *,
        ROW_NUMBER() OVER (
            PARTITION BY parent_name ORDER BY latest_updated_at DESC NULLS LAST
        ) as rn
    FROM matched
)
SELECT
    ROW_NUMBER() OVER (
        ORDER BY
            CASE parent_name
                WHEN '电影' THEN 1
                WHEN '连续剧' THEN 2
                WHEN '综艺' THEN 3
                WHEN '动漫' THEN 4
            END,
            rn
    )::INTEGER AS id,
    title,
    year,
    poster_url,
    latest_updated_at,
    source_count,
    sources,
    parent_name
FROM ranked
WHERE rn <= CASE parent_name
    WHEN '电影' THEN 6
    WHEN '连续剧' THEN 3
    WHEN '综艺' THEN 3
    WHEN '动漫' THEN 3
END;

CREATE UNIQUE INDEX IF NOT EXISTS ix_mv_recommended_videos_id
    ON mv_recommended_videos (id);

GRANT SELECT ON TABLE mv_recommended_videos TO PUBLIC;

-- 8. 验证推荐视图
SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT parent_name) AS parent_categories
FROM mv_recommended_videos;
