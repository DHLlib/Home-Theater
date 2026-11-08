"""分类别名/站点例外投票逻辑测试。"""

from app.services.category_alias import normalize_category_name, pick_system_category

ALIASES = {
    "动作片": {"system_name": "动作片", "enabled": True, "raw_names": ["动作片"]},
    "伦理片": {"system_name": "伦理片", "enabled": True, "raw_names": ["伦理片"]},
}
SORT = {"动作片": 1, "伦理片": 8}
OVERRIDES = {(2, "动作片"): "伦理片"}


def test_normalize_category_name():
    assert normalize_category_name(" 动作片 ") == "动作片"
    assert normalize_category_name("动作片（动作）") == "动作片(动作)"
    assert normalize_category_name(None) == ""


def test_pick_uses_alias_by_default():
    assert pick_system_category([(1, "动作片")], ALIASES, {}, SORT) == "动作片"


def test_pick_prefers_site_override():
    # 站点 2 的「动作片」被例外改成伦理片
    assert pick_system_category([(2, "动作片")], ALIASES, OVERRIDES, SORT) == "伦理片"


def test_pick_override_only_affects_its_site():
    # 两个站点各一票：动作片 vs 伦理片 → 平票取 sort 小的（动作片）
    sources = [(1, "动作片"), (2, "动作片")]
    assert pick_system_category(sources, ALIASES, OVERRIDES, SORT) == "动作片"
    # 两个来源都在站点 2 → 伦理片两票
    assert (
        pick_system_category([(2, "动作片"), (2, "动作片")], ALIASES, OVERRIDES, SORT)
        == "伦理片"
    )


def test_pick_returns_none_when_nothing_matches():
    assert pick_system_category([(1, "未知分类")], ALIASES, OVERRIDES, SORT) is None
