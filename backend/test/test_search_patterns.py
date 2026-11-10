"""搜索关键字变换的纯函数测试（不依赖数据库）。

覆盖两个容易被改坏的点：
- LIKE 元字符必须按字面转义，否则 `%` 会变成「匹配全库」
- 2 字子串的「字符加倍」变换必须与索引表达式完全对齐
"""

from app.api.videos import _doubled_keyword, _like_escaped


def test_like_escaped_metacharacters():
    assert _like_escaped("50%") == r"50\%"
    assert _like_escaped("a_b") == r"a\_b"
    assert _like_escaped(r"c\d") == r"c\\d"
    assert _like_escaped("白蛇") == "白蛇"


def test_doubled_keyword():
    assert _doubled_keyword("白蛇") == "白白蛇蛇"
    assert _doubled_keyword("aB") == "aabb"  # 先小写再加倍，与 lower(title) 对齐
    assert _doubled_keyword("烤鸭") == "烤烤鸭鸭"


def test_doubled_keyword_pattern_is_indexable():
    """加倍后长度 >= 3 才能提取 trigram，2 字关键字正好 4 个字符。"""
    assert len(_doubled_keyword("白蛇")) >= 3
