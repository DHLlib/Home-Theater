"""
AC-013 站点健康监控与自动禁用 — Step Definitions 骨架
依赖: pytest-bdd（需在 test/requirements.txt 中安装）

覆盖模块:
  - app.services.scheduler._probe_loop
  - app.services.scheduler._on_probe_success
  - app.services.scheduler._on_probe_failure
  - app.services.health.probe
  - app.api.sse (SSE 推送 site_health 事件)
"""

import pytest
from pytest_bdd import given, when, then, parsers, scenarios

# 加载 Feature 文件
scenarios("../../docs/features/AC013_site_health_monitoring.feature")


# ---------------------------------------------------------------------------
# Given
# ---------------------------------------------------------------------------

@given(parsers.parse('探测间隔 PROBE_INTERVAL 为 {interval:d} 秒'))
def given_probe_interval(interval: int):
    """断言 app.services.scheduler.PROBE_INTERVAL == interval。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('失败阈值 FAIL_THRESHOLD 为 {threshold:d}'))
def given_fail_threshold(threshold: int):
    """断言 app.services.scheduler.FAIL_THRESHOLD == threshold。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('恢复阈值 RECOVER_THRESHOLD 为 {threshold:d}'))
def given_recover_threshold(threshold: int):
    """断言 app.services.scheduler.RECOVER_THRESHOLD == threshold。"""
    # TODO: TDD Agent 实现
    pass


@given('存在一个已启用的采集站点')
def given_enabled_site(db_session):
    """插入 Site(enabled=True, auto_disabled_at=None)。"""
    # TODO: TDD Agent 实现
    pass


@given('存在一个已被自动禁用的采集站点')
def given_auto_disabled_site(db_session):
    """插入 Site(enabled=False, auto_disabled_at=datetime.utcnow())。"""
    # TODO: TDD Agent 实现
    pass


@given('存在一个已被手动禁用的采集站点，auto_disabled_at 为空')
def given_manually_disabled_site(db_session):
    """插入 Site(enabled=False, auto_disabled_at=None)。"""
    # TODO: TDD Agent 实现
    pass


@given('存在一个采集站点')
def given_any_site(db_session):
    """插入任意 Site。"""
    # TODO: TDD Agent 实现
    pass


@given('存在一个响应合规但 list 为空的采集站点')
def given_compliant_empty_site():
    """mock SourceClient.list 返回 []（不抛异常）。"""
    # TODO: TDD Agent 实现 — mock SourceClient 或 httpx
    pass


@given('存在一个网络延迟极高的采集站点')
def given_slow_site():
    """mock probe 请求超时。"""
    # TODO: TDD Agent 实现 — respx 配置长时间无响应或超时异常
    pass


@given('调度器已启动')
def given_scheduler_started():
    """启动 init_scheduler() 并获取 task 句柄。"""
    # TODO: TDD Agent 实现 — 注意用 asyncio.Event 控制循环节奏
    pass


# ---------------------------------------------------------------------------
# When
# ---------------------------------------------------------------------------

@when(parsers.parse('该站点连续 {count:d} 次探测失败'))
def when_probe_fails_consecutive(count: int):
    """连续调用 _on_probe_failure count 次。"""
    # TODO: TDD Agent 实现
    pass


@when(parsers.parse('该站点连续 {count:d} 次探测成功'))
def when_probe_succeeds_consecutive(count: int):
    """连续调用 _on_probe_success count 次。"""
    # TODO: TDD Agent 实现
    pass


@when('该站点连续多次探测成功')
def when_probe_succeeds_many():
    """连续调用 _on_probe_success 超过 RECOVER_THRESHOLD 次。"""
    # TODO: TDD Agent 实现
    pass


@when(parsers.parse('该站点连续失败 {count:d} 次'))
def when_failure_count_reaches(count: int):
    """模拟 count 次探测失败。"""
    # TODO: TDD Agent 实现
    pass


@when('下一次探测成功')
def when_next_probe_succeeds():
    """调用一次 _on_probe_success。"""
    # TODO: TDD Agent 实现
    pass


@when('调用 health.probe 探测')
def when_call_probe():
    """调用 app.services.health.probe(site_id, base_url, name)。"""
    # TODO: TDD Agent 实现
    pass


@when(parsers.parse('经过 {seconds:d} 秒'))
def when_time_elapses(seconds: int):
    """在测试中快进时间（如使用 freezegun 或 mock asyncio.sleep）。"""
    # TODO: TDD Agent 实现
    pass


# ---------------------------------------------------------------------------
# Then
# ---------------------------------------------------------------------------

@then('站点 enabled 变为 False')
def then_site_disabled():
    """断言数据库 Site.enabled == False。"""
    # TODO: TDD Agent 实现
    pass


@then('auto_disabled_at 被设置为当前时间')
def then_auto_disabled_timestamp():
    """断言 Site.auto_disabled_at 为最近的时间戳。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('通过 SSE 推送 site_health 事件，enabled 为 {enabled}'))
def then_sse_site_health(enabled: str):
    """断言 event_bus.publish 被调用，事件类型为 site_health，payload 含 enabled。"""
    # TODO: TDD Agent 实现 — mock app.services.event_bus.publish
    pass


@then('站点 enabled 变为 True')
def then_site_enabled():
    """断言数据库 Site.enabled == True。"""
    # TODO: TDD Agent 实现
    pass


@then('auto_disabled_at 被清空')
def then_auto_disabled_cleared():
    """断言 Site.auto_disabled_at is None。"""
    # TODO: TDD Agent 实现
    pass


@then('站点保持禁用状态')
def then_site_remains_disabled():
    """断言 Site.enabled == False。"""
    # TODO: TDD Agent 实现
    pass


@then('不发送恢复 SSE 事件')
def then_no_recovery_sse():
    """断言 event_bus.publish 未被调用或 payload 不含恢复信息。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('失败计数为 {count:d}'))
def then_failure_count(count: int):
    """断言 _failure_counts[site_id] == count。"""
    # TODO: TDD Agent 实现
    pass


@then('失败计数被清零')
def then_failure_count_cleared():
    """断言 site_id 不在 _failure_counts 中。"""
    # TODO: TDD Agent 实现
    pass


@then('恢复计数开始累加')
def then_recovery_count_started():
    """断言 _recovery_counts[site_id] >= 1。"""
    # TODO: TDD Agent 实现
    pass


@then('返回 ok=True')
def then_probe_ok():
    """断言 ProbeResult.ok is True。"""
    # TODO: TDD Agent 实现
    pass


@then('latency_ms 不为空')
def then_latency_not_none():
    """断言 ProbeResult.latency_ms is not None。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('error 提示 "{message}"'))
def then_error_message(message: str):
    """断言 ProbeResult.error 包含指定文本。"""
    # TODO: TDD Agent 实现
    pass


@then('返回 ok=False')
def then_probe_not_ok():
    """断言 ProbeResult.ok is False。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('error 包含 "{snippet}"'))
def then_error_contains(snippet: str):
    """断言 ProbeResult.error 包含指定片段。"""
    # TODO: TDD Agent 实现
    pass


@then('_probe_all_sites 被调用一次')
def then_probe_all_sites_called():
    """断言 _probe_all_sites 在指定时间窗口内被调用一次。"""
    # TODO: TDD Agent 实现 — mock _probe_all_sites 并统计调用次数
    pass
