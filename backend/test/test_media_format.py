"""HLS 后缀的跨功能契约：播放、下载与文件扩展名必须使用同一判定。"""

from pathlib import Path

import pytest

from app.api.downloads import _build_download_file_path
from app.services.parser import is_hls_suffix


@pytest.mark.parametrize(
    "suffix",
    ["m3u8", "ffm3u8", "155m3u8", "xlyun", "360zy", "ckplayer", "M3U8"],
)
def test_hls_suffix_contract(suffix):
    assert is_hls_suffix(suffix)


@pytest.mark.parametrize("suffix", ["", "mp4", "webm", "flv", "unknown"])
def test_non_hls_suffix_contract(suffix):
    assert not is_hls_suffix(suffix)


@pytest.mark.parametrize("suffix", ["155m3u8", "xlyun", "360zy", "ckplayer"])
def test_hls_download_uses_playlist_extension(suffix):
    path = _build_download_file_path("downloads", "示例", "第 1 集", suffix)
    assert Path(path).suffix == ".m3u8"
