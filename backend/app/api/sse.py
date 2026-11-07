"""SSE 推送端点：下载进度、站点健康状态实时推送。"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.listen_manager import listen_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sse", tags=["sse"])

HEARTBEAT_INTERVAL = settings.sse_heartbeat_interval  # 秒
# 轮询关闭信号的间隔：决定 lifespan 关闭时流多久退出。
# 不能取 HEARTBEAT_INTERVAL（30s），否则关闭要白等半分钟。
POLL_INTERVAL = 1.0

# 进程关闭时置位：让所有 SSE 流主动结束。
# 注意：uvicorn 的优雅关闭是先等连接结束、再跑 lifespan shutdown，
# 所以这条路径只覆盖 TestClient / 程序内直接关闭；
# 真正的 Ctrl+C 由 `--timeout-graceful-shutdown` 兜底（见 start.ps1 / Dockerfile）。
_shutdown = asyncio.Event()


def reset_streams() -> None:
    """启动时复位，避免 reload / 重启后事件一直处于置位状态。"""
    _shutdown.clear()


def shutdown_streams() -> None:
    """关闭阶段调用：让所有在途 SSE 连接自行结束。"""
    _shutdown.set()


async def _event_stream(request: Request):
    q: asyncio.Queue = asyncio.Queue(maxsize=100)

    def _handler(channel: str, data: dict) -> None:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            pass

    listen_manager.add_handler(_handler)
    last_beat = time.monotonic()
    try:
        # 不调用 request.is_disconnected()：它在 uvicorn 的 asyncio 栈里会阻塞在
        # 底层 receive 上，反而让事件推不出去。客户端断开时 uvicorn 会取消本任务，
        # finally 里的 handler 清理照常执行。
        while not _shutdown.is_set():
            try:
                data = await asyncio.wait_for(q.get(), timeout=POLL_INTERVAL)
            except asyncio.TimeoutError:
                if time.monotonic() - last_beat >= HEARTBEAT_INTERVAL:
                    last_beat = time.monotonic()
                    yield ":heartbeat\n\n"
                continue
            yield f"data: {json.dumps(data)}\n\n"
    finally:
        listen_manager.remove_handler(_handler)


@router.get("")
async def sse(request: Request):
    return StreamingResponse(
        _event_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # 反代不要缓冲事件流
            "X-Accel-Buffering": "no",
        },
    )
