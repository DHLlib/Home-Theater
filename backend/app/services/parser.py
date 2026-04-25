"""集数$地址$后缀 多行播放/下载地址解析器（硬契约）。

资源站约定：每行一集，格式严格为 集数$地址$后缀。
解析失败必须抛 ValueError，不允许吞掉或猜测。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Episode:
    ep_name: str
    url: str
    suffix: str
    index: int


def parse_episodes(raw: str) -> list[Episode]:
    """把 '集数$地址$后缀\\n...' 多行字符串解析为 Episode 列表。

    - 按 '\\n' 切行，跳过空行
    - 每行用 '$' 切成恰好 3 段；不足 3 段抛 ValueError
    - 字段顺序固定：ep_name / url / suffix
    - index 从 0 开始，按出现顺序赋值
    """
    if raw is None:
        return []
    episodes: list[Episode] = []
    for lineno, line in enumerate(raw.splitlines()):
        s = line.strip()
        if not s:
            continue
        parts = s.split("$")
        if len(parts) < 3:
            raise ValueError(
                f"播放/下载行格式不合规（第 {lineno + 1} 行）：'{s}'，"
                f"期望 '集数$地址$后缀'"
            )
        ep_name, url, suffix = parts[0], parts[1], "$".join(parts[2:])
        episodes.append(
            Episode(
                ep_name=ep_name.strip(),
                url=url.strip(),
                suffix=suffix.strip(),
                index=len(episodes),
            )
        )
    return episodes
