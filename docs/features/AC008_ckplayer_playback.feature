Feature: AC-008 ckplayer 播放
  作为用户
  我希望使用 ckplayer 播放视频
  并支持上一集/下一集、进度恢复和键盘控制

  Background:
    Given 用户已显式选择来源并进入播放页

  Scenario: 正常播放
    When 播放器加载视频
    Then ckplayer 正确初始化并播放视频

  Scenario: 上一集/下一集
    Given 当前视频有多个集数
    When 用户点击「下一集」
    Then 播放器加载并播放下一集
    When 用户在第一集点击「上一集」
    Then 上一集按钮为禁用状态

  Scenario: 进度恢复
    Given 用户此前已观看该视频至 300 秒
    When 用户再次进入播放页
    Then 播放器自动 seek 到 300 秒继续播放

  Scenario: 键盘快进快退
    Given 视频正在播放
    When 用户按下 ArrowRight
    Then 视频向前跳转 15 秒
    When 用户长按 ArrowRight 超过 2 秒
    Then 视频进入连续快进，每次 5 秒
