"""SSE 推送端点：下载进度、站点健康状态实时推送。"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.listen_manager import listen_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sse", tags=["sse"])

HEARTBEAT_INTERVAL = settings.sse_heartbeat_interval  # 秒


async def _event_stream():
    q: asyncio.Queue = asyncio.Queue(maxsize=100)

    def _handler(channel: str, data: dict) -> None:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            pass

    listen_manager.add_handler(_handler)
    try:
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_INTERVAL)
                yield f"data: {json.dumps(data)}\n\n"
            except asyncio.TimeoutError:
                yield ":heartbeat\n\n"
    finally:
        listen_manager.remove_handler(_handler)


@router.get("")
async def sse():
    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
