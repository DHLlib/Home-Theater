"""SSE 事件总线：内存中的发布-订阅，基于 asyncio.Queue。"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass


@dataclass
class Event:
    type: str
    payload: dict


_queues: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q = asyncio.Queue(maxsize=100)
    _queues.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _queues.discard(q)


def publish(event: Event) -> None:
    data = json.dumps({"type": event.type, "payload": event.payload})
    dead: set[asyncio.Queue] = set()
    for q in _queues:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            dead.add(q)
    for q in dead:
        _queues.discard(q)
