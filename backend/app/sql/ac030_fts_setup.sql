-- AC-030: PostgreSQL 全文搜索初始化脚本
-- 执行前提：已切换到 PostgreSQL 数据库，VideoCache 表已存在

-- 1. 安装中文全文搜索扩展（如未安装）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. 添加 search_vector 列（如不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'video_cache' AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE video_cache ADD COLUMN search_vector tsvector;
    END IF;
END $$;

-- 3. 创建 GIN 索引（如不存在）
CREATE INDEX IF NOT EXISTS ix_video_cache_search_vector
    ON video_cache USING GIN (search_vector);

-- 4. 辅助函数：动态选择 tsvector 配置
--    若 'chinese' 配置存在则使用，否则降级到 'simple'
CREATE OR REPLACE FUNCTION _ht_ts_config()
RETURNS regconfig AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
        RETURN 'chinese'::regconfig;
    END IF;
    RETURN 'simple'::regconfig;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 5. 创建触发器函数：自动维护 search_vector
CREATE OR REPLACE FUNCTION video_cache_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector(_ht_ts_config(), COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector(_ht_ts_config(), COALESCE(NEW.actors, '')), 'B') ||
        setweight(to_tsvector(_ht_ts_config(), COALESCE(NEW.director, '')), 'C') ||
        setweight(to_tsvector(_ht_ts_config(), COALESCE(NEW.intro, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. 创建触发器（限定字段，减少不必要重算）
DROP TRIGGER IF EXISTS video_cache_search_vector_trigger ON video_cache;
CREATE TRIGGER video_cache_search_vector_trigger
    BEFORE INSERT OR UPDATE OF title, actors, director, intro ON video_cache
    FOR EACH ROW
    EXECUTE FUNCTION video_cache_search_vector_update();

-- 7. 回填现有数据
UPDATE video_cache SET search_vector =
    setweight(to_tsvector(_ht_ts_config(), COALESCE(title, '')), 'A') ||
    setweight(to_tsvector(_ht_ts_config(), COALESCE(actors, '')), 'B') ||
    setweight(to_tsvector(_ht_ts_config(), COALESCE(director, '')), 'C') ||
    setweight(to_tsvector(_ht_ts_config(), COALESCE(intro, '')), 'D')
WHERE search_vector IS NULL;

-- 8. 验证
SELECT
    COUNT(*) AS total_rows,
    COUNT(search_vector) AS rows_with_vector
FROM video_cache;
