from pathlib import Path

import pytest

from app.services import playback_enhancement


def test_enhancement_command_is_lightly_scaled_and_resource_capped(tmp_path):
    command = playback_enhancement.build_ffmpeg_command(
        "ffmpeg", "https://media.test/video.mp4", "https://site.test", tmp_path
    )
    assert "-re" in command
    assert "scale=-2:1080:flags=lanczos,unsharp=5:5:0.35:5:5:0.0" in command
    assert command[command.index("-threads") + 1] == "1"
    assert command[command.index("-filter_threads") + 1] == "1"
    assert command[command.index("-preset") + 1] == "ultrafast"


async def test_enhancement_reports_missing_ffmpeg(monkeypatch, tmp_path):
    monkeypatch.setattr(playback_enhancement.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="未安装 ffmpeg"):
        await playback_enhancement.start_enhancement(
            "https://media.test/video.mp4", "mp4", None
        )


async def test_enhancement_process_is_stopped_and_files_cleaned(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(playback_enhancement, "ENHANCEMENT_ROOT", tmp_path)
    monkeypatch.setattr(
        playback_enhancement.shutil, "which", lambda name: "/fake/ffmpeg"
    )

    class FakeProcess:
        def __init__(self):
            self.returncode = None
            self.terminated = False

        def terminate(self):
            self.terminated = True
            self.returncode = 0

        def kill(self):
            self.returncode = -1

        async def wait(self):
            if self.returncode is None:
                self.returncode = 0
            return self.returncode

    process = FakeProcess()

    async def fake_exec(*command, **kwargs):
        Path(command[-1]).write_text("#EXTM3U\n", encoding="utf-8")
        return process

    monkeypatch.setattr(
        playback_enhancement.asyncio, "create_subprocess_exec", fake_exec
    )

    result = await playback_enhancement.start_enhancement(
        "https://media.test/video.mp4", "mp4", None, owner_session_id="playback-1"
    )
    session_id = str(result["session_id"])
    playback_enhancement._sessions[session_id].last_access = 0
    playback_enhancement.keepalive("playback-1")
    assert playback_enhancement._sessions[session_id].last_access > 0
    assert await playback_enhancement.get_enhancement_file(
        session_id, "index.m3u8"
    ) is not None
    assert await playback_enhancement.get_enhancement_file(
        session_id, "../secret"
    ) is None

    assert await playback_enhancement.stop_enhancement(session_id) is True
    assert process.terminated
    assert not (tmp_path / session_id).exists()
    assert await playback_enhancement.stop_enhancement(session_id) is False
