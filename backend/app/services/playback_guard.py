"""个人部署的播放保护：播放会话存活期间，让后台网络任务退让。"""
from __future__ import annotations

import asyncio
import time

from app.constants import (
    PLAYBACK_GUARD_EXPIRY_SECONDS,
    PLAYBACK_GUARD_POLL_SECONDS,
)

_sessions: dict[str, float] = {}


def _expire() -> None:
    now = time.monotonic()
    for session_id, deadline in list(_sessions.items()):
        if deadline <= now:
            _sessions.pop(session_id, None)


def heartbeat(session_id: str) -> None:
    if not session_id:
        return
    _sessions[session_id] = time.monotonic() + PLAYBACK_GUARD_EXPIRY_SECONDS


def stop(session_id: str) -> None:
    _sessions.pop(session_id, None)


def clear() -> None:
    _sessions.clear()


def is_playback_active() -> bool:
    _expire()
    return bool(_sessions)


async def wait_until_idle(stop_event: asyncio.Event | None = None) -> None:
    while is_playback_active():
        if stop_event is not None and stop_event.is_set():
            return
        await asyncio.sleep(PLAYBACK_GUARD_POLL_SECONDS)
