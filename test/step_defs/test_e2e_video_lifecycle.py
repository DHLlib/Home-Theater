"""
E2E 视频全生命周期 — Step Definitions 骨架
依赖: pytest-bdd（需在 test/requirements.txt 中安装）

端到端映射 API:
  - POST   /api/sites                (站点创建)
  - GET    /api/videos/search?wd=    (视频搜索)
  - POST   /api/videos/detail        (视频详情)
  - GET    /api/play/episodes        (播放解析)
  - POST   /api/downloads            (创建下载)
  - GET    /api/downloads            (查询任务)
  - POST   /api/downloads/{id}/pause (暂停)
  - POST   /api/downloads/{id}/resume(恢复)
  - GET    /api/sse                  (SSE 事件)

注意: E2E 测试建议优先使用 TestClient + 内存数据库 + httpx/respx mock，
      避免真实网络请求。
"""

import pytest
from pytest_bdd import given, when, then, parsers, scenarios

# 加载 Feature 文件
scenarios("../../docs/features/e2e_video_lifecycle.feature")


# ---------------------------------------------------------------------------
# Given
# ---------------------------------------------------------------------------

@given('后端服务已启动')
def given_backend_running():
    """确认 FastAPI app 可通过 TestClient / AsyncClient 访问。"""
    # TODO: TDD Agent 实现 — 使用 TestClient(app) 或 AsyncClient(app=app, base_url="http://test")
    pass


@given('前端已连接 SSE 流 /api/sse')
def given_sse_connected():
    """mock 或订阅 SSE 事件流，用于捕获推送消息。"""
    # TODO: TDD Agent 实现 — mock app.services.event_bus.publish
    pass


@given('用户通过 POST /api/sites 创建采集站：')
def given_create_site_via_api(async_client, datatable):
    """
    调用 POST /api/sites 创建站点。
    table: | name | base_url |
    """
    # TODO: TDD Agent 实现 — 读取 table[0] 参数，发送请求，保存 site_id
    pass


@given('站点创建成功，返回 site_id')
def given_site_created():
    """断言响应 200 并提取 site_id 到上下文。"""
    # TODO: TDD Agent 实现
    pass


@given('用户通过 POST /api/sites 创建一个已知不可用的采集站')
def given_create_unavailable_site(async_client):
    """创建 base_url 指向不可达地址的 Site。"""
    # TODO: TDD Agent 实现
    pass


@given('用户已完成站点创建、视频搜索、获取详情和创建下载任务')
def given_prerequisite_steps_completed():
    """组合前置步骤：完成 E2E 主流程直到任务创建。"""
    # TODO: TDD Agent 实现 — 可复用上述 Given 步骤或内联执行
    pass


@given('下载任务状态为 downloading')
def given_task_downloading():
    """将 DownloadTask 状态设为 downloading，或等待 worker 开始。"""
    # TODO: TDD Agent 实现
    pass


# ---------------------------------------------------------------------------
# When
# ---------------------------------------------------------------------------

@when('用户通过 GET /api/videos/search?wd=测试 搜索视频')
def when_search_videos(async_client):
    """调用 GET /api/videos/search?wd=测试。"""
    # TODO: TDD Agent 实现 — mock SourceClient 或依赖内存数据库中已有 VideoCache
    pass


@when('用户选择第一个视频，通过 POST /api/videos/detail 获取详情')
def when_get_video_detail(async_client):
    """调用 POST /api/videos/detail，body 含 title/year 等。"""
    # TODO: TDD Agent 实现
    pass


@when('用户通过 GET /api/play/episodes?site_id={site_id}&original_id={original_id} 获取集数列表')
def when_get_episodes_e2e(async_client):
    """调用 GET /api/play/episodes。"""
    # TODO: TDD Agent 实现
    pass


@when('用户通过 POST /api/downloads 创建下载任务，选择第 1 集')
def when_create_download_task(async_client):
    """调用 POST /api/downloads，body 含 url/file_path/suffix 等。"""
    # TODO: TDD Agent 实现
    pass


@when('下载 worker 调度该任务')
def when_worker_schedules_task():
    """触发或等待 download_worker 消费 queued 任务。"""
    # TODO: TDD Agent 实现 — 直接调用 _run_download(task_id)
    pass


@when('用户通过 GET /api/downloads 查询任务列表')
def when_list_download_tasks(async_client):
    """调用 GET /api/downloads。"""
    # TODO: TDD Agent 实现
    pass


@when('系统每 10 分钟执行健康探测')
def when_health_probe_runs():
    """触发 _probe_all_sites()。"""
    # TODO: TDD Agent 实现
    pass


@when('用户尝试搜索该站点视频')
def when_search_disabled_site(async_client):
    """调用 GET /api/videos/search，验证 disabled 站点视频不被返回。"""
    # TODO: TDD Agent 实现 — 断言结果中无该站点视频
    pass


@when(parsers.parse('用户通过 POST /api/downloads/{task_id}/pause 暂停任务'))
def when_pause_download_task(task_id: str):
    """调用 POST /api/downloads/{task_id}/pause。"""
    # TODO: TDD Agent 实现
    pass


@when(parsers.parse('用户通过 POST /api/downloads/{task_id}/resume 恢复任务'))
def when_resume_download_task(task_id: str):
    """调用 POST /api/downloads/{task_id}/resume。"""
    # TODO: TDD Agent 实现
    pass


# ---------------------------------------------------------------------------
# Then
# ---------------------------------------------------------------------------

@then('返回视频列表，至少包含 1 条结果')
def then_search_has_results():
    """断言响应 data 数组长度 >= 1。"""
    # TODO: TDD Agent 实现
    pass


@then('返回视频详情，包含 play_url_raw 字段')
def then_detail_has_play_url_raw():
    """断言响应中存在 play_url_raw 且非空。"""
    # TODO: TDD Agent 实现
    pass


@then('返回 Episode 列表')
def then_episodes_list_returned():
    """断言 /api/play/episodes 返回非空数组。"""
    # TODO: TDD Agent 实现
    pass


@then('每个 Episode 的 suffix 不为 feifan（已被解析或替换）')
def then_no_feifan_suffix():
    """断言所有 Episode.suffix != "feifan"。"""
    # TODO: TDD Agent 实现
    pass


@then('每个 Episode 的 url 为可直接播放的真实地址')
def then_real_playable_url():
    """断言所有 Episode.url 为合法 URL（http/https 开头）。"""
    # TODO: TDD Agent 实现
    pass


@then('返回下载任务，状态为 queued')
def then_task_queued():
    """断言响应 status == "queued"。"""
    # TODO: TDD Agent 实现
    pass


@then('SSE 推送 download_progress 事件')
def then_sse_download_progress():
    """断言 event_bus.publish 被调用，事件类型为 download_progress。"""
    # TODO: TDD Agent 实现
    pass


@then('最终 SSE 推送 download_status 事件，status 为 done')
def then_sse_download_status_done():
    """断言 event_bus.publish 被调用，事件类型为 download_status，status=done。"""
    # TODO: TDD Agent 实现
    pass


@then('任务状态为 done')
def then_e2e_task_done():
    """断言数据库或 API 返回中 status == "done"。"""
    # TODO: TDD Agent 实现
    pass


@then('file_path 指向存在的视频文件')
def then_file_exists():
    """断言 Path(file_path).exists() is True。"""
    # TODO: TDD Agent 实现
    pass


@then("最终任务状态变为 done")
def then_task_status_done_e2e():
    """Alias for Chinese wording variant."""
    # TODO: TDD Agent 实现
    pass

@then(parsers.parse('经过 {count:d} 次连续失败后，SSE 推送 site_health 事件，enabled 为 False'))
def then_site_disabled_after_failures(count: int):
    """断言 _on_probe_failure 被调用 count 次后，SSE 收到 site_health(enabled=False)。"""
    # TODO: TDD Agent 实现
    pass


@then('搜索结果中不包含该站点视频（因站点已被自动禁用）')
def then_no_videos_from_disabled_site():
    """断言搜索结果中所有结果的 source_site_id 均不等于被禁用站点。"""
    # TODO: TDD Agent 实现
    pass


@then('任务状态变为 paused')
def then_task_status_paused_e2e():
    """断言 API 返回或数据库中 status == "paused"。"""
    # TODO: TDD Agent 实现
    pass


@then('SSE 推送 download_status 事件，status 为 paused')
def then_sse_status_paused():
    """断言 event_bus.publish 被调用，事件类型为 download_status，status=paused。"""
    # TODO: TDD Agent 实现
    pass


@then('任务状态变为 queued')
def then_task_status_queued():
    """断言 API 返回或数据库中 status == "queued"。"""
    # TODO: TDD Agent 实现
    pass


@then('下载 worker 重新调度时从已下载位置续传')
def then_worker_resumes_from_position():
    """断言 Range 请求头起始字节等于已下载大小，或 .ts 片段跳过已存在文件。"""
    # TODO: TDD Agent 实现
    pass
