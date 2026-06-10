import logging
import os
from logging.handlers import RotatingFileHandler

from app.config import settings
from app.constants import LOG_BACKUP_COUNT, LOG_MAX_BYTES

LOG_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")

# 日志分类映射：前缀 -> 文件名
LOG_CATEGORIES: list[tuple[str, str]] = [
    ("app.api.", "api.log"),
    ("app.services.source_client", "source.log"),
    ("app.services.scheduler", "crawler.log"),
    ("app.services.crawler", "crawler.log"),
    ("app.services.downloader", "download.log"),
]
DEFAULT_LOG = "app.log"


def _level_from_string(level: str) -> int:
    return getattr(logging, level.upper(), logging.INFO)


class _NamePrefixFilter(logging.Filter):
    def __init__(self, prefix: str):
        super().__init__()
        self.prefix = prefix

    def filter(self, record: logging.LogRecord) -> bool:
        return record.name.startswith(self.prefix)


class _DefaultFilter(logging.Filter):
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

    level = _level_from_string(settings.log_level)

    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(fmt, datefmt=datefmt)

    categorized_prefixes: list[str] = []
    category_handlers: list[RotatingFileHandler] = []
    for prefix, filename in LOG_CATEGORIES:
        categorized_prefixes.append(prefix)
        handler = _make_handler(filename, level, formatter)
        handler.addFilter(_NamePrefixFilter(prefix))
        category_handlers.append(handler)

    default_handler = _make_handler(DEFAULT_LOG, level, formatter)
    default_handler.addFilter(_DefaultFilter(categorized_prefixes))

    class _ExcludeCrawlerFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            return not record.name.startswith((
                "app.services.source_client",
                "app.services.scheduler",
                "app.services.crawler",
            ))

    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(_ExcludeCrawlerFilter())

    # 第三方库噪音控制（仅在根级别 >= INFO 时生效）
    if level >= logging.INFO:
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = []
    root.addHandler(default_handler)
    for h in category_handlers:
        root.addHandler(h)
    root.addHandler(console_handler)
