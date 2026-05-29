Feature: AC-013 站点健康监控与自动禁用
  作为系统管理员
  我希望系统能自动探测站点健康状态
  以便在站点不可用时自动禁用，恢复时自动启用

  Background:
    Given 探测间隔 PROBE_INTERVAL 为 600 秒
    And 失败阈值 FAIL_THRESHOLD 为 3
    And 恢复阈值 RECOVER_THRESHOLD 为 2

  Scenario: 站点连续探测失败 3 次后自动禁用
    Given 存在一个已启用的采集站点
    When 该站点连续 3 次探测失败
    Then 站点 enabled 变为 False
    And auto_disabled_at 被设置为当前时间
    And 通过 SSE 推送 site_health 事件，enabled 为 False

  Scenario: 被自动禁用的站点连续成功 2 次后自动恢复
    Given 存在一个已被自动禁用的采集站点
    When 该站点连续 2 次探测成功
    Then 站点 enabled 变为 True
    And auto_disabled_at 被清空
    And 通过 SSE 推送 site_health 事件，enabled 为 True

  Scenario: 手动禁用的站点不参与自动恢复
    Given 存在一个已被手动禁用的采集站点，auto_disabled_at 为空
    When 该站点连续多次探测成功
    Then 站点保持禁用状态
    And 不发送恢复 SSE 事件

  Scenario: 成功计数和失败计数独立清零
    Given 存在一个采集站点
    When 该站点连续失败 2 次
    Then 失败计数为 2
    When 下一次探测成功
    Then 失败计数被清零
    And 恢复计数开始累加

  Scenario: 站点探测正常但 list 为空时返回合规提示
    Given 存在一个响应合规但 list 为空的采集站点
    When 调用 health.probe 探测
    Then 返回 ok=True
    And latency_ms 不为空
    And error 提示 "list 为空，但响应合规"

  Scenario: 探测超时时返回超时错误
    Given 存在一个网络延迟极高的采集站点
    When 调用 health.probe 探测
    Then 返回 ok=False
    And error 包含 "超时"

  Scenario: 探测循环每 600 秒执行一次
    Given 调度器已启动
    When 经过 600 秒
    Then _probe_all_sites 被调用一次
