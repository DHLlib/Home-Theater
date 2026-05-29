Feature: E2E 视频全生命周期
  作为终端用户
  我希望完成从添加站点、搜索视频、获取播放地址到下载视频的完整流程
  以便验证系统端到端功能正常

  Background:
    Given 后端服务已启动
    And 前端已连接 SSE 流 /api/sse

  Scenario: 完整视频生命周期——站点创建到下载完成
    Given 用户通过 POST /api/sites 创建采集站：
      | name     | base_url                      |
      | 测试站点 | https://mock-cms.example.com |
    And 站点创建成功，返回 site_id

    When 用户通过 GET /api/videos/search?wd=测试 搜索视频
    Then 返回视频列表，至少包含 1 条结果

    When 用户选择第一个视频，通过 POST /api/videos/detail 获取详情
    Then 返回视频详情，包含 play_url_raw 字段

    When 用户通过 GET /api/play/episodes?site_id={site_id}&original_id={original_id} 获取集数列表
    Then 返回 Episode 列表
    And 每个 Episode 的 suffix 不为 feifan（已被解析或替换）
    And 每个 Episode 的 url 为可直接播放的真实地址

    When 用户通过 POST /api/downloads 创建下载任务，选择第 1 集
    Then 返回下载任务，状态为 queued

    When 下载 worker 调度该任务
    Then SSE 推送 download_progress 事件
    And 最终 SSE 推送 download_status 事件，status 为 done

    When 用户通过 GET /api/downloads 查询任务列表
    Then 任务状态为 done
    And file_path 指向存在的视频文件

  Scenario: 端到端异常——站点不可用导致下载失败
    Given 用户通过 POST /api/sites 创建一个已知不可用的采集站
    When 系统每 10 分钟执行健康探测
    Then 经过 3 次连续失败后，SSE 推送 site_health 事件，enabled 为 False

    When 用户尝试搜索该站点视频
    Then 搜索结果中不包含该站点视频（因站点已被自动禁用）

  Scenario: 端到端断点续传——用户暂停后继续下载
    Given 用户已完成站点创建、视频搜索、获取详情和创建下载任务
    And 下载任务状态为 downloading
    When 用户通过 POST /api/downloads/{task_id}/pause 暂停任务
    Then 任务状态变为 paused
    And SSE 推送 download_status 事件，status 为 paused

    When 用户通过 POST /api/downloads/{task_id}/resume 恢复任务
    Then 任务状态变为 queued
    And 下载 worker 重新调度时从已下载位置续传
    And 最终任务状态变为 done
