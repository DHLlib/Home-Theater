"""事件发送封装：通过 PostgreSQL NOTIFY 发送事件。"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_ALLOWED_CHANNELS = frozenset({"download_events", "health_events", "site_delete_events"})


def _quote_ident(name: str) -> str:
    """将 channel 名安全地引用为 PostgreSQL 标识符。

    仅允许小写字母、数字和下划线组成的 bare identifier；其余字符一律拒绝，
    避免通过转义序列注入。
    """
    if not name or not name.isidentifier() or not name.islower():
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return f'"{name}"'


@dataclass
class Event:
    type: str
    payload: dict


class NotifySender:
    """统一的事件发送器，通过持久数据库连接执行 NOTIFY。"""

    def __init__(self):
        self._conn = None
        self._lock = asyncio.Lock()

    async def send(self, channel: str, event: Event) -> None:
        """发送事件到指定 channel。"""
        if channel not in _ALLOWED_CHANNELS:
            raise ValueError(f"Invalid channel: {channel}")
        payload = json.dumps({"type": event.type, "payload": event.payload})
        try:
            import asyncpg

            async with self._lock:
                if self._conn is None or self._conn.is_closed():
                    self._conn = await asyncpg.connect(dsn=self._dsn_for_asyncpg())
                # PostgreSQL NOTIFY 不支持参数占位符；channel 名经标识符校验+引用，
                # payload 用 dollar-quoting 安全嵌入
                await self._conn.execute(
                    f"NOTIFY {_quote_ident(channel)}, {self._dollar_quote(payload)}"
                )
        except Exception:
            logger.exception("NOTIFY 发送失败 channel=%s", channel)
            # 标记连接失效，下次发送时重建
            self._conn = None

    @staticmethod
    def _dollar_quote(s: str) -> str:
        """使用 PostgreSQL dollar-quoting 避免字符串转义问题。"""
        tag = "notify"
        while f"${tag}$" in s:
            tag += "x"
        return f"${tag}${s}${tag}$"

    def _dsn_for_asyncpg(self) -> str:
        """将 SQLAlchemy async URL 转换为 asyncpg DSN。"""
        from app.config import settings

        url = settings.db_url
        if url.startswith("postgresql+asyncpg://"):
            return url.replace("postgresql+asyncpg://", "postgresql://", 1)
        return url


notify_sender = NotifySender()
