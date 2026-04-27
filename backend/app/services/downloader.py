"""下载器状态机：HTTP Range 断点续传 + m3u8 .ts 下载 + 暂停/恢复 + 错误分类。"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
from pathlib import Path
from urllib.parse import urljoin, urlparse

import aiofiles
import httpx
from sqlalchemy import select

from app.db import async_session_factory
from app.models import DownloadTask, Site
from app.services.health import probe

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024
TS_CONCURRENCY = 5
M3U8_SUFFIXES = ("m3u8", "ffm3u8")


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

        if task.suffix in M3U8_SUFFIXES:
            await _run_m3u8_download(task_id, task, session, site_id, base_url, site_name)
        else:
            await _run_direct_download(task_id, task, session, site_id, base_url, site_name)


async def _run_direct_download(
    task_id: int,
    task: DownloadTask,
    session,
    site_id: int,
    base_url: str,
    site_name: str,
) -> None:
    """直接文件下载（HTTP Range 流式）。"""
    headers = {
        "Range": f"bytes={task.downloaded_bytes}-",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": base_url or task.url,
    }

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            async with client.stream("GET", task.url, headers=headers) as resp:
                if resp.status_code == 404:
                    await _set_error(task_id, "file_removed: 资源已失效")
                    return
                elif resp.status_code >= 400:
                    error_msg = await _classify_http_error(
                        site_id, base_url, site_name, resp.status_code
                    )
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
    except httpx.HTTPError as exc:
        error_msg = await _classify_network_error(site_id, base_url, site_name, str(exc))
        await _set_error(task_id, error_msg)
    except Exception as exc:
        await _set_error(task_id, f"connection_error: {exc}")


# ---------------------------------------------------------------------------
# m3u8 下载
# ---------------------------------------------------------------------------

async def _run_m3u8_download(
    task_id: int,
    task: DownloadTask,
    session,
    site_id: int,
    base_url: str,
    site_name: str,
) -> None:
    """m3u8 播放列表下载：解析 → 下载 .ts 片段 → ffmpeg 合并。"""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": base_url or task.url,
    }

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
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
                await session.commit()

            # 6. 并发下载 .ts
            semaphore = asyncio.Semaphore(TS_CONCURRENCY)

            async def download_one(idx: int, ts_name: str):
                ts_path = ts_dir / _clean_ts_filename(ts_name)
                # 已存在则跳过（断点续传）
                if ts_path.exists() and ts_path.stat().st_size > 0:
                    return True

                ts_url = (
                    ts_name
                    if ts_name.startswith(("http://", "https://"))
                    else ts_base_url + ts_name
                )

                async with semaphore:
                    # 检查暂停
                    await session.refresh(task)
                    if task.status == "paused":
                        return "paused"

                    for attempt in range(3):
                        try:
                            resp = await client.get(
                                ts_url, headers=headers, timeout=30
                            )
                            if resp.status_code >= 400:
                                raise httpx.HTTPError(f"HTTP {resp.status_code}")

                            async with aiofiles.open(ts_path, "wb") as f:
                                await f.write(resp.content)

                            task.downloaded_bytes += len(resp.content)
                            task.downloaded_segments += 1
                            await session.commit()

                            # 检查暂停
                            await session.refresh(task)
                            if task.status == "paused":
                                return "paused"

                            return True
                        except Exception as exc:
                            logger.warning(
                                "ts 下载失败 task_id=%s ts=%s attempt=%s error=%s",
                                task_id,
                                ts_name,
                                attempt + 1,
                                exc,
                            )
                            if attempt < 2:
                                await asyncio.sleep(1 * (2 ** attempt))
                            else:
                                return False
                    return False

            results = await asyncio.gather(
                *[download_one(i, name) for i, name in enumerate(ts_names)]
            )

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
                await _concat_ts_files(ts_dir, ts_names, final_path)

            # 8. 清理临时目录
            shutil.rmtree(ts_dir, ignore_errors=True)

            # 更新 file_path 为最终路径（扩展名可能从 .m3u8 改为 .mp4）
            task.file_path = str(final_path)
            task.status = "done"
            await session.commit()
            logger.info("m3u8 下载完成 task_id=%s path=%s", task_id, final_path)

    except httpx.TimeoutException as exc:
        error_msg = await _classify_network_error(
            site_id, base_url, site_name, str(exc)
        )
        await _set_error(task_id, error_msg)
    except httpx.HTTPError as exc:
        error_msg = await _classify_network_error(
            site_id, base_url, site_name, str(exc)
        )
        await _set_error(task_id, error_msg)
    except Exception as exc:
        logger.exception("m3u8 下载异常 task_id=%s", task_id)
        await _set_error(task_id, f"connection_error: {exc}")


# ---------------------------------------------------------------------------
# m3u8 辅助函数
# ---------------------------------------------------------------------------

async def _resolve_m3u8_url(
    client: httpx.AsyncClient, url: str, headers: dict
) -> str | None:
    """对分享页提取真实 m3u8 地址（const url = \"...\"）。"""
    try:
        resp = await client.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        match = re.search(r'const\s+url\s*=\s*"([^"]+)"', resp.text)
        if match:
            extracted = match.group(1)
            if extracted.startswith("http"):
                return extracted
            parsed = urlparse(url)
            return f"{parsed.scheme}://{parsed.netloc}{extracted}"
    except Exception:
        logger.exception("解析 m3u8 URL 失败 url=%s", url)
    return None


async def _fetch_text(
    client: httpx.AsyncClient, url: str, headers: dict
) -> str | None:
    try:
        resp = await client.get(url, headers=headers, timeout=15)
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
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
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
) -> None:
    """ffmpeg 不可用时的降级：按顺序直接拼接 .ts 文件。"""
    async with aiofiles.open(output_path, "wb") as out_f:
        for name in ts_names:
            ts_path = ts_dir / _clean_ts_filename(name)
            if not ts_path.exists():
                continue
            async with aiofiles.open(ts_path, "rb") as in_f:
                while True:
                    chunk = await in_f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    await out_f.write(chunk)


# ---------------------------------------------------------------------------
# 错误分类
# ---------------------------------------------------------------------------

async def _classify_http_error(
    site_id: int, base_url: str, site_name: str, status_code: int
) -> str:
    """HTTP 4xx/5xx 时 probe 站点，区分 site_unavailable / connection_error。"""
    result = await probe(site_id, base_url, site_name)
    if not result.ok:
        return f"site_unavailable: HTTP {status_code}，站点探测也失败（{result.error}）"
    return f"connection_error: HTTP {status_code}，但站点可连通"


async def _classify_network_error(
    site_id: int, base_url: str, site_name: str, detail: str
) -> str:
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
