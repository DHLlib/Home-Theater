Feature: AC-009 播放进度记录与恢复
  作为用户
  我希望系统记录我的播放进度
  并在重新进入时从上次位置继续播放

  Background:
    Given 用户正在播放某视频

  Scenario: 定时上报进度
    When 播放时间达到 15 秒、30 秒、45 秒...
    Then 系统调用 POST /api/progress 上报当前播放位置

  Scenario: 页面卸载时兜底上报
    When 用户关闭或刷新播放页
    Then 浏览器通过 sendBeacon 发送最后一次进度上报

  Scenario: 按进度恢复播放
    Given 用户此前已上报过该视频的进度
    When 用户重新进入播放页
    Then 系统调用 GET /api/progress 获取上次进度
    And 播放器从该位置开始播放
