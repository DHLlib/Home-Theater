"""当前选中视频的可选轻量增强：Lanczos 缩放 + 轻度锐化。

单进程、单线程、实时读取；无访问或退出时清理进程和临时分片。
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.constants import (
    DEFAULT_USER_AGENT,
    PLAYBACK_ENHANCEMENT_IDLE_SECONDS,
    PLAYBACK_ENHANCEMENT_START_TIMEOUT_SECONDS,
    PLAYBACK_ENHANCEMENT_TARGET_HEIGHT,
)
from app.services.media_metadata import probe_media_metadata
from app.services.parser import is_hls_suffix
from app.services.stream_accel import browser_headers

ENHANCEMENT_ALGORITHM = "Lanczos + Unsharp"
ENHANCEMENT_ROOT = Path(__file__).resolve().parents[1] / "data" / "enhance"
_FILENAME_RE = re.compile(r"^(?:index\.m3u8|seg_\d{5}\.ts)$")


@dataclass
class EnhancementSession:
    id: str
    directory: Path
    process: asyncio.subprocess.Process
    log: BinaryIO
    owner_session_id: str
    last_access: float
    watchdog: asyncio.Task | None = None

    @property
    def playlist(self) -> Path:
        return self.directory / "index.m3u8"


_sessions: dict[str, EnhancementSession] = {}
_lock = asyncio.Lock()


def enhancement_available() -> bool:
    return shutil.which("ffmpeg") is not None


def build_ffmpeg_command(
    executable: str,
    input_url: str,
    referer: str | None,
    directory: Path,
    target_height: int = PLAYBACK_ENHANCEMENT_TARGET_HEIGHT,
) -> list[str]:
    command = [executable, "-hide_banner", "-loglevel", "warning", "-y", "-re"]
    headers = {"User-Agent": DEFAULT_USER_AGENT}
    if referer:
        headers["Referer"] = referer.replace("\r", " ").replace("\n", " ")
    command.extend(
        [
            "-headers",
            "".join(f"{key}: {value}\r\n" for key, value in headers.items()),
            "-i",
            input_url,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            f"scale=-2:{target_height}:flags=lanczos,unsharp=5:5:0.35:5:5:0.0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-threads",
            "1",
            "-filter_threads",
            "1",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-hls_time",
            "4",
            "-hls_list_size",
            "0",
            "-hls_playlist_type",
            "event",
            "-hls_segment_filename",
            str(directory / "seg_%05d.ts"),
            str(directory / "index.m3u8"),
        ]
    )
    return command


async def _stop_unlocked(session_id: str) -> bool:
    session = _sessions.pop(session_id, None)
    if session is None:
        return False
    watchdog = session.watchdog
    if watchdog is not None and watchdog is not asyncio.current_task():
        watchdog.cancel()
    if session.process.returncode is None:
        session.process.terminate()
        try:
            await asyncio.wait_for(session.process.wait(), timeout=3)
        except asyncio.TimeoutError:
            session.process.kill()
            await session.process.wait()
    session.log.close()
    await asyncio.to_thread(shutil.rmtree, session.directory, ignore_errors=True)
    return True


async def _watchdog(session_id: str) -> None:
    while True:
        await asyncio.sleep(5)
        session = _sessions.get(session_id)
        if session is None:
            return
        if time.monotonic() - session.last_access > PLAYBACK_ENHANCEMENT_IDLE_SECONDS:
            await stop_enhancement(session_id)
            return


async def start_enhancement(
    url: str,
    suffix: str,
    referer: str | None,
    owner_session_id: str = "",
) -> dict[str, str | int]:
    executable = shutil.which("ffmpeg")
    if executable is None:
        raise RuntimeError("未安装 ffmpeg，无法启用本机画质增强")

    async with _lock:
        for session_id in list(_sessions):
            await _stop_unlocked(session_id)

        input_url = url
        if is_hls_suffix(suffix) or ".m3u8" in url.lower():
            metadata = await probe_media_metadata(
                url, suffix, browser_headers(referer)
            )
            if metadata.height and metadata.height >= PLAYBACK_ENHANCEMENT_TARGET_HEIGHT:
                raise ValueError("当前来源已达到或超过 1080p，无需增强")
            input_url = metadata.variant_url or url

        session_id = secrets.token_urlsafe(9)
        directory = ENHANCEMENT_ROOT / session_id
        directory.mkdir(parents=True, exist_ok=False)
        log = (directory / "ffmpeg.log").open("wb")
        command = build_ffmpeg_command(executable, input_url, referer, directory)
        creationflags = (
            subprocess.BELOW_NORMAL_PRIORITY_CLASS if os.name == "nt" else 0
        )
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=log,
                stderr=log,
                creationflags=creationflags,
            )
        except Exception:
            log.close()
            await asyncio.to_thread(shutil.rmtree, directory, ignore_errors=True)
            raise

        session = EnhancementSession(
            id=session_id,
            directory=directory,
            process=process,
            log=log,
            owner_session_id=owner_session_id,
            last_access=time.monotonic(),
        )
        _sessions[session_id] = session
        session.watchdog = asyncio.create_task(_watchdog(session_id))

        deadline = time.monotonic() + PLAYBACK_ENHANCEMENT_START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if process.returncode is not None:
                break
            if session.playlist.exists() and session.playlist.stat().st_size > 0:
                return {
                    "session_id": session_id,
                    "url": f"/api/play/enhance/{session_id}/index.m3u8",
                    "algorithm": ENHANCEMENT_ALGORITHM,
                    "target_height": PLAYBACK_ENHANCEMENT_TARGET_HEIGHT,
                }
            await asyncio.sleep(0.2)

        await _stop_unlocked(session_id)
        raise RuntimeError("画质增强启动失败或超时，请回到原始来源播放")


def keepalive(owner_session_id: str) -> None:
    if not owner_session_id:
        return
    for session in _sessions.values():
        if session.owner_session_id == owner_session_id:
            session.last_access = time.monotonic()


async def get_enhancement_file(session_id: str, filename: str) -> Path | None:
    if not _FILENAME_RE.fullmatch(filename):
        return None
    session = _sessions.get(session_id)
    if session is None:
        return None
    session.last_access = time.monotonic()
    path = session.directory / filename
    return path if path.is_file() else None


async def stop_enhancement(session_id: str) -> bool:
    async with _lock:
        return await _stop_unlocked(session_id)


async def shutdown_enhancements() -> None:
    async with _lock:
        for session_id in list(_sessions):
            await _stop_unlocked(session_id)
    await asyncio.to_thread(shutil.rmtree, ENHANCEMENT_ROOT, ignore_errors=True)
