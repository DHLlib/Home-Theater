"""事件发送封装：通过 PostgreSQL NOTIFY 发送事件。"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_ALLOWED_CHANNELS = frozenset({"download_events", "health_events"})


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
                # PostgreSQL NOTIFY 不支持参数占位符，使用 dollar-quoting 安全嵌入 payload
                await self._conn.execute(
                    f"NOTIFY {channel}, {self._dollar_quote(payload)}"
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
