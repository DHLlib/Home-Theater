"""下载器状态机：HTTP Range 断点续传 + m3u8 .ts 下载 + 暂停/恢复 + 错误分类。"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import aiofiles
import httpx
from sqlalchemy import select, update

from app.constants import DEFAULT_USER_AGENT

from app.constants import (
    DOWNLOAD_BATCH_COMMIT_CHUNKS,
    DOWNLOAD_BATCH_COMMIT_SEGMENTS,
    DOWNLOAD_CHUNK_SIZE,
    DOWNLOAD_DB_COMMIT_INTERVAL,
    DOWNLOAD_PAUSE_CHECK_INTERVAL,
    DOWNLOAD_TS_CONCURRENCY,
    DOWNLOAD_WORKER_EMPTY_SLEEP,
    DOWNLOAD_WORKER_TASK_INTERVAL,
    HTTP_TIMEOUT_DOWNLOAD,
    HTTP_TIMEOUT_FFMPEG,
    HTTP_TIMEOUT_RESOLVE,
    RETRY_BASE_DELAY_SECONDS,
    RETRY_MAX_ATTEMPTS,
)
from app.db import async_session_factory
from app.models import AppConfig, DownloadTask, Site
from app.services.ad_filter import is_ad_filter_enabled
from app.services.m3u8_sanitizer import sanitize_m3u8_text
from app.services.notify_sender import Event, notify_sender
from app.services.resolver import resolve_share_page

logger = logging.getLogger(__name__)

def _is_m3u8_suffix(suffix: str) -> bool:
    """与前端播放器保持一致：后缀以 m3u8 或 yun 结尾视为 HLS 流。"""
    if not suffix:
        return False
    return suffix.lower().endswith(("m3u8", "yun"))


class TaskDeletedError(Exception):
    """任务在下载过程中被删除，worker 应立即退出。"""


async def _commit_progress(
    task_id: int,
    task: DownloadTask,
    force_status: str | None = None,
    session: AsyncSession | None = None,
) -> str | None:
    """提交下载进度，并尊重外部状态变更。

    - 若未提供 session，则内部新建一个短会话。
    - 若任务已被删除，抛出 TaskDeletedError。
    - 若 force_status 指定，则强制置为该状态（用于完成/出错）。
    - 否则，使用条件 UPDATE（仅在 DB 状态仍是 downloading 时写入进度），
      避免 read-modify-write 窗口被 pause/delete 覆盖状态。

    返回：若检测到需要停止的非 downloading 状态，则返回该状态；否则返回 None。
    """
    if session is None:
        async with async_session_factory() as new_session:
            return await _commit_progress(task_id, task, force_status, session=new_session)

    if force_status is not None:
        result = await session.execute(
            select(DownloadTask).where(DownloadTask.id == task_id)
        )
        fresh = result.scalar_one_or_none()
        if fresh is None:
            raise TaskDeletedError()
        fresh.downloaded_bytes = task.downloaded_bytes
        fresh.downloaded_segments = task.downloaded_segments
        fresh.total_segments = task.total_segments
        if task.total_bytes is not None:
            fresh.total_bytes = task.total_bytes
        fresh.status = force_status
        task.status = force_status
        await session.commit()
    else:
        values = {
            "downloaded_bytes": task.downloaded_bytes,
            "downloaded_segments": task.downloaded_segments,
            "total_segments": task.total_segments,
        }
        if task.total_bytes is not None:
            values["total_bytes"] = task.total_bytes
        result = await session.execute(
            update(DownloadTask)
            .where(DownloadTask.id == task_id, DownloadTask.status == "downloading")
            .values(values)
        )
        await session.commit()
        if result.rowcount == 0:
            # 外部已将状态改为 paused/error 或任务被删除
            status_result = await session.execute(
                select(DownloadTask.status).where(DownloadTask.id == task_id)
            )
            status_row = status_result.one_or_none()
            if status_row is None:
                raise TaskDeletedError()
            task.status = status_row[0]

    await notify_sender.send("download_events", Event("download_progress", {
        "task_id": task_id,
        "downloaded_bytes": task.downloaded_bytes,
        "total_bytes": task.total_bytes,
        "downloaded_segments": task.downloaded_segments,
        "total_segments": task.total_segments,
        "status": task.status,
    }))
    return task.status if task.status != "downloading" else None


# 内存级停止信号：pause / delete 先 set 事件，worker 无需等到下一次 DB 轮询即可退出
_task_stop_events: dict[int, asyncio.Event] = {}


def _register_task(task_id: int) -> asyncio.Event:
    """worker 启动时注册一个停止事件，返回给 worker 使用。

    若 API 层（pause/delete）已经为此任务设置过事件，则保留原事件，避免
    在 pause 与 coordinator 抢任务时信号被覆盖。"""
    event = _task_stop_events.get(task_id)
    if event is None:
        event = asyncio.Event()
        _task_stop_events[task_id] = event
    return event


def _unregister_task(task_id: int) -> None:
    """worker 退出时注销停止事件，避免内存泄漏。"""
    _task_stop_events.pop(task_id, None)


def request_stop(task_id: int) -> None:
    """由 API 层调用，建议 worker 尽快检查状态并退出。"""
    event = _task_stop_events.get(task_id)
    if event is not None:
        event.set()


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
    await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "downloading"}))
    logger.info("任务已标记为 downloading task_id=%s", task_id)


async def pause(task_id: int) -> None:
    """将任务状态设为 paused；worker 会在下一次 chunk 后退出。"""
    request_stop(task_id)
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task:
            task.status = "paused"
            await session.commit()
    await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "paused"}))
    logger.info("任务已暂停 task_id=%s", task_id)


async def resume(task_id: int) -> None:
    """将任务状态设为 queued，worker 会重新 pick 并续传。"""
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        if task and task.status == "paused":
            task.status = "queued"
            await session.commit()
    await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "queued"}))
    logger.info("任务已恢复 task_id=%s", task_id)


# ---------------------------------------------------------------------------
# Worker 循环（动态并发池）
# ---------------------------------------------------------------------------

_MAX_CONCURRENT_DOWNLOADS_DEFAULT = 10
_MAX_CONCURRENT_DOWNLOADS_MIN = 1
_MAX_CONCURRENT_DOWNLOADS_MAX = 50

_max_concurrent_downloads: int = _MAX_CONCURRENT_DOWNLOADS_DEFAULT
_active_download_tasks: set[asyncio.Task] = set()


def get_max_concurrent() -> int:
    return _max_concurrent_downloads


def set_max_concurrent(value: int) -> int:
    """更新内存中的最大并发数（持久化由调用方负责写入 AppConfig）。"""
    global _max_concurrent_downloads
    _max_concurrent_downloads = max(
        _MAX_CONCURRENT_DOWNLOADS_MIN,
        min(_MAX_CONCURRENT_DOWNLOADS_MAX, value),
    )
    logger.info("最大同时下载任务数已调整为 %s", _max_concurrent_downloads)
    return _max_concurrent_downloads


async def _load_max_concurrent() -> None:
    """启动时从 AppConfig 加载最大并发数。"""
    global _max_concurrent_downloads
    async with async_session_factory() as session:
        row = await session.get(AppConfig, "max_concurrent_downloads")
        if row and row.value:
            try:
                value = int(row.value)
                _max_concurrent_downloads = max(
                    _MAX_CONCURRENT_DOWNLOADS_MIN,
                    min(_MAX_CONCURRENT_DOWNLOADS_MAX, value),
                )
                logger.info("已从配置加载最大同时下载任务数: %s", _max_concurrent_downloads)
            except ValueError:
                pass


async def download_coordinator() -> None:
    """后台协调器：按最大并发数动态调度 queued 任务。"""
    logger.info("下载 coordinator 已启动")
    await _load_max_concurrent()
    try:
        while True:
            # 清理已完成的任务
            done_tasks = {t for t in _active_download_tasks if t.done()}
            _active_download_tasks.difference_update(done_tasks)

            # 在并发上限内尽可能启动新任务
            while len(_active_download_tasks) < _max_concurrent_downloads:
                task_id = await _pick_next_task()
                if task_id is None:
                    break
                task = asyncio.create_task(_run_one(task_id))
                _active_download_tasks.add(task)

            if not _active_download_tasks:
                await asyncio.sleep(DOWNLOAD_WORKER_EMPTY_SLEEP)
                continue

            # 等待任意任务完成或超时，以便及时响应配置变化 / 新队列任务
            await asyncio.wait(
                list(_active_download_tasks),
                return_when=asyncio.FIRST_COMPLETED,
                timeout=DOWNLOAD_WORKER_TASK_INTERVAL,
            )
    finally:
        logger.info("下载 coordinator 正在关闭，取消 %s 个活跃任务", len(_active_download_tasks))
        for t in _active_download_tasks:
            t.cancel()
        if _active_download_tasks:
            await asyncio.gather(*_active_download_tasks, return_exceptions=True)
        _active_download_tasks.clear()


async def _run_one(task_id: int) -> None:
    """单个下载任务的包装，确保异常不会泄漏到 coordinator。"""
    try:
        await _run_download(task_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("下载任务异常终止 task_id=%s", task_id)
        await _set_error(task_id, "connection_error: 未知异常，请重试")


async def _pick_next_task() -> int | None:
    """原子性地取最老的 queued 任务并设为 downloading。"""
    async with async_session_factory() as session:
        async with session.begin():
            # 用单条 UPDATE ... RETURNING 避免 select-then-update 的竞态窗口
            subq = (
                select(DownloadTask.id)
                .where(DownloadTask.status == "queued")
                .order_by(DownloadTask.created_at)
                .limit(1)
                .scalar_subquery()
            )
            stmt = (
                update(DownloadTask)
                .where(DownloadTask.id == subq)
                .values(status="downloading")
                .returning(DownloadTask.id)
            )
            result = await session.execute(stmt)
            row = result.fetchone()
            return row[0] if row else None


# ---------------------------------------------------------------------------
# 核心下载逻辑
# ---------------------------------------------------------------------------

async def _run_download(task_id: int) -> None:
    """执行一次完整的（或部分）下载。"""
    stop_event = _register_task(task_id)
    try:
        # 使用短会话加载 task 和 site，避免长时间占用连接
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

            # 将 task 从会话中分离，以便会话关闭后继续安全使用其标量属性
            session.expunge(task)

        # 若 API 层已请求停止（pause/delete），优先尊重该信号；
        # 这能避免 pause 与 coordinator 抢任务时暂停失效。
        if stop_event.is_set():
            async with async_session_factory() as fresh_session:
                fresh = await fresh_session.get(DownloadTask, task_id)
                if fresh is None:
                    return
                if fresh.status != "paused":
                    fresh.status = "paused"
                    await fresh_session.commit()
            return

        # 创建目录
        Path(task.file_path).parent.mkdir(parents=True, exist_ok=True)

        if _is_m3u8_suffix(task.suffix):
            await _run_m3u8_download(task_id, task, site_id, base_url, site_name, stop_event)
        else:
            await _run_direct_download(task_id, task, site_id, base_url, site_name, stop_event)
    finally:
        _unregister_task(task_id)


async def _run_direct_download(
    task_id: int,
    task: DownloadTask,
    site_id: int,
    base_url: str,
    site_name: str,
    stop_event: asyncio.Event,
) -> None:
    """直接文件下载（HTTP Range 流式）。整个 worker 复用一个 DB session。"""
    headers = {
        "Range": f"bytes={task.downloaded_bytes}-",
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": base_url or task.url,
    }

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_DOWNLOAD, follow_redirects=True) as client:
            async with client.stream("GET", task.url, headers=headers) as resp:
                async with async_session_factory() as session:
                    if resp.status_code == 404:
                        await _set_error(task_id, "file_removed: 资源已失效", session=session)
                        return
                    if resp.status_code == 416:
                        # Range 不可满足，通常意味着已下载完整文件
                        logger.info("Range 不可满足，标记完成 task_id=%s", task_id)
                        await _commit_progress(task_id, task, force_status="done", session=session)
                        await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "done", "downloaded_bytes": task.downloaded_bytes, "total_bytes": task.total_bytes}))
                        return
                    if resp.status_code >= 400:
                        error_msg = await _classify_http_error(resp.status_code)
                        await _set_error(task_id, error_msg, session=session)
                        return

                    # 服务器忽略 Range 时从头下载
                    if resp.status_code == 200 and task.downloaded_bytes > 0:
                        logger.warning("服务器不支持 Range，从头下载 task_id=%s", task_id)
                        task.downloaded_bytes = 0

                    # 计算总大小
                    if task.total_bytes is None:
                        content_length = resp.headers.get("content-length")
                        if content_length is not None:
                            try:
                                remaining = int(content_length)
                                if resp.status_code == 206:
                                    task.total_bytes = task.downloaded_bytes + remaining
                                else:
                                    task.total_bytes = remaining
                                external_status = await _commit_progress(task_id, task, session=session)
                                if external_status:
                                    return
                            except ValueError:
                                pass

                    # 流式写入（批量 commit 优化：每 5 秒或每 100 个 chunk）
                    last_commit = time.monotonic()
                    last_refresh = time.monotonic()
                    chunk_counter = 0
                    file_mode = "wb" if task.downloaded_bytes == 0 else "ab"
                    try:
                        async with aiofiles.open(task.file_path, file_mode) as f:
                            async for chunk in resp.aiter_bytes(DOWNLOAD_CHUNK_SIZE):
                                now = time.monotonic()

                                # 每 N 秒检查一次暂停/删除状态
                                if stop_event.is_set() or now - last_refresh >= DOWNLOAD_PAUSE_CHECK_INTERVAL:
                                    status_result = await session.execute(
                                        select(DownloadTask.status).where(DownloadTask.id == task_id)
                                    )
                                    status_row = status_result.one_or_none()
                                    if status_row is None:
                                        raise TaskDeletedError()
                                    task.status = status_row[0]
                                    last_refresh = now
                                    if task.status == "paused":
                                        await _commit_progress(task_id, task, session=session)
                                        logger.info("任务被暂停 task_id=%s", task_id)
                                        return
                                    if task.status == "error":
                                        return
                                    # stop_event 被设置但 DB 尚未反映，强制置为 paused 后退出
                                    if stop_event.is_set():
                                        await _commit_progress(task_id, task, force_status="paused", session=session)
                                        logger.info("任务被暂停 task_id=%s", task_id)
                                        return

                                await f.write(chunk)
                                task.downloaded_bytes += len(chunk)
                                chunk_counter += 1

                                # 每 N 秒或每 N 个 chunk commit 一次，并推送进度
                                if now - last_commit >= DOWNLOAD_DB_COMMIT_INTERVAL or chunk_counter >= DOWNLOAD_BATCH_COMMIT_CHUNKS:
                                    external_status = await _commit_progress(task_id, task, session=session)
                                    if external_status:
                                        logger.info("任务状态已变更 task_id=%s status=%s", task_id, external_status)
                                        return
                                    last_commit = now
                                    chunk_counter = 0
                    except TaskDeletedError:
                        raise
                    except Exception as exc:
                        external_status = await _commit_progress(task_id, task, session=session)
                        if external_status:
                            logger.info("任务状态已变更 task_id=%s status=%s", task_id, external_status)
                            return
                        logger.exception("写盘异常 task_id=%s", task_id)
                        await _set_error(task_id, f"connection_error: 写盘失败：{exc}", session=session)
                        return

                    # 完成
                    await _commit_progress(task_id, task, force_status="done", session=session)
                    await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "done", "downloaded_bytes": task.downloaded_bytes, "total_bytes": task.total_bytes}))
                    logger.info("下载完成 task_id=%s path=%s", task_id, task.file_path)
    except httpx.TimeoutException as exc:
        error_msg = await _classify_network_error(str(exc))
        await _set_error(task_id, error_msg)
    except httpx.HTTPError as exc:
        error_msg = await _classify_network_error(str(exc))
        await _set_error(task_id, error_msg)
    except TaskDeletedError:
        logger.info("任务已被删除，直链下载 worker 退出 task_id=%s", task_id)
    except Exception as exc:
        await _set_error(task_id, f"connection_error: {exc}")


# ---------------------------------------------------------------------------
# m3u8 下载
# ---------------------------------------------------------------------------

async def _run_m3u8_download(
    task_id: int,
    task: DownloadTask,
    site_id: int,
    base_url: str,
    site_name: str,
    stop_event: asyncio.Event,
) -> None:
    """m3u8 播放列表下载：解析 → 下载 .ts 片段 → ffmpeg 合并。整个 worker 复用一个 DB session。"""
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": base_url or task.url,
    }
    ts_dir = None

    try:
        async with async_session_factory() as session:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_DOWNLOAD, follow_redirects=True) as client:
                # 1. 确认 m3u8 URL（防御性：非直接 m3u8 时尝试解析）
                m3u8_url = task.url
                if "index.m3u8" not in m3u8_url and not m3u8_url.endswith(".m3u8"):
                    resolved = await _resolve_m3u8_url(client, m3u8_url, headers)
                    if not resolved:
                        await _set_error(task_id, "connection_error: 无法解析 m3u8 地址")
                        return
                    m3u8_url = resolved

                # 2. 下载主 m3u8
                m3u8_text = await _fetch_text(client, m3u8_url, headers)
                if not m3u8_text:
                    await _set_error(task_id, "connection_error: 无法获取 m3u8 播放列表")
                    return

                # 3. 解析 master / media playlist
                base_m3u8_url = _extract_base_url(m3u8_url)
                sub_url = ""

                if "#EXT-X-STREAM-INF" in m3u8_text:
                    sub_url = _pick_best_stream(m3u8_text, base_m3u8_url)
                    if not sub_url:
                        await _set_error(task_id, "connection_error: m3u8 无可用子流")
                        return
                    m3u8_text = await _fetch_text(client, sub_url, headers)
                    if not m3u8_text:
                        await _set_error(task_id, "connection_error: 无法获取子 m3u8")
                        return
                    ts_base_url = _extract_base_url(sub_url)
                else:
                    ts_base_url = base_m3u8_url

                # 若开启去广告，清洗最终 media playlist
                if await is_ad_filter_enabled():
                    playlist_url = sub_url or m3u8_url
                    m3u8_text = await sanitize_m3u8_text(
                        m3u8_text, playlist_url, site_id=site_id
                    )

                # 4. 提取 .ts 列表
                ts_names = _extract_ts_names(m3u8_text)
                if not ts_names:
                    await _set_error(task_id, "file_removed: m3u8 中无 .ts 片段")
                    return

                logger.info(
                    "m3u8 解析成功 task_id=%s ts_count=%s", task_id, len(ts_names)
                )

                # 5. 准备输出路径和临时目录
                final_path = Path(task.file_path)
                if final_path.suffix == ".m3u8":
                    final_path = final_path.with_suffix(".mp4")
                ts_dir = final_path.parent / f".ts_{task_id}"
                ts_dir.mkdir(parents=True, exist_ok=True)

                total_ts = len(ts_names)
                task.total_segments = total_ts

                # 断点续传：统计已下载的片段和字节数
                existing_segments = 0
                existing_bytes = 0
                for ts_name in ts_names:
                    ts_path = ts_dir / _clean_ts_filename(ts_name)
                    if ts_path.exists() and ts_path.stat().st_size > 0:
                        existing_segments += 1
                        existing_bytes += ts_path.stat().st_size
                if existing_segments > 0:
                    task.downloaded_segments = existing_segments
                    task.downloaded_bytes = existing_bytes

                # 立即提交 total_segments，避免后续 session.refresh(task) 把它刷回 null
                await _commit_progress(task_id, task, session=session)

                # 6. 并发下载 .ts（worker 内单 session，片段下载器只改内存计数器）
                semaphore = asyncio.Semaphore(DOWNLOAD_TS_CONCURRENCY)
                _session_lock = asyncio.Lock()
                _commit_counter = 0
                _last_commit = time.monotonic()
                _last_refresh = time.monotonic()

                async def _batch_commit(force: bool = False) -> str | None:
                    """调用方必须已持有 _session_lock。使用条件 UPDATE 提交进度：
                    仅在 DB 状态仍是 downloading 时写入，避免与 pause/delete 发生 lost update。
                    若外部已改状态，同步到本地 task 并返回该状态。"""
                    nonlocal _commit_counter, _last_commit
                    _commit_counter += 1
                    now = time.monotonic()
                    if force or now - _last_commit >= DOWNLOAD_DB_COMMIT_INTERVAL or _commit_counter >= DOWNLOAD_BATCH_COMMIT_SEGMENTS:
                        values = {
                            "downloaded_bytes": task.downloaded_bytes,
                            "downloaded_segments": task.downloaded_segments,
                            "total_segments": task.total_segments,
                        }
                        if task.total_bytes is not None:
                            values["total_bytes"] = task.total_bytes
                        result = await session.execute(
                            update(DownloadTask)
                            .where(DownloadTask.id == task_id, DownloadTask.status == "downloading")
                            .values(values)
                        )
                        await session.commit()
                        if result.rowcount == 0:
                            status_result = await session.execute(
                                select(DownloadTask.status).where(DownloadTask.id == task_id)
                            )
                            status_row = status_result.one_or_none()
                            if status_row is None:
                                raise TaskDeletedError()
                            task.status = status_row[0]
                        _last_commit = now
                        _commit_counter = 0
                        await notify_sender.send("download_events", Event("download_progress", {
                            "task_id": task_id,
                            "downloaded_bytes": task.downloaded_bytes,
                            "total_bytes": task.total_bytes,
                            "downloaded_segments": task.downloaded_segments,
                            "total_segments": task.total_segments,
                            "status": task.status,
                        }))
                        return task.status if task.status != "downloading" else None
                    return None

                async def _check_paused() -> bool:
                    """调用方必须已持有 _session_lock。复用 worker 的 session 读取最新状态；
                    若已暂停、出错、或 stop_event 已被设置，则 commit 并返回 True；
                    若任务已被删除则抛出 TaskDeletedError。"""
                    nonlocal _last_refresh
                    status_result = await session.execute(
                        select(DownloadTask.status).where(DownloadTask.id == task_id)
                    )
                    status_row = status_result.one_or_none()
                    _last_refresh = time.monotonic()
                    if status_row is None:
                        raise TaskDeletedError()
                    task.status = status_row[0]
                    if task.status != "downloading" or stop_event.is_set():
                        await _batch_commit(force=True)
                        return True
                    return False

                async def download_one(idx: int, ts_name: str):
                    ts_path = ts_dir / _clean_ts_filename(ts_name)
                    # 已存在则跳过（断点续传）
                    if ts_path.exists() and ts_path.stat().st_size > 0:
                        return True

                    ts_url = (
                        ts_name
                        if ts_name.startswith(("http://", "https://"))
                        else urljoin(ts_base_url, ts_name)
                    )

                    async with semaphore:
                        for attempt in range(RETRY_MAX_ATTEMPTS):
                            if not ts_dir.exists():
                                return "deleted"
                            # API 层已请求停止，立即检查状态而不是等轮询间隔
                            if stop_event.is_set():
                                async with _session_lock:
                                    if await _check_paused():
                                        return "paused"
                            try:
                                # 检查暂停（每 N 秒才 refresh 一次）
                                now = time.monotonic()
                                if now - _last_refresh >= DOWNLOAD_PAUSE_CHECK_INTERVAL:
                                    async with _session_lock:
                                        if await _check_paused():
                                            return "paused"

                                resp = await client.get(
                                    ts_url, headers=headers, timeout=HTTP_TIMEOUT_DOWNLOAD
                                )
                                if resp.status_code >= 400:
                                    raise httpx.HTTPError(f"HTTP {resp.status_code}")

                                content = resp.content
                                # 网络请求完成后、写入前目录可能已被删除
                                if not ts_dir.exists():
                                    return "deleted"
                                async with aiofiles.open(ts_path, "wb") as f:
                                    await f.write(content)

                                async with _session_lock:
                                    task.downloaded_bytes += len(content)
                                    task.downloaded_segments += 1
                                    external_status = await _batch_commit()
                                if external_status:
                                    logger.info("m3u8 任务状态已变更 task_id=%s status=%s", task_id, external_status)
                                    return "paused"
                                return True
                            except TaskDeletedError:
                                raise
                            except asyncio.CancelledError:
                                raise
                            except Exception as exc:
                                # 目录被删除说明任务已被批量删除，静默退出
                                if not ts_dir.exists():
                                    return "deleted"
                                # client 已关闭说明 worker 正在退出，不再重试
                                if client.is_closed:
                                    raise asyncio.CancelledError()
                                logger.warning(
                                    "ts 下载失败 task_id=%s ts=%s attempt=%s error=%s",
                                    task_id,
                                    ts_name,
                                    attempt + 1,
                                    exc,
                                )
                                if attempt < RETRY_MAX_ATTEMPTS - 1:
                                    await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** attempt))
                                else:
                                    return False
                        return False

                # 显式创建任务并在异常时取消并等待所有子任务，避免 async with client
                # 先关闭导致运行中的子任务报 "client has been closed"
                download_tasks = [
                    asyncio.create_task(download_one(i, name))
                    for i, name in enumerate(ts_names)
                ]
                try:
                    results = await asyncio.gather(*download_tasks)
                except BaseException:
                    for t in download_tasks:
                        if not t.done():
                            t.cancel()
                    await asyncio.gather(*download_tasks, return_exceptions=True)
                    raise
                # 确保剩余进度已 commit
                async with _session_lock:
                    final_status = await _batch_commit(force=True)
                if final_status:
                    logger.info("m3u8 任务状态已变更 task_id=%s status=%s", task_id, final_status)
                    return

                if any(r == "deleted" for r in results):
                    logger.info("m3u8 任务已被删除，worker 退出 task_id=%s", task_id)
                    shutil.rmtree(ts_dir, ignore_errors=True)
                    return
                if any(r == "paused" for r in results):
                    logger.info("m3u8 下载被暂停 task_id=%s", task_id)
                    return

                failed = [ts_names[i] for i, r in enumerate(results) if r is False]
                if failed:
                    await _set_error(
                        task_id,
                        f"connection_error: {len(failed)}/{len(ts_names)} 个 .ts 片段下载失败",
                    )
                    return

                # 7. 合并为 mp4
                merged_ok = await _merge_ts_files(ts_dir, ts_names, final_path)
                if not merged_ok:
                    logger.warning(
                        "ffmpeg 不可用，降级为直接拼接 ts 文件 task_id=%s", task_id
                    )
                    concat_ok = await _concat_ts_files(ts_dir, ts_names, final_path)
                    if not concat_ok:
                        await _set_error(
                            task_id,
                            "connection_error: 无法合并输出文件，ts 片段可能缺失",
                        )
                        return

                # 8. 清理临时目录
                shutil.rmtree(ts_dir, ignore_errors=True)

                # 校验最终文件
                if not final_path.exists() or final_path.stat().st_size == 0:
                    await _set_error(
                        task_id,
                        "connection_error: 输出文件为空，下载可能未成功",
                    )
                    return

                # 更新 file_path 为最终路径（扩展名可能从 .m3u8 改为 .mp4）
                values = {
                    "file_path": str(final_path),
                    "status": "done",
                    "downloaded_bytes": task.downloaded_bytes,
                    "downloaded_segments": task.downloaded_segments,
                    "total_segments": task.total_segments,
                }
                if task.total_bytes is not None:
                    values["total_bytes"] = task.total_bytes
                result = await session.execute(
                    update(DownloadTask)
                    .where(DownloadTask.id == task_id, DownloadTask.status == "downloading")
                    .values(values)
                )
                await session.commit()
                if result.rowcount == 0:
                    status_result = await session.execute(
                        select(DownloadTask.status).where(DownloadTask.id == task_id)
                    )
                    status_row = status_result.one_or_none()
                    if status_row is None:
                        raise TaskDeletedError()
                    logger.info("m3u8 完成前状态已变更 task_id=%s status=%s", task_id, status_row[0])
                    return
                await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "done", "downloaded_bytes": task.downloaded_bytes, "total_bytes": task.total_bytes}))
                logger.info("m3u8 下载完成 task_id=%s path=%s", task_id, final_path)

    except httpx.TimeoutException as exc:
        error_msg = await _classify_network_error(str(exc))
        await _set_error(task_id, error_msg)
    except httpx.HTTPError as exc:
        error_msg = await _classify_network_error(str(exc))
        await _set_error(task_id, error_msg)
    except TaskDeletedError:
        logger.info("任务已被删除，m3u8 下载 worker 退出 task_id=%s", task_id)
        if ts_dir is not None:
            shutil.rmtree(ts_dir, ignore_errors=True)
    except Exception as exc:
        logger.exception("m3u8 下载异常 task_id=%s", task_id)
        await _set_error(task_id, f"connection_error: {exc}")


# ---------------------------------------------------------------------------
# m3u8 辅助函数
# ---------------------------------------------------------------------------

async def _resolve_m3u8_url(
    client: httpx.AsyncClient, url: str, headers: dict
) -> str | None:
    """对分享页提取真实 m3u8 地址（复用 resolver 的多模式匹配）。"""
    return await resolve_share_page(url, client=client, headers=headers)


async def _fetch_text(
    client: httpx.AsyncClient, url: str, headers: dict
) -> str | None:
    try:
        resp = await client.get(url, headers=headers, timeout=HTTP_TIMEOUT_RESOLVE)
        if resp.status_code >= 400:
            return None
        return resp.text
    except Exception:
        logger.exception("获取文本失败 url=%s", url)
    return None


def _extract_base_url(url: str) -> str:
    """去掉文件名，保留目录路径（以 / 结尾）。"""
    parsed = urlparse(url)
    path = parsed.path
    last_slash = path.rfind("/")
    if last_slash >= 0:
        path = path[: last_slash + 1]
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _pick_best_stream(m3u8_text: str, base_url: str) -> str | None:
    """从 master playlist 中选带宽最高的子 playlist。"""
    lines = m3u8_text.splitlines()
    best_bandwidth = -1
    best_url = None

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXT-X-STREAM-INF"):
            bw_match = re.search(r"BANDWIDTH=(\d+)", line)
            bandwidth = int(bw_match.group(1)) if bw_match else 0
            if i + 1 < len(lines):
                uri = lines[i + 1].strip()
                if uri and not uri.startswith("#"):
                    if bandwidth > best_bandwidth:
                        best_bandwidth = bandwidth
                        best_url = uri
            i += 2
        else:
            i += 1

    if not best_url:
        return None

    if best_url.startswith(("http://", "https://")):
        return best_url
    return urljoin(base_url, best_url)


def _clean_ts_filename(name: str) -> str:
    """去掉 URL 查询参数，提取可用作文件名的 .ts 名。"""
    return Path(name.split("?")[0]).name


def _extract_ts_names(m3u8_text: str) -> list[str]:
    """从 media playlist 提取媒体片段文件名/URL。"""
    lines = m3u8_text.splitlines()
    ts_names = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        ts_names.append(line)
    return ts_names


async def _merge_ts_files(
    ts_dir: Path, ts_names: list[str], output_path: Path
) -> bool:
    """尝试用 ffmpeg 合并 .ts 为 mp4。返回是否成功。"""
    try:
        concat_file = ts_dir / "concat.txt"
        async with aiofiles.open(concat_file, "w", encoding="utf-8") as f:
            for name in ts_names:
                await f.write(f"file '{_clean_ts_filename(name)}'\n")

        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            str(output_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=HTTP_TIMEOUT_FFMPEG)
        if proc.returncode == 0:
            return True
        logger.error(
            "ffmpeg 失败: %s", stderr.decode("utf-8", errors="ignore")[-500:]
        )
    except FileNotFoundError:
        logger.warning("ffmpeg 未安装")
    except asyncio.TimeoutError:
        logger.error("ffmpeg 合并超时")
    except Exception:
        logger.exception("ffmpeg 合并异常")
    return False


async def _concat_ts_files(
    ts_dir: Path, ts_names: list[str], output_path: Path
) -> bool:
    """ffmpeg 不可用时的降级：按顺序直接拼接 .ts 文件。返回是否写入数据。"""
    written = False
    async with aiofiles.open(output_path, "wb") as out_f:
        for name in ts_names:
            ts_path = ts_dir / _clean_ts_filename(name)
            if not ts_path.exists():
                continue
            async with aiofiles.open(ts_path, "rb") as in_f:
                while True:
                    chunk = await in_f.read(DOWNLOAD_CHUNK_SIZE)
                    if not chunk:
                        break
                    await out_f.write(chunk)
                    written = True
    return written


# ---------------------------------------------------------------------------
# 错误分类
# ---------------------------------------------------------------------------

async def _classify_http_error(status_code: int) -> str:
    """HTTP 4xx/5xx 时直接根据状态码分类，避免额外 probe 请求。"""
    if status_code == 404:
        return "file_removed: 资源已失效（HTTP 404）"
    if status_code >= 500:
        return f"site_unavailable: HTTP {status_code}"
    return f"connection_error: HTTP {status_code}"


async def _classify_network_error(detail: str) -> str:
    """网络层异常直接归类为 connection_error，避免额外 probe 请求。"""
    return f"connection_error: {detail}"


async def _set_error(
    task_id: int, error_msg: str, session: AsyncSession | None = None
) -> None:
    """将任务置为 error 并记录原因。若提供 session 则复用，否则新建短会话。"""
    if session is None:
        async with async_session_factory() as new_session:
            return await _set_error(task_id, error_msg, session=new_session)

    result = await session.execute(select(DownloadTask).where(DownloadTask.id == task_id))
    task = result.scalar_one_or_none()
    if task:
        task.status = "error"
        task.error = error_msg
        await session.commit()
    await notify_sender.send("download_events", Event("download_status", {"task_id": task_id, "status": "error", "error": error_msg}))
    logger.error("任务出错 task_id=%s error=%s", task_id, error_msg)
