"""
AC-012 断点续传下载 — Step Definitions 骨架
依赖: pytest-bdd（需在 test/requirements.txt 中安装）

覆盖模块:
  - app.services.downloader._run_direct_download
  - app.services.downloader._run_m3u8_download
  - app.services.downloader._merge_ts_files
  - app.services.downloader._concat_ts_files
  - app.api.downloads (POST /api/downloads, POST /api/downloads/{id}/pause, etc.)
"""

import pytest
from pytest_bdd import given, when, then, parsers, scenarios

# 加载 Feature 文件
scenarios("../../docs/features/AC012_resume_download.feature")


# ---------------------------------------------------------------------------
# Given
# ---------------------------------------------------------------------------

@given('下载根目录已配置')
def given_download_root_set():
    """确保 AppConfig 中 download_root 已设置。"""
    # TODO: TDD Agent 实现 — 写入 AppConfig 或使用临时目录
    pass


@given('存在一个可用的采集站点')
def given_available_site(db_session):
    """在数据库中插入一个 enabled=True 的 Site 记录。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('存在一个已创建的直接下载任务，已下载 {downloaded:d} 字节'))
def given_direct_task_with_progress(downloaded: int):
    """创建 DownloadTask（suffix=mp4, downloaded_bytes=downloaded）。"""
    # TODO: TDD Agent 实现
    pass


@given('服务端支持 Range 请求')
def given_server_supports_range():
    """mock 服务端返回 206 Partial Content 并携带 Content-Range。"""
    # TODO: 使用 respx/httpx_mock 配置 Range 响应
    pass


@given('存在一个直接下载任务')
def given_direct_task():
    """创建 DownloadTask（suffix=mp4, status=queued）。"""
    # TODO: TDD Agent 实现
    pass


@given('服务端返回 HTTP 404')
def given_server_returns_404():
    """mock 服务端返回 404。"""
    # TODO: TDD Agent 实现
    pass


@given('服务端返回 HTTP 502')
def given_server_returns_502():
    """mock 服务端返回 502。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('存在一个 m3u8 下载任务，总片段数为 {total:d}'))
def given_m3u8_task(total: int):
    """创建 DownloadTask（suffix=m3u8, status=queued），并 mock m3u8 文本。"""
    # TODO: TDD Agent 实现 — 构造 m3u8 播放列表含 total 个 .ts 片段
    pass


@given(parsers.parse('已有 {existing:d} 个 .ts 片段下载完成'))
def given_existing_ts_segments(existing: int):
    """在 ts_dir 中预置 existing 个非空 .ts 文件，模拟断点续传。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse("存在一个 m3u8 下载任务，共 {total:d} 个片段"))
def given_m3u8_task_v2(total: int):
    """Alias for Chinese wording variant."""
    # TODO: TDD Agent 实现
    pass

@given('存在一个 m3u8 下载任务，所有 .ts 片段已下载完成')
def given_m3u8_task_all_ts_ready():
    """创建 DownloadTask 并预置全部 .ts 片段。"""
    # TODO: TDD Agent 实现
    pass


@given('系统已安装 ffmpeg')
def given_ffmpeg_installed():
    """确保 PATH 中存在 ffmpeg 可执行文件。"""
    # TODO: TDD Agent 实现 — 可用 pytest 的 monkeypatch 或 shutil.which 检测
    pass


@given('系统未安装 ffmpeg')
def given_ffmpeg_not_installed():
    """将 ffmpeg 从 PATH 中移除或 mock FileNotFoundError。"""
    # TODO: TDD Agent 实现 — monkeypatch shutil.which 返回 None
    pass


@given('存在一个 m3u8 下载任务，正在下载中')
def given_m3u8_task_downloading():
    """创建 DownloadTask 并设置为 downloading 状态。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('其中 {failed:d} 个片段因网络问题无法下载'))
def given_some_ts_unavailable(failed: int):
    """mock 特定 .ts 片段请求返回 404 或超时。"""
    # TODO: TDD Agent 实现 — respx 配置特定 URL 失败
    pass


@given('存在一个 m3u8 下载任务，主播放列表包含多个带宽子流')
def given_m3u8_master_playlist():
    """构造含 #EXT-X-STREAM-INF 的 master m3u8。"""
    # TODO: TDD Agent 实现
    pass


# ---------------------------------------------------------------------------
# When
# ---------------------------------------------------------------------------

@when('下载 worker 执行该任务')
def when_worker_runs_task():
    """调用 app.services.downloader._run_download(task_id)。"""
    # TODO: TDD Agent 实现
    pass


@when('下载 worker 执行合并')
def when_worker_merges():
    """触发 m3u8 下载流程直至合并阶段。"""
    # TODO: TDD Agent 实现
    pass


@when('调用 pause 暂停任务')
def when_pause_task():
    """调用 app.services.downloader.pause(task_id)。"""
    # TODO: TDD Agent 实现
    pass


@when('下载 worker 解析 m3u8')
def when_worker_parses_m3u8():
    """触发 m3u8 解析逻辑。"""
    # TODO: TDD Agent 实现
    pass


# ---------------------------------------------------------------------------
# Then
# ---------------------------------------------------------------------------

@then(parsers.parse('请求头包含 "Range: bytes={start:d}-"'))
def then_range_header(start: int):
    """断言 HTTP 请求携带正确的 Range 头。"""
    # TODO: TDD Agent 实现 — 通过 respx 捕获请求头
    pass


@then('新下载的数据追加写入文件末尾')
def then_appended_to_file():
    """断言文件总大小 = 已下载 + 新增，且内容连续。"""
    # TODO: TDD Agent 实现
    pass


@then('任务完成后状态变为 done')
def then_task_status_done():
    """断言数据库中 DownloadTask.status == "done"。"""
    # TODO: TDD Agent 实现
    pass


@then('任务状态变为 error')


@then("任务状态变为 done")
def then_task_status_done_v2():
    """Alias for Chinese wording variant."""
    # TODO: TDD Agent 实现
    pass

def then_task_status_error():
    """断言数据库中 DownloadTask.status == "error"。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('错误信息包含 "{snippet}"'))
def then_error_contains(snippet: str):
    """断言 DownloadTask.error 字段包含指定文本。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('并发下载剩余 {remaining:d} 个片段，并发数不超过 {max_concurrency:d}'))
def then_concurrent_download(remaining: int, max_concurrency: int):
    """断言 asyncio.Semaphore(TS_CONCURRENCY) 限制了并发数。"""
    # TODO: TDD Agent 实现 — 可通过 mock 并发计数器验证
    pass


@then(parsers.parse('已存在的 {existing:d} 个片段被跳过'))
def then_existing_skipped(existing: int):
    """断言这些片段未产生新的 HTTP 请求。"""
    # TODO: TDD Agent 实现 — 通过 respx 请求计数验证
    pass


@then('已下载片段数和字节数正确累加')
def then_progress_accumulated():
    """断言 downloaded_segments / downloaded_bytes 与文件系统一致。"""
    # TODO: TDD Agent 实现
    pass


@then('调用 ffmpeg 生成最终 mp4 文件')
def then_ffmpeg_called():
    """断言 ffmpeg 进程被调用且 returncode == 0。"""
    # TODO: TDD Agent 实现 — 可用 subprocess 的 mock 或文件存在性断言
    pass


@then('按顺序直接拼接所有 .ts 片段为 mp4 文件')
def then_concat_fallback():
    """断言最终 mp4 文件存在，且内容为各 .ts 片段的二进制拼接。"""
    # TODO: TDD Agent 实现
    pass


@then('worker 在检测到暂停状态后退出当前下载')
def then_worker_exits_on_pause():
    """断言 worker 不再继续写入，且函数返回。"""
    # TODO: TDD Agent 实现
    pass


@then('任务状态变为 paused')
def then_task_status_paused():
    """断言 DownloadTask.status == "paused"。"""
    # TODO: TDD Agent 实现
    pass


@then('已下载进度被保存')
def then_progress_saved():
    """断言 downloaded_bytes / downloaded_segments 已持久化到数据库。"""
    # TODO: TDD Agent 实现
    pass


@then('选择带宽最高的子流继续下载')
def then_best_bandwidth_selected():
    """断言 _pick_best_stream 返回了 BANDWIDTH 最大的 URI。"""
    # TODO: TDD Agent 实现
    pass
