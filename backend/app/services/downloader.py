"""下载器状态机：HTTP Range 断点续传 + 暂停/恢复 + 错误分类。"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import aiofiles
import httpx
from sqlalchemy import select

from app.db import async_session_factory
from app.models import DownloadTask, Site
from app.services.health import probe

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------

async def start(task_id: int) -> None:
    """将任务状态设为 downloading（由 worker 循环真正调度）。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "downloading"
            await session.commit()
    logger.info("任务已标记为 downloading task_id=%s", task_id)


async def pause(task_id: int) -> None:
    """将任务状态设为 paused；worker 会在下一次 chunk 后退出。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "paused"
            await session.commit()
    logger.info("任务已暂停 task_id=%s", task_id)


async def resume(task_id: int) -> None:
    """将任务状态设为 queued，worker 会重新 pick 并续传。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task and task.status == "paused":
            task.status = "queued"
            await session.commit()
    logger.info("任务已恢复 task_id=%s", task_id)


# ---------------------------------------------------------------------------
# Worker 循环
# ---------------------------------------------------------------------------

async def download_worker() -> None:
    """后台循环：持续消费 queued 任务。"""
    logger.info("下载 worker 已启动")
    while True:
        task_id = await _pick_next_task()
        if task_id is None:
            await asyncio.sleep(5)
            continue

        try:
            await _run_download(task_id)
        except Exception:
            logger.exception("下载任务异常终止 task_id=%s", task_id)
            await _set_error(task_id, "connection_error: 未知异常，请重试")

        await asyncio.sleep(1)


async def _pick_next_task() -> int | None:
    """原子性地取最老的 queued 任务并设为 downloading。"""
    async with async_session_factory() as session:
        stmt = (
            select(DownloadTask)
            .where(DownloadTask.status == "queued")
            .order_by(DownloadTask.created_at)
            .limit(1)
        )
        result = await session.execute(stmt)
        task: DownloadTask | None = result.scalar_one_or_none()
        if task is None:
            return None
        task.status = "downloading"
        await session.commit()
        return task.id


# ---------------------------------------------------------------------------
# 核心下载逻辑
# ---------------------------------------------------------------------------

async def _run_download(task_id: int) -> None:
    """执行一次完整的（或部分）下载。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task is None:
            logger.warning("任务不存在 task_id=%s", task_id)
            return

        # 如果已被外部暂停，直接退出
        if task.status == "paused":
            return

        site = await session.get(Site, task.source_site_id)
        site_id = site.id if site else task.source_site_id
        base_url = site.base_url if site else ""
        site_name = site.name if site else ""

        # 创建目录
        Path(task.file_path).parent.mkdir(parents=True, exist_ok=True)

        headers = {"Range": f"bytes={task.downloaded_bytes}-"}

        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                async with client.stream("GET", task.url, headers=headers) as resp:
                    if resp.status_code == 404:
                        await _set_error(task_id, "file_removed: 资源已失效")
                        return
                    elif resp.status_code >= 400:
                        error_msg = await _classify_http_error(site_id, base_url, site_name, resp.status_code)
                        await _set_error(task_id, error_msg)
                        return

                    # 计算总大小
                    if task.total_bytes is None:
                        content_length = resp.headers.get("content-length")
                        if content_length is not None:
                            try:
                                remaining = int(content_length)
                                task.total_bytes = task.downloaded_bytes + remaining
                                await session.commit()
                            except ValueError:
                                pass

                    # 流式写入
                    try:
                        async with aiofiles.open(task.file_path, "ab") as f:
                            async for chunk in resp.aiter_bytes(CHUNK_SIZE):
                                # 检查是否被暂停
                                await session.refresh(task)
                                if task.status == "paused":
                                    logger.info("任务被暂停 task_id=%s", task_id)
                                    return

                                await f.write(chunk)
                                task.downloaded_bytes += len(chunk)
                                await session.commit()
                    except Exception as exc:
                        logger.exception("写盘异常 task_id=%s", task_id)
                        await _set_error(task_id, f"connection_error: 写盘失败：{exc}")
                        return

                    # 完成
                    task.status = "done"
                    await session.commit()
                    logger.info("下载完成 task_id=%s path=%s", task_id, task.file_path)
        except httpx.TimeoutException as exc:
            error_msg = await _classify_network_error(site_id, base_url, site_name, str(exc))
            await _set_error(task_id, error_msg)
            return
        except httpx.HTTPError as exc:
            error_msg = await _classify_network_error(site_id, base_url, site_name, str(exc))
            await _set_error(task_id, error_msg)
            return
        except Exception as exc:
            await _set_error(task_id, f"connection_error: {exc}")
            return


# ---------------------------------------------------------------------------
# 错误分类
# ---------------------------------------------------------------------------

async def _classify_http_error(site_id: int, base_url: str, site_name: str, status_code: int) -> str:
    """HTTP 4xx/5xx 时 probe 站点，区分 site_unavailable / connection_error。"""
    result = await probe(site_id, base_url, site_name)
    if not result.ok:
        return f"site_unavailable: HTTP {status_code}，站点探测也失败（{result.error}）"
    return f"connection_error: HTTP {status_code}，但站点可连通"


async def _classify_network_error(site_id: int, base_url: str, site_name: str, detail: str) -> str:
    """网络层异常时 probe 站点，区分 site_unavailable / connection_error。"""
    result = await probe(site_id, base_url, site_name)
    if not result.ok:
        return f"site_unavailable: {detail}"
    return f"connection_error: {detail}"


async def _set_error(task_id: int, error_msg: str) -> None:
    """将任务置为 error 并记录原因。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "error"
            task.error = error_msg
            await session.commit()
    logger.error("任务出错 task_id=%s error=%s", task_id, error_msg)
