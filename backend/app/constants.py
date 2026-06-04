"""项目级常量。业务相关的固定数值集中在此，避免魔法数字分散在代码中。"""

# ------------------------------------------------------------------
# HTTP / 网络
# ------------------------------------------------------------------

HTTP_TIMEOUT_DEFAULT = 8.0
HTTP_TIMEOUT_DOWNLOAD = 30.0
HTTP_TIMEOUT_RESOLVE = 15.0
HTTP_TIMEOUT_FFMPEG = 300.0

# ------------------------------------------------------------------
# 重试策略
# ------------------------------------------------------------------

RETRY_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_SECONDS = 1.0

# ------------------------------------------------------------------
# 下载器
# ------------------------------------------------------------------

DOWNLOAD_CHUNK_SIZE = 64 * 1024
DOWNLOAD_TS_CONCURRENCY = 5
DOWNLOAD_WORKER_EMPTY_SLEEP = 5
DOWNLOAD_WORKER_TASK_INTERVAL = 1
DOWNLOAD_DB_COMMIT_INTERVAL = 5
DOWNLOAD_PAUSE_CHECK_INTERVAL = 3
DOWNLOAD_BATCH_COMMIT_CHUNKS = 100
DOWNLOAD_BATCH_COMMIT_SEGMENTS = 10

# ------------------------------------------------------------------
# 刮削器
# ------------------------------------------------------------------

CRAWLER_BATCH_INSERT_SIZE = 100
CRAWLER_BATCH_VIDEOLIST_SIZE = 200
CRAWLER_PAGE_SIZE_THRESHOLD = 20
CRAWLER_PAGE_CONCURRENCY = 5
CRAWLER_VIDEOLIST_BATCH_SIZE = 20
CRAWLER_SITE_CONCURRENCY = 3

# ------------------------------------------------------------------
# 日志
# ------------------------------------------------------------------

LOG_MAX_BYTES = 10 * 1024 * 1024
LOG_BACKUP_COUNT = 5
