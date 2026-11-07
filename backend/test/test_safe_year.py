from datetime import datetime

from app.services.source_client import (
    _resolve_year,
    _safe_year,
    _year_from_title,
)


def test_regular_year():
    assert _safe_year("2024") == 2024
    assert _safe_year(2024) == 2024
    assert _safe_year(" 2019 ") == 2019


def test_year_concatenated_with_date():
    # 部分站点返回 "201717"（yyyy + 月日），取前四位
    assert _safe_year("201717") == 2017
    assert _safe_year("20240101") == 2024


def test_next_year_allowed_but_further_future_rejected():
    next_year = datetime.now().year + 1
    assert _safe_year(str(next_year)) == next_year
    assert _safe_year(str(next_year + 1)) is None
    assert _safe_year("2033") is None


def test_garbage_and_empty():
    assert _safe_year(None) is None
    assert _safe_year("") is None
    assert _safe_year("未知") is None
    assert _safe_year("1800") is None
    assert _safe_year("0") is None


def test_placeholder_year_falls_back_to_pubdate():
    # 真实样本：vod_year=2028、vod_pubdate=2024-05-01
    assert (
        _resolve_year("2028", pubdate="2024-05-01", name="十字区的最后国王第二季")
        == 2024
    )


def test_placeholder_year_falls_back_to_title():
    assert _resolve_year("2028", name="沙丘2 (2024)") == 2024
    assert _resolve_year("", name="某部电影【2023】") == 2023
    assert _resolve_year("2028", name="名侦探柯南：黑铁的鱼影 2023") == 2023


def test_title_without_separator_is_not_a_year():
    # 纯数字片名不能被当成年份来源
    assert _year_from_title("1917") is None
    assert _year_from_title("2046") is None
    assert _year_from_title("2001 太空漫游") is None
    assert _year_from_title("十字区的最后国王第二季") is None


def test_update_time_tightens_upper_bound():
    # 2025 年更新的条目，2027 上映也不合理（上界收紧到 2026）
    assert _resolve_year("2027", updated_at="2025-01-10 22:26:10") is None
    assert _resolve_year("2026", updated_at="2025-01-10 22:26:10") == 2026


def test_plausible_explicit_year_wins():
    assert _resolve_year("2024", pubdate="2019-01-01", name="某片 2018") == 2024
