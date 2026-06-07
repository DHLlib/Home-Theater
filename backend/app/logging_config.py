import logging
import os
from logging.handlers import RotatingFileHandler

from app.constants import LOG_BACKUP_COUNT, LOG_MAX_BYTES

LOG_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")

# 日志分类映射：前缀 -> 文件名
# 优先级按列表顺序，先匹配的先命中
LOG_CATEGORIES: list[tuple[str, str]] = [
    ("app.api.", "api.log"),
    ("app.services.source_client", "source.log"),
    ("app.services.scheduler", "crawler.log"),
    ("app.services.crawler", "crawler.log"),
    ("app.services.downloader", "download.log"),
]
DEFAULT_LOG = "app.log"


class _NamePrefixFilter(logging.Filter):
    """按 logger name 前缀匹配。"""

    def __init__(self, prefix: str):
        super().__init__()
        self.prefix = prefix

    def filter(self, record: logging.LogRecord) -> bool:
        return record.name.startswith(self.prefix)


class _DefaultFilter(logging.Filter):
    """匹配未被任何分类过滤器捕获的日志（兜底）。"""

    def __init__(self, prefixes: list[str]):
        super().__init__()
        self.prefixes = prefixes

    def filter(self, record: logging.LogRecord) -> bool:
        return not any(record.name.startswith(p) for p in self.prefixes)


def _make_handler(log_file: str, level: int, formatter: logging.Formatter) -> RotatingFileHandler:
    path = os.path.join(LOG_DIR, log_file)
    handler = RotatingFileHandler(
        path,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setLevel(level)
    handler.setFormatter(formatter)
    return handler


def setup_logging() -> None:
    os.makedirs(LOG_DIR, exist_ok=True)

    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    formatter = logging.Formatter(fmt)
    datefmt = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(fmt, datefmt=datefmt)

    # 按分类创建独立的文件 handler
    categorized_prefixes: list[str] = []
    category_handlers: list[RotatingFileHandler] = []
    for prefix, filename in LOG_CATEGORIES:
        categorized_prefixes.append(prefix)
        handler = _make_handler(filename, logging.INFO, formatter)
        handler.addFilter(_NamePrefixFilter(prefix))
        category_handlers.append(handler)

    # 兜底文件：未被分类的日志
    default_handler = _make_handler(DEFAULT_LOG, logging.INFO, formatter)
    default_handler.addFilter(_DefaultFilter(categorized_prefixes))

    class _ExcludeCrawlerFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            return not record.name.startswith((
                "app.services.source_client",
                "app.services.scheduler",
                "app.services.crawler",
            ))

    # 控制台：输出非刮削日志（刮削日志只写入文件）
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(_ExcludeCrawlerFilter())

    # 降低第三方库噪音
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers = []
    root.addHandler(default_handler)
    for h in category_handlers:
        root.addHandler(h)
    root.addHandler(console_handler)
