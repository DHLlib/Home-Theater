"""SSE 推送端点：下载进度、站点健康状态实时推送。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.event_bus import subscribe, unsubscribe

router = APIRouter(prefix="/sse", tags=["sse"])

HEARTBEAT_INTERVAL = 30  # 秒


async def _event_stream():
    q = subscribe()
    try:
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_INTERVAL)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                yield ":heartbeat\n\n"
    finally:
        unsubscribe(q)


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
