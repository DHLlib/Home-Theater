Feature: AC-016 下载进度实时推送（SSE）
  作为用户
  我希望实时看到下载进度和状态变化
  而无需手动刷新页面

  Background:
    Given 用户已打开下载任务列表页

  Scenario: 订阅 SSE 事件流
    When 前端页面加载完成
    Then 前端建立到 /api/sse 的 EventSource 连接

  Scenario: 下载进度实时更新
    Given 存在一个正在下载的任务
    When 下载 worker 每写入一批数据
    Then 服务端通过 SSE 推送 download_progress 事件
    And 前端进度条实时更新

  Scenario: 下载状态变化推送
    Given 一个任务从 queued 变为 downloading
    When 状态变化时
    Then 服务端推送 download_status 事件
    And 前端任务卡片状态同步更新

  Scenario: 站点健康状态推送
    Given 某站点因连续失败被自动禁用
    When 健康监控触发状态变化时
    Then 服务端推送 site_health 事件
    And 前端显示该站点已禁用

  Scenario: 自动重连
    Given SSE 连接意外断开
    When 等待 3 秒后
    Then 前端自动尝试重新建立连接
