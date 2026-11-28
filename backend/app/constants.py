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

# 站点 WAF（Cloudflare 等）人机校验的等待梯度：挑战通常是短时的（数十秒到两分钟），
# 补全任务按此梯度原地等待后重试同一批，而不是把整站判死、丢掉 1 万多条待补条目。
WAF_CHALLENGE_BACKOFF_SECONDS = (10.0, 30.0, 60.0)

# ------------------------------------------------------------------
# 下载器
# ------------------------------------------------------------------

DOWNLOAD_CHUNK_SIZE = 64 * 1024
DOWNLOAD_TS_CONCURRENCY = 5
DOWNLOAD_WORKER_EMPTY_SLEEP = 5
DOWNLOAD_WORKER_TASK_INTERVAL = 1
DOWNLOAD_DB_COMMIT_INTERVAL = 5
DOWNLOAD_PAUSE_CHECK_INTERVAL = 1
DOWNLOAD_BATCH_COMMIT_CHUNKS = 100
DOWNLOAD_BATCH_COMMIT_SEGMENTS = 10

# ------------------------------------------------------------------
# 刮削器
# ------------------------------------------------------------------

CRAWLER_BATCH_INSERT_SIZE = 500
CRAWLER_BATCH_VIDEOLIST_SIZE = 200
CRAWLER_PAGE_SIZE_THRESHOLD = 20
CRAWLER_PAGE_CONCURRENCY = 5
# 单次增量抓取最多翻多少页：站点历史页可能上百页，不设上限会长时间
# 占满网络与数据库，和用户请求抢资源
CRAWLER_INCREMENTAL_MAX_PAGES = 30
CRAWLER_VIDEOLIST_BATCH_SIZE = 20
CRAWLER_SITE_CONCURRENCY = 6

# 每日自动全量补 videolist 的时间（本地时间）
CRAWLER_FILL_VIDEOLIST_HOUR = 4
CRAWLER_FILL_VIDEOLIST_MINUTE = 0

# ------------------------------------------------------------------
# 日志
# ------------------------------------------------------------------

LOG_MAX_BYTES = 10 * 1024 * 1024
LOG_BACKUP_COUNT = 5

# ------------------------------------------------------------------
# 智能分类匹配（AC-026）
# ------------------------------------------------------------------

SMART_MATCH_AUTO_THRESHOLD = 0.7    # 置信度 ≥ 此值直接自动映射
SMART_MATCH_SUGGEST_THRESHOLD = 0.3  # 置信度 ≥ 此值显示为建议，< 此值为未识别

# ------------------------------------------------------------------
# 站点批量探测
# ------------------------------------------------------------------

BATCH_PROBE_LIMIT = 100              # 单次批量探测/嗅探最多站点数（并发 5、单站 6 秒预算）
BATCH_PROBE_CONCURRENCY = 5          # 批量探测并发请求数
BATCH_PROBE_TIMEOUT = 6.0            # 单站检测有界总超时（秒），超时按该站失败处理

# 删除站点时等待全局操作锁的上限（秒）与轮询间隔：
# 全量刮削可能长时间持锁，删除要排队等待并持续上报「在等谁」，
# 而不是 60 秒后直接失败、前端一直停在「删除中…」。
SITE_DELETE_LOCK_WAIT_SECONDS = 15 * 60
SITE_DELETE_LOCK_POLL_SECONDS = 10.0

# ------------------------------------------------------------------
# 统一维护任务协调器
# ------------------------------------------------------------------

MAINTENANCE_PROGRESS_FLUSH_SECONDS = 1.0    # 进度持久化 / SSE 推送节流间隔（终态不受限）
MAINTENANCE_LIST_LIMIT_MAX = 100            # list_jobs limit 上限
MAINTENANCE_SHUTDOWN_TIMEOUT_SECONDS = 10.0  # 关闭时等待任务合作取消的总预算
FULL_CRAWL_LOCK_TIMEOUT = 5.0                 # 全量刮削等待全局操作锁的上限（秒）
CLEANUP_PROGRESS_REPORT_SECONDS = 1.0         # 清理任务向协调器回报进度的间隔（秒）
CATEGORY_QUEUE_POLL_SECONDS = 0.35           # 分类挂载后端队列空闲轮询间隔（秒）
CLEANUP_LOCK_TIMEOUT = 5.0                    # 清理任务等待全局操作锁的上限（秒）

# ------------------------------------------------------------------
# 播放质量反馈与来源推荐
# ------------------------------------------------------------------

PLAYBACK_EVENT_BATCH_LIMIT = 50
PLAYBACK_EVENT_RETENTION_DAYS = 90
PLAYBACK_QUALITY_WINDOW_DAYS = 30
PLAYBACK_QUALITY_MIN_ATTEMPTS = 1
PLAYBACK_QUALITY_MIN_SUCCESS_RATE = 0.65
PLAYBACK_QUALITY_COLD_SCORE = 50.0
PLAYBACK_QUALITY_SUCCESS_WEIGHT = 0.60
PLAYBACK_QUALITY_STARTUP_WEIGHT = 0.25
PLAYBACK_QUALITY_SMOOTHNESS_WEIGHT = 0.15
PLAYBACK_STARTUP_BEST_MS = 1500
PLAYBACK_STARTUP_WORST_MS = 30000

# 当前视频的媒体信息分析：单任务、逐级处理，不做全库主动采样
MEDIA_ANALYSIS_MAX_SOURCES = 2
MEDIA_ANALYSIS_TIMEOUT_SECONDS = 4.0
MEDIA_METADATA_TTL_SECONDS = 24 * 60 * 60
MEDIA_METADATA_FAILURE_TTL_SECONDS = 5 * 60
PLAYBACK_GUARD_HEARTBEAT_SECONDS = 10
PLAYBACK_GUARD_EXPIRY_SECONDS = 20
PLAYBACK_GUARD_POLL_SECONDS = 0.5
FEATURE_SETTINGS_CACHE_TTL_SECONDS = 5.0

# 轻量增强仅服务当前选中的视频，单 ffmpeg 进程、单线程、实时读取
PLAYBACK_ENHANCEMENT_TARGET_HEIGHT = 1080
PLAYBACK_ENHANCEMENT_START_TIMEOUT_SECONDS = 12.0
PLAYBACK_ENHANCEMENT_IDLE_SECONDS = 30.0

# ------------------------------------------------------------------
# 视频列表 / 聚合查询
# ------------------------------------------------------------------

AGGREGATION_RAW_LIMIT_MULTIPLIER = 20  # 聚合查询时原始记录放大倍数
                                       # 同一视频可能在多站点出现，放大后保证聚合结果充足

# ------------------------------------------------------------------
# HTTP 请求头
# ------------------------------------------------------------------

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
