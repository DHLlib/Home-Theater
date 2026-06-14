"""PostgreSQL LISTEN 连接管理：独立长连接 + 自动重连。"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable, Set

logger = logging.getLogger(__name__)

# 指数退避参数
_RECONNECT_BASE_DELAY = 1.0
_RECONNECT_MAX_DELAY = 60.0


class ListenConnectionManager:
    """管理独立的 PostgreSQL LISTEN 连接，支持自动重连。"""

    def __init__(self, dsn: str, channels: Set[str]):
        self.dsn = dsn
        self.channels = channels
        self._handlers: list[Callable[[str, dict], None]] = []
        self._shutdown_event = asyncio.Event()
        self._listen_task: asyncio.Task | None = None

    def add_handler(self, handler: Callable[[str, dict], None]) -> None:
        self._handlers.append(handler)

    def remove_handler(self, handler: Callable[[str, dict], None]) -> None:
        if handler in self._handlers:
            self._handlers.remove(handler)

    async def start(self) -> None:
        """启动监听循环（后台任务）。"""
        self._shutdown_event.clear()
        self._listen_task = asyncio.create_task(self._listen_loop())
        logger.info("LISTEN 管理器已启动 channels=%s", self.channels)

    async def stop(self) -> None:
        """优雅关闭。"""
        self._shutdown_event.set()
        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
        logger.info("LISTEN 管理器已停止")

    async def _listen_loop(self) -> None:
        """主循环：连接 → LISTEN → 接收通知 → 自动重连。"""
        import asyncpg

        delay = _RECONNECT_BASE_DELAY
        while not self._shutdown_event.is_set():
            conn = None
            try:
                conn = await asyncpg.connect(dsn=self.dsn)
                queue: asyncio.Queue = asyncio.Queue()

                def _callback(_connection, pid: int, channel: str, payload: str) -> None:
                    try:
                        queue.put_nowait((pid, channel, payload))
                    except asyncio.QueueFull:
                        pass

                for ch in self.channels:
                    await conn.execute(f"LISTEN {ch}")
                    await conn.add_listener(ch, _callback)
                    logger.debug("LISTEN channel=%s", ch)

                delay = _RECONNECT_BASE_DELAY

                while not self._shutdown_event.is_set():
                    try:
                        pid, channel, payload = await asyncio.wait_for(
                            queue.get(), timeout=1.0
                        )
                        self._on_notification(None, pid, channel, payload)
                    except asyncio.TimeoutError:
                        continue

            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("LISTEN 连接异常，%ss 后重连", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, _RECONNECT_MAX_DELAY)
            finally:
                if conn is not None:
                    try:
                        await conn.close()
                    except Exception:
                        pass

    def _on_notification(self, _connection, pid: int, channel: str, payload: str) -> None:
        """asyncpg 回调：收到 NOTIFY 后分发给所有 handler。"""
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning("收到非法 JSON payload channel=%s", channel)
            return
        for handler in self._handlers:
            try:
                handler(channel, data)
            except Exception:
                logger.exception("LISTEN handler 异常 channel=%s", channel)


def _dsn_for_asyncpg() -> str:
    """将 SQLAlchemy async URL 转换为 asyncpg DSN。"""
    from app.config import settings

    url = settings.db_url
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


# 全局实例
listen_manager = ListenConnectionManager(
    dsn=_dsn_for_asyncpg(),
    channels={"download_events", "health_events", "site_delete_events"},
)
