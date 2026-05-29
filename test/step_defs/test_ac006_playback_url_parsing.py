"""
AC-006 播放地址解析 — Step Definitions 骨架
依赖: pytest-bdd（需在 test/requirements.txt 中安装）

覆盖模块:
  - app.services.parser.parse_episodes
  - app.services.resolver.resolve_feifan
  - app.api.play.get_episodes (GET /api/play/episodes)
"""

import pytest
from pytest_bdd import given, when, then, parsers, scenarios

# 加载 Feature 文件
scenarios("../../docs/features/AC006_playback_url_parsing.feature")


# ---------------------------------------------------------------------------
# Given
# ---------------------------------------------------------------------------

@given('资源站返回的原始播放字符串格式为 "集数$地址$后缀"')
def raw_format():
    """确认硬契约格式。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('原始播放字符串为 "{raw}"'))
def given_raw_string(raw: str):
    """提供单行的原始播放字符串。"""
    # TODO: TDD Agent 实现
    pass


@given('原始播放字符串为：')
def given_multiline_raw_string(docstring):
    """提供多行的原始播放字符串（使用 Gherkin DocString）。"""
    # TODO: TDD Agent 实现
    pass


@given(parsers.parse('存在一个 feifan 分享页，包含 HTML：'))
def given_feifan_page(docstring):
    """构造 feifan 分享页 mock 响应（含 const url = "..."）。"""
    # TODO: 使用 respx/httpx_mock 拦截请求，返回 docstring 中的 HTML
    pass


@given(parsers.parse('分享页地址为 "{url}"'))
def given_feifan_url(url: str):
    """记录 feifan 分享页地址。"""
    # TODO: TDD Agent 实现
    pass


@given('存在一个 feifan 分享页，包含 HTML "无视频链接"')
def given_feifan_page_no_url():
    """构造不含 const url 的 feifan 分享页 mock 响应。"""
    # TODO: TDD Agent 实现
    pass


@given('feifan 分享页网络不可达')
def given_feifan_unreachable():
    """模拟 feifan 分享页网络异常（如 timeout/connection refused）。"""
    # TODO: 使用 respx/httpx_mock 模拟异常
    pass


@given('原始播放字符串为空')
def given_empty_raw():
    """提供空字符串或 None。"""
    # TODO: TDD Agent 实现
    pass


# ---------------------------------------------------------------------------
# When
# ---------------------------------------------------------------------------

@when('调用 parse_episodes 解析')
def when_parse_episodes():
    """调用 app.services.parser.parse_episodes。"""
    # TODO: TDD Agent 实现
    pass


@when('调用 resolve_feifan 解析')
def when_resolve_feifan():
    """调用 app.services.resolver.resolve_feifan。"""
    # TODO: TDD Agent 实现
    pass


@when('通过 GET /api/play/episodes 获取集数列表')
def when_get_episodes_api(async_client):
    """调用 API: GET /api/play/episodes?site_id={site_id}&original_id={original_id}。"""
    # TODO: TDD Agent 实现 — 需预先在数据库插入 Site 和 mock SourceClient.videolist
    pass


# ---------------------------------------------------------------------------
# Then
# ---------------------------------------------------------------------------

@then(parsers.parse('返回 {count:d} 个 Episode 对象'))
def then_episode_count(count: int):
    """断言解析结果长度。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('第 {idx:d} 个 Episode 的 ep_name 为 "{ep_name}", url 为 "{url}", suffix 为 "{suffix}"'))
def then_episode_fields(idx: int, ep_name: str, url: str, suffix: str):
    """断言指定 Episode 的字段值。"""
    # TODO: TDD Agent 实现
    pass


@then('抛出 ValueError，提示格式不合规')
def then_value_error_format():
    """断言抛出的异常类型及提示信息。"""
    # TODO: TDD Agent 实现 — 使用 pytest.raises(ValueError)
    pass


@then('返回空列表')
def then_empty_list():
    """断言返回 []。"""
    # TODO: TDD Agent 实现
    pass


@then('索引从 0 开始顺序赋值，分别为 0 和 1')
def then_index_sequential():
    """断言 Episode.index 按出现顺序从 0 递增。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('第 {idx:d} 个 Episode 的 suffix 为 "{suffix}"'))
def then_episode_suffix(idx: int, suffix: str):
    """断言指定 Episode 的 suffix。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('返回 "{expected_url}"'))
def then_returned_url(expected_url: str):
    """断言 resolve_feifan 返回值。"""
    # TODO: TDD Agent 实现
    pass


@then('返回 None')
def then_returned_none():
    """断言返回 None。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('在 GET /api/play/episodes 接口中，feifan 后缀被统一替换为 "{suffix}"'))
def then_feifan_replaced_in_api(suffix: str):
    """断言 API 层对 feifan 后缀的统一替换逻辑。"""
    # TODO: TDD Agent 实现
    pass


@then(parsers.parse('返回的 Episode 的 suffix 为 "{suffix}"'))
def then_api_response_suffix(suffix: str):
    """断言 API 响应中所有 Episode 的 suffix。"""
    # TODO: TDD Agent 实现
    pass
