"""站点分类映射工作台的纯函数测试（不依赖数据库）。

覆盖两个容易被改坏的点：
- 相似类名聚类的阈值行为（变体合并，但「通用 vs 细分」不合并）
- 建议的来源与置信度（规则 / 相似度 / 无建议）
"""

from app.services.category_map import CLUSTER_RATIO, _cluster_names, _similar, _suggest

SYSTEMS = ["动作片", "伦理片", "成人", "古装短剧", "国产动漫", "其他资源"]


def test_cluster_merges_variants():
    groups = _cluster_names(["福利", "福利片", "伦理", "伦理片"])
    merged = [sorted(group) for group in groups]
    assert sorted(["福利", "福利片"]) in merged
    assert sorted(["伦理", "伦理片"]) in merged


def test_cluster_keeps_generic_and_specific_apart():
    """「短剧」和「古装短剧」是通用 vs 细分，不应该被并成一组。"""
    groups = _cluster_names(["短剧", "古装短剧"])
    assert sorted(len(group) for group in groups) == [1, 1]


def test_cluster_threshold():
    assert _similar("福利", "福利片") >= CLUSTER_RATIO
    assert _similar("短剧", "古装短剧") < CLUSTER_RATIO


def test_suggest_prefers_history():
    name, source, confidence = _suggest("福利", {"福利": "成人"}, SYSTEMS)
    assert (name, source) == ("成人", "history")
    assert confidence >= 0.9


def test_suggest_falls_back_to_rule_then_none():
    name, source, _ = _suggest("国产动画", {}, SYSTEMS)
    assert source == "rule"
    assert name in SYSTEMS

    name, source, confidence = _suggest("AI漫剧", {}, SYSTEMS)
    assert (name, source, confidence) == (None, "none", 0.0)
