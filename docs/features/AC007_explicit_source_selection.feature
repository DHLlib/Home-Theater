Feature: AC-007 显式选源
  作为用户
  我希望在播放或下载前强制选择来源
  并且系统不允许自动默认选中任何来源

  Scenario: 播放时强制选源
    Given 用户进入视频详情页并点击播放
    When SourcePicker 弹窗打开
    Then 默认没有任何来源被选中
    And 确定按钮处于 disabled 状态

  Scenario: 选择来源后才能播放
    Given SourcePicker 已打开
    When 用户点击某个来源
    Then 该来源被高亮选中
    And 确定按钮变为可用
    When 用户点击确定
    Then 跳转到播放器并加载所选来源

  Scenario: 取消选源
    Given SourcePicker 已打开
    When 用户点击取消或遮罩层
    Then 关闭弹窗，不进入播放
