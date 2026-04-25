"""下载器状态机骨架（留 TODO）。

TODO: 真实下载循环（HTTP Range + 写盘 + 进度回调）
"""
from __future__ import annotations

import logging

from app.db import async_session_factory
from app.models import DownloadTask

logger = logging.getLogger(__name__)


async def start(task_id: int) -> None:
    """将任务状态设为 downloading（TODO: 真实启动循环）。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "downloading"
            await session.commit()
    logger.info("TODO: 启动真实下载循环 task_id=%s", task_id)


async def pause(task_id: int) -> None:
    """将任务状态设为 paused。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "paused"
            await session.commit()
    logger.info("任务已暂停 task_id=%s", task_id)


async def resume(task_id: int) -> None:
    """将任务状态设为 downloading（TODO: 续传）。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "downloading"
            await session.commit()
    logger.info("TODO: 恢复下载 task_id=%s", task_id)
