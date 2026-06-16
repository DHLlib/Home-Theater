"""m3u8 播放列表清洗：剔除服务端插入的广告片段。

当前策略（按优先级）：
1. #EXT-X-CUE-OUT / #EXT-X-CUE-IN 标记区间内的片段视为广告
2. 片段 URL 匹配常见广告域名/路径黑名单
3. 被 #EXT-X-DISCONTINUITY 包围且匹配黑名单的片段视为广告
4. 被 #EXT-X-DISCONTINUITY 隔离的短 pod（总时长/片段数均小）视为广告

注意：
- 仅处理 playlist 级别的广告插片；画面烧录广告、前端浮层广告无法去除
- 删除片段后会在边界插入 #EXT-X-DISCONTINUITY，提示播放器时间轴不连续
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from urllib.parse import quote, urljoin, urlparse

import httpx

from app.constants import DEFAULT_USER_AGENT, HTTP_TIMEOUT_RESOLVE

logger = logging.getLogger(__name__)

# 常见广告域名/路径黑名单（不区分大小写）
_DEFAULT_AD_PATTERNS = [
    r"doubleclick\.net",
    r"googlesyndication\.com",
    r"googleadservices\.com",
    r"googleads\.g\.doubleclick\.net",
    r"securepubads\.g\.doubleclick\.net",
    r"pubads\.g\.doubleclick\.net",
    r"gstatic\.com",
    r"imasdk\.googleapis\.com",
    r"dai\.google\.com",
    r"adservice",
    r"amazon-adsystem",
    r"facebook\.com/tr",
    r"freewheel",
    r"spotx",
    r"smartadserver",
    r"moatads",
    r"serving-sys",
    r"adsystem",
    r"adtago",
]

# 基于 discontinuity 的短片段广告 pod 阈值
_AD_POD_MAX_DURATION = 20.0  # 秒
_AD_POD_MAX_SEGMENTS = 5


@dataclass
class _Segment:
    tags: list[str] = field(default_factory=list)
    duration: float = 0.0
    title: str = ""
    url: str = ""
    is_ad: bool = False


def _compile_patterns(patterns: list[str] | None) -> list[re.Pattern]:
    if patterns is None:
        return _DEFAULT_AD_PATTERNS_COMPILED
    return [re.compile(p, re.IGNORECASE) for p in patterns]


_DEFAULT_AD_PATTERNS_COMPILED = _compile_patterns(_DEFAULT_AD_PATTERNS)


def _to_absolute(base_url: str, path: str) -> str:
    """把相对 URL 转为绝对 URL；保留查询参数。"""
    path = path.strip()
    if path.startswith(("http://", "https://")):
        return path
    return urljoin(base_url, path)


def _rewrite_tag_uri(line: str, base_url: str) -> str:
    """重写 #EXT-X-KEY / #EXT-X-MAP 等标签中的 URI 为绝对地址。"""

    def repl(m: re.Match) -> str:
        prefix = m.group(1)
        uri = m.group(2)
        abs_uri = _to_absolute(base_url, uri)
        return f'{prefix}"{abs_uri}"'

    return re.sub(r'(URI=)["\']([^"\']+)["\']', repl, line)


def _proxy_url_for(original_url: str, base_url: str, site_id: int) -> str:
    """把原始 m3u8 URL 改写为后端代理 URL。"""
    abs_url = _to_absolute(base_url, original_url)
    return f"/api/play/proxy-m3u8?site_id={site_id}&url={quote(abs_url, safe='')}"  # noqa: E501


def _parse_master_playlist(text: str, base_url: str, site_id: int) -> str:
    """主 playlist：把每个 variant URL 改写成代理 URL，其余原样返回。"""
    lines = text.splitlines()
    out: list[str] = []
    prev_was_stream_inf = False
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            # 顺便重写 #EXT-X-MEDIA 等标签里的 URI
            if "URI=" in line:
                line = _rewrite_tag_uri(line, base_url)
            out.append(line)
            prev_was_stream_inf = line.startswith("#EXT-X-STREAM-INF")
            continue
        if prev_was_stream_inf:
            out.append(_proxy_url_for(line, base_url, site_id))
            prev_was_stream_inf = False
        else:
            out.append(_to_absolute(base_url, line))
    return "\n".join(out) + "\n"


def _is_ad_url(url: str, patterns: list[re.Pattern]) -> bool:
    lower = url.lower()
    return any(p.search(lower) for p in patterns)


def _has_discontinuity(seg: _Segment) -> bool:
    return any(t.strip().upper() == "#EXT-X-DISCONTINUITY" for t in seg.tags)


def _mark_short_discontinuity_pods(
    segments: list[_Segment],
    max_duration: float = _AD_POD_MAX_DURATION,
    max_segments: int = _AD_POD_MAX_SEGMENTS,
) -> None:
    """被 #EXT-X-DISCONTINUITY 隔离、且总时长/片段数都很小的整组片段视为广告 pod。

    只处理「后一段也有 #EXT-X-DISCONTINUITY」的 bounded pod，避免把尾部短内容误删。
    扫描时无论是否命中都一次性跳过整个 block，保证 O(n)。
    """
    i = 0
    n = len(segments)
    while i < n:
        if not _has_discontinuity(segments[i]):
            i += 1
            continue

        j = i
        total = 0.0
        bounded = False
        while j < n:
            total += segments[j].duration
            if j + 1 < n and _has_discontinuity(segments[j + 1]):
                bounded = True
                break
            j += 1

        block_len = j - i + 1
        if bounded and total <= max_duration and block_len <= max_segments:
            for k in range(i, j + 1):
                segments[k].is_ad = True

        # 跳转到 block 之后，不再回头检查 block 内部
        i = j + 1


def _mark_ad_segments(
    segments: list[_Segment], patterns: list[re.Pattern] | None = None
) -> None:
    """根据 CUE 标记、URL 黑名单和 discontinuity 短 pod 判断广告片段。"""
    if patterns is None:
        patterns = _DEFAULT_AD_PATTERNS_COMPILED

    in_cue = False
    for seg in segments:
        for tag in seg.tags:
            upper = tag.upper()
            if upper.startswith("#EXT-X-CUE-OUT"):
                in_cue = True
            elif upper.startswith("#EXT-X-CUE-IN"):
                in_cue = False

        ad_by_cue = in_cue
        ad_by_url = _is_ad_url(seg.url, patterns)

        # 被 discontinuity 包围且 URL 像广告的片段也视为广告
        wrapped_by_discontinuity = _has_discontinuity(seg)
        ad_by_discontinuity = wrapped_by_discontinuity and ad_by_url

        seg.is_ad = ad_by_cue or ad_by_url or ad_by_discontinuity

    _mark_short_discontinuity_pods(segments)


def _parse_media_playlist(text: str) -> tuple[list[str], list[_Segment], bool]:
    """解析 media playlist，返回 (header_lines, segments, has_endlist)。"""
    lines = text.splitlines()
    header: list[str] = []
    segments: list[_Segment] = []
    current_tags: list[str] = []
    pending: _Segment | None = None
    has_endlist = False

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if line.startswith("#"):
            upper = line.upper()
            if upper == "#EXT-X-ENDLIST":
                has_endlist = True
                continue

            if upper.startswith("#EXTINF"):
                if not segments:
                    # 第一个片段之前的所有标签视为全局 header
                    header.extend(current_tags)
                    current_tags = []
                m = re.match(r"#EXTINF:\s*([\d.]+)\s*(?:,\s*(.*))?", line)
                duration = float(m.group(1)) if m else 0.0
                title = m.group(2) if m else ""
                pending = _Segment(
                    tags=list(current_tags),
                    duration=duration,
                    title=title or "",
                )
                current_tags = []
            else:
                current_tags.append(line)
            continue

        # 非注释行：URL
        if pending is None:
            # 没有 #EXTINF 的孤立 URL，忽略
            continue

        pending.url = line
        segments.append(pending)
        pending = None

    # 若 playlist 不标准，最后还有未配对标签且没有片段则并入 header
    if current_tags and not segments:
        header.extend(current_tags)

    return header, segments, has_endlist


def _extract_header_value(header: list[str], prefix: str) -> str | None:
    for line in header:
        if line.upper().startswith(prefix.upper()):
            _, _, rest = line.partition(":")
            return rest.strip()
    return None


def _build_media_playlist(
    header: list[str],
    segments: list[_Segment],
    has_endlist: bool,
    base_url: str,
    site_id: int,
) -> str:
    """根据清洗后的片段重建 media playlist。"""
    _mark_ad_segments(segments)

    kept = [s for s in segments if not s.is_ad]
    removed_initial = 0
    for s in segments:
        if s.is_ad:
            removed_initial += 1
        else:
            break

    # 统计在第一个保留片段之前被移除的 discontinuity 数量
    removed_disc_before_first = 0
    for s in segments[:removed_initial]:
        removed_disc_before_first += sum(
            1 for t in s.tags if t.strip().upper() == "#EXT-X-DISCONTINUITY"
        )

    # 调整序列号
    new_media_seq = 0
    media_seq_str = _extract_header_value(header, "#EXT-X-MEDIA-SEQUENCE")
    if media_seq_str is not None:
        try:
            new_media_seq = int(media_seq_str) + removed_initial
        except ValueError:
            new_media_seq = removed_initial
    else:
        new_media_seq = removed_initial

    new_disc_seq = 0
    disc_seq_str = _extract_header_value(header, "#EXT-X-DISCONTINUITY-SEQUENCE")
    if disc_seq_str is not None:
        try:
            new_disc_seq = int(disc_seq_str) + removed_disc_before_first
        except ValueError:
            new_disc_seq = removed_disc_before_first
    else:
        new_disc_seq = removed_disc_before_first

    out: list[str] = ["#EXTM3U"]
    wrote_target = False
    wrote_version = False

    for line in header:
        upper = line.upper()
        # 避免重复输出 #EXTM3U
        if upper == "#EXTM3U":
            continue
        # 重写 header 中 KEY/MAP/MEDIA 等标签的 URI
        if "URI=" in line:
            line = _rewrite_tag_uri(line, base_url)
        if upper.startswith("#EXT-X-TARGETDURATION"):
            out.append(line)
            wrote_target = True
        elif upper.startswith("#EXT-X-VERSION"):
            out.append(line)
            wrote_version = True
        elif upper.startswith("#EXT-X-MEDIA-SEQUENCE"):
            out.append(f"#EXT-X-MEDIA-SEQUENCE:{new_media_seq}")
        elif upper.startswith("#EXT-X-DISCONTINUITY-SEQUENCE"):
            out.append(f"#EXT-X-DISCONTINUITY-SEQUENCE:{new_disc_seq}")
        else:
            out.append(line)

    if not wrote_target:
        # 兜底 targetduration，避免播放器解析失败
        max_duration = max((s.duration for s in kept), default=10)
        out.append(f"#EXT-X-TARGETDURATION:{int(max_duration + 0.999)}")
    if not wrote_version:
        out.append("#EXT-X-VERSION:3")

    prev_removed = False
    for seg in segments:
        if seg.is_ad:
            prev_removed = True
            continue

        tags = list(seg.tags)

        # 重写标签里的 URI（如 KEY/MAP）
        tags = [_rewrite_tag_uri(t, base_url) for t in tags]

        # 如果上一个片段被删除，插入 discontinuity 提示播放器时间轴跳跃
        if prev_removed and not any(
            t.strip().upper() == "#EXT-X-DISCONTINUITY" for t in tags
        ):
            tags.insert(0, "#EXT-X-DISCONTINUITY")

        for t in tags:
            out.append(t)

        out.append(f"#EXTINF:{seg.duration},{seg.title}")
        out.append(_to_absolute(base_url, seg.url))
        prev_removed = False

    if has_endlist:
        out.append("#EXT-X-ENDLIST")

    return "\n".join(out) + "\n"


def _is_master_playlist(text: str) -> bool:
    return "#EXT-X-STREAM-INF" in text.upper()


def _extract_base_url(url: str) -> str:
    """去掉文件名，保留目录路径（以 / 结尾）。"""
    parsed = urlparse(url)
    path = parsed.path
    last_slash = path.rfind("/")
    if last_slash >= 0:
        path = path[: last_slash + 1]
    return f"{parsed.scheme}://{parsed.netloc}{path}"


async def sanitize_m3u8(
    url: str,
    headers: dict[str, str] | None = None,
    site_id: int | None = None,
    client: httpx.AsyncClient | None = None,
) -> str:
    """抓取并清洗 m3u8 playlist。

    - 主 playlist：把 variant URL 改写成后端代理 URL
    - media playlist：剔除广告片段，重写片段/密钥 URI 为绝对地址
    """
    request_headers = headers or {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": f"{urlparse(url).scheme}://{urlparse(url).netloc}",
    }

    async def _fetch(c: httpx.AsyncClient) -> str:
        resp = await c.get(url, headers=request_headers, timeout=HTTP_TIMEOUT_RESOLVE)
        resp.raise_for_status()
        return resp.text

    if client is not None:
        text = await _fetch(client)
    else:
        async with httpx.AsyncClient(follow_redirects=True) as c:
            text = await _fetch(c)

    base_url = _extract_base_url(url)

    if _is_master_playlist(text):
        if site_id is None:
            logger.warning("m3u8 master playlist 缺少 site_id，无法改写 variant 代理 URL")
            # 退化为仅重写为绝对地址
            return _parse_master_playlist(text, base_url, site_id or 0)
        return _parse_master_playlist(text, base_url, site_id)

    # media playlist
    header, segments, has_endlist = _parse_media_playlist(text)
    result = _build_media_playlist(header, segments, has_endlist, base_url, site_id or 0)
    ad_count = sum(1 for s in segments if s.is_ad)
    logger.info("m3u8_sanitize url=%s segments=%d ads=%d", url, len(segments), ad_count)
    return result


async def sanitize_m3u8_text(
    text: str,
    url: str,
    site_id: int | None = None,
) -> str:
    """对已有的 m3u8 文本做清洗（下载器复用）。"""
    base_url = _extract_base_url(url)
    if _is_master_playlist(text):
        return _parse_master_playlist(text, base_url, site_id or 0)
    header, segments, has_endlist = _parse_media_playlist(text)
    return _build_media_playlist(header, segments, has_endlist, base_url, site_id or 0)
