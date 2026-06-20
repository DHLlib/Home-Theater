"""下载功能端到端逻辑模拟。

流程：
1. 初始化独立 PostgreSQL 沙箱库 + 本地 HTTP 文件服务
2. 创建模拟资源站
3. 创建直链下载任务 + m3u8 下载任务
4. 启动并执行下载
5. 验证状态、文件、断点续传
6. 暂停 / 继续
7. 删除任务并清理文件
8. 验证数据库与磁盘清理

环境要求：本地 PostgreSQL 已存在名为 `home_theater_sim` 的数据库；
可通过 `DATABASE_URL` 环境变量覆盖。
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# 在导入 app 模块前设置环境变量，确保使用独立 PostgreSQL 沙箱库与临时下载目录
_TMPDIR = tempfile.mkdtemp(prefix="ht_download_sim_")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://localhost:5432/home_theater_sim"
)
os.environ["DEFAULT_DOWNLOAD_ROOT"] = str(Path(_TMPDIR) / "downloads")
os.environ["LOG_LEVEL"] = "WARNING"

# 项目根目录加入路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import async_session_factory
from app.models import Base, DownloadTask, Site
from app.services import downloader

_PORT = 18081
_SERVER: HTTPServer | None = None


async def _init_sim_db() -> None:
    """只创建模拟所需的表，跳过 PostgreSQL 专用物化视图与触发器。"""
    from app.db import engine

    async with engine.begin() as conn:
        def create_tables(sync_conn):
            for name in ("app_config", "sites", "download_tasks"):
                table = Base.metadata.tables[name]
                table.create(sync_conn, checkfirst=True)

        await conn.run_sync(create_tables)


async def _cleanup_sim_db() -> None:
    """模拟结束后清理创建的业务表。"""
    from app.db import engine

    async with engine.begin() as conn:
        def drop_tables(sync_conn):
            for name in ("download_tasks", "sites", "app_config"):
                table = Base.metadata.tables[name]
                table.drop(sync_conn, checkfirst=True)

        await conn.run_sync(drop_tables)


def _start_http_server(root: str, port: int = _PORT) -> HTTPServer:
    """在后台线程启动静态文件服务，支持 Range 请求、限速并抑制访问日志。"""

    class _Handler(SimpleHTTPRequestHandler):
        # 限速约 2 MB/s，避免本地传输太快导致暂停/删除模拟来不及命中中间状态
        _CHUNK_SIZE = 16 * 1024
        _CHUNK_DELAY = 0.008

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=root, **kwargs)

        def log_message(self, format, *args):
            pass

        def log_error(self, format, *args):
            pass

        def do_GET(self):
            path = self.translate_path(self.path)
            if not os.path.isfile(path):
                self.send_error(404)
                return
            self._serve_file(path)

        def _parse_range(self, total: int) -> tuple[int, int, int] | None:
            range_hdr = self.headers.get("Range", "")
            if not range_hdr.startswith("bytes="):
                return None
            try:
                range_val = range_hdr.split("=", 1)[1]
                start_str, end_str = range_val.split("-", 1)
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else total - 1
                if start >= total or start < 0 or end < start:
                    return None
                end = min(end, total - 1)
                return start, end, 206
            except Exception:
                return None

        def _serve_file(self, path: str):
            total = os.path.getsize(path)
            range_info = self._parse_range(total)
            if range_info is None:
                start, end, status = 0, total - 1, 200
            else:
                start, end, status = range_info
            length = end - start + 1

            self.send_response(status)
            self.send_header("Content-Type", self.guess_type(path))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()

            sent = 0
            with open(path, "rb") as f:
                f.seek(start)
                while sent < length:
                    to_read = min(self._CHUNK_SIZE, length - sent)
                    data = f.read(to_read)
                    if not data:
                        break
                    self.wfile.write(data)
                    sent += len(data)
                    if sent < length:
                        time.sleep(self._CHUNK_DELAY)

    server = HTTPServer(("127.0.0.1", port), _Handler)

    def _ignore_client_error(request, client_address):
        return

    server.handle_error = _ignore_client_error
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _prepare_files(root: Path) -> None:
    """创建直链文件与 m3u8 播放列表/片段。"""
    # 直链文件：10 MB，配合限速 handler 方便暂停/续传模拟
    (root / "direct.bin").write_bytes(b"D" * (10 * 1024 * 1024))

    # m3u8：5 个 .ts 片段
    hls_dir = root / "hls"
    hls_dir.mkdir()
    lines = ["#EXTM3U", "#EXT-X-TARGETDURATION:10", "#EXT-X-VERSION:3"]
    for i in range(5):
        (hls_dir / f"seg{i}.ts").write_bytes(b"T" * 1024)
        lines.extend([f"#EXTINF:10.000,", f"hls/seg{i}.ts"])
    lines.append("#EXT-X-ENDLIST")
    (root / "playlist.m3u8").write_text("\n".join(lines) + "\n")


async def _create_site(session) -> int:
    base_url = f"http://127.0.0.1:{_PORT}"
    site = Site(name="simulate", base_url=base_url)
    session.add(site)
    await session.commit()
    return site.id


async def _create_task(session, site_id: int, title: str, url: str, suffix: str, file_path: Path) -> int:
    task = DownloadTask(
        title=title,
        episode_name="E01",
        source_site_id=site_id,
        source_video_id=f"vid_{title}",
        url=url,
        suffix=suffix,
        file_path=str(file_path),
        status="queued",
    )
    session.add(task)
    await session.commit()
    return task.id


async def _print_task(session, task_id: int, label: str) -> DownloadTask:
    task = await session.get(DownloadTask, task_id)
    print(
        f"  [{label}] id={task_id} status={task.status} "
        f"bytes={task.downloaded_bytes}/{task.total_bytes} "
        f"segments={task.downloaded_segments}/{task.total_segments} "
        f"path={task.file_path}"
    )
    return task


async def _simulate_direct(site_id: int) -> int:
    print("\n== 直链下载模拟 ==")
    async with async_session_factory() as session:
        task_id = await _create_task(
            session,
            site_id,
            title="Direct",
            url=f"http://127.0.0.1:{_PORT}/direct.bin",
            suffix="mp4",
            file_path=Path(_TMPDIR) / "downloads" / "direct.mp4",
        )

    await downloader.start(task_id)
    await downloader._run_download(task_id)

    async with async_session_factory() as session:
        task = await _print_task(session, task_id, "直链")
        assert task.status == "done", f"期望 done，实际 {task.status}"
        assert task.total_bytes == 10 * 1024 * 1024, f"期望 10MB，实际 {task.total_bytes}"
        assert task.downloaded_bytes == 10 * 1024 * 1024
        assert Path(task.file_path).exists()

    return task_id


async def _simulate_m3u8(site_id: int) -> int:
    print("\n== m3u8 下载模拟 ==")
    async with async_session_factory() as session:
        task_id = await _create_task(
            session,
            site_id,
            title="M3U8",
            url=f"http://127.0.0.1:{_PORT}/playlist.m3u8",
            suffix="m3u8",
            file_path=Path(_TMPDIR) / "downloads" / "m3u8_video.m3u8",
        )

    await downloader.start(task_id)
    await downloader._run_download(task_id)

    async with async_session_factory() as session:
        task = await _print_task(session, task_id, "m3u8")
        assert task.status == "done", f"期望 done，实际 {task.status}"
        assert task.total_segments == 5, f"期望 5，实际 {task.total_segments}"
        assert task.downloaded_segments == 5
        assert Path(task.file_path).exists()
        assert Path(task.file_path).suffix == ".mp4", f"期望 .mp4，实际 {Path(task.file_path).suffix}"

    return task_id


async def _simulate_pause_resume(site_id: int) -> int:
    print("\n== 暂停 / 继续 / 断点续传模拟 ==")
    async with async_session_factory() as session:
        task_id = await _create_task(
            session,
            site_id,
            title="PauseResume",
            url=f"http://127.0.0.1:{_PORT}/direct.bin",
            suffix="mp4",
            file_path=Path(_TMPDIR) / "downloads" / "pause_resume.mp4",
        )

    # 调小暂停检测间隔，确保本地限速文件也能在首个 chunk 后响应暂停
    original_interval = downloader.DOWNLOAD_PAUSE_CHECK_INTERVAL
    downloader.DOWNLOAD_PAUSE_CHECK_INTERVAL = 0.0

    # 下载一段时间后暂停
    await downloader.start(task_id)

    async def run_with_pause():
        # 等待 worker 至少提交一次进度后再暂停，确保能命中部分下载
        for _ in range(600):
            await asyncio.sleep(0.01)
            async with async_session_factory() as s:
                t = await s.get(DownloadTask, task_id)
                if t and t.downloaded_bytes > 0:
                    break
        await downloader.pause(task_id)

    # 直接调用内部函数以便中途暂停：这里用 start + _run_download + 后台 pause
    run_task = asyncio.create_task(downloader._run_download(task_id))
    pause_task = asyncio.create_task(run_with_pause())
    await asyncio.gather(run_task, pause_task, return_exceptions=True)

    downloader.DOWNLOAD_PAUSE_CHECK_INTERVAL = original_interval

    async with async_session_factory() as session:
        task = await _print_task(session, task_id, "暂停后")
        assert task.status == "paused", f"期望 paused，实际 {task.status}"
        assert 0 < task.downloaded_bytes < task.total_bytes, f"期望部分下载，实际 {task.downloaded_bytes}/{task.total_bytes}"
        assert Path(task.file_path).exists()

    # 继续下载
    await downloader.resume(task_id)
    await downloader._run_download(task_id)

    async with async_session_factory() as session:
        task = await _print_task(session, task_id, "继续后")
        assert task.status == "done", f"期望 done，实际 {task.status}"
        assert task.downloaded_bytes == 10 * 1024 * 1024

    return task_id


async def _simulate_delete_running(site_id: int) -> int:
    print("\n== 删除运行中任务模拟 ==")
    async with async_session_factory() as session:
        task_id = await _create_task(
            session,
            site_id,
            title="DeleteRunning",
            url=f"http://127.0.0.1:{_PORT}/direct.bin",
            suffix="mp4",
            file_path=Path(_TMPDIR) / "downloads" / "delete_running.mp4",
        )

    await downloader.start(task_id)
    run_task = asyncio.create_task(downloader._run_download(task_id))

    # 等待 worker 至少写入一部分进度
    for _ in range(600):
        await asyncio.sleep(0.01)
        async with async_session_factory() as s:
            t = await s.get(DownloadTask, task_id)
            if t and t.downloaded_bytes > 0:
                break

    # 模拟前端批量删除（DB + 文件）
    await _delete_task(task_id)

    # 等待 worker 因任务不存在而退出
    try:
        await asyncio.wait_for(run_task, timeout=10)
    except asyncio.TimeoutError:
        run_task.cancel()
        try:
            await run_task
        except asyncio.CancelledError:
            pass
        raise AssertionError("删除运行中任务后 worker 未在 10 秒内退出")

    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        assert task is None, f"任务 {task_id} 应已被删除"
    print("  运行中任务已删除，worker 已正常退出")

    # worker 关闭文件句柄后再次尝试清理残留文件
    fp = Path(_TMPDIR) / "downloads" / "delete_running.mp4"
    for _ in range(20):
        try:
            if fp.exists():
                fp.unlink()
            break
        except PermissionError:
            await asyncio.sleep(0.1)

    return task_id


async def _delete_task(task_id: int) -> None:
    print(f"\n== 删除任务 {task_id} 并清理文件 ==")
    # 模拟 API 删除逻辑
    async with async_session_factory() as session:
        task = await session.get(DownloadTask, task_id)
        assert task is not None

        file_path = Path(task.file_path)
        targets = [file_path]
        if file_path.suffix.lower() == ".m3u8":
            targets.append(file_path.with_suffix(".mp4"))
        ts_dir = file_path.parent / f".ts_{task.id}"
        if ts_dir.exists():
            targets.append(ts_dir)

        deleted_any = False
        for target in targets:
            try:
                if target.is_file():
                    target.unlink()
                    deleted_any = True
                elif target.is_dir():
                    shutil.rmtree(target)
                    deleted_any = True
            except FileNotFoundError:
                pass
            except PermissionError:
                # Windows 下文件仍被运行中的 worker 占用，先删 DB，worker 会自行退出
                pass

        await session.delete(task)
        await session.commit()
        print(f"  已删除任务，file_deleted={deleted_any}, targets={len(targets)}")


async def main() -> int:
    global _SERVER
    print(f"使用临时目录: {_TMPDIR}")

    # 1. 准备文件并启动 HTTP 服务
    root = Path(_TMPDIR)
    _prepare_files(root)
    _SERVER = _start_http_server(str(root))
    time.sleep(0.2)  # 等待服务启动

    try:
        # 2. 初始化数据库（仅创建模拟需要的表）
        await _init_sim_db()

        # 3. 创建模拟站点
        async with async_session_factory() as session:
            site_id = await _create_site(session)
        print(f"站点 id={site_id}")

        # 4. 模拟下载
        direct_id = await _simulate_direct(site_id)
        m3u8_id = await _simulate_m3u8(site_id)
        pause_id = await _simulate_pause_resume(site_id)
        delete_running_id = await _simulate_delete_running(site_id)

        # 5. 删除并清理
        await _delete_task(direct_id)
        await _delete_task(m3u8_id)
        await _delete_task(pause_id)

        # 6. 验证数据库清理
        async with async_session_factory() as session:
            for task_id in (direct_id, m3u8_id, pause_id, delete_running_id):
                task = await session.get(DownloadTask, task_id)
                assert task is None, f"任务 {task_id} 应已被删除"
        print("\n数据库记录已清空")

        # 7. 验证文件清理
        downloads_dir = Path(_TMPDIR) / "downloads"
        remaining = list(downloads_dir.rglob("*")) if downloads_dir.exists() else []
        assert not remaining, f"下载目录仍有残留: {remaining}"
        print("下载目录文件已清空")

        print("\n✅ 下载功能逻辑模拟全部通过")
        return 0
    finally:
        if _SERVER:
            _SERVER.shutdown()
        try:
            await _cleanup_sim_db()
            print("\n沙箱库业务表已清理")
        except Exception as exc:
            print(f"\n⚠️ 沙箱库业务表清理失败（通常不影响下一次运行）: {exc}")
        shutil.rmtree(_TMPDIR, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        sys.exit(asyncio.run(main()))
    except AssertionError as exc:
        print(f"\n❌ 模拟失败: {exc}")
        sys.exit(1)
    except Exception:
        import traceback

        print("\n❌ 模拟异常:")
        traceback.print_exc()
        sys.exit(1)
