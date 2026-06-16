import pytest

from app.services.m3u8_sanitizer import sanitize_m3u8_text


@pytest.mark.asyncio
async def test_simple_media_playlist_rewrites_relative_urls():
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
segment_0.ts
#EXTINF:10.000,
segment_1.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    assert "segment_0.ts" not in result or "https://cdn.example.com/video/segment_0.ts" in result
    assert "https://cdn.example.com/video/segment_1.ts" in result
    assert "#EXT-X-MEDIA-SEQUENCE:0" in result


@pytest.mark.asyncio
async def test_cue_out_in_removes_ad_segments():
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
segment_0.ts
#EXT-X-CUE-OUT:DURATION=15
#EXTINF:5.000,
ad_1.ts
#EXTINF:5.000,
ad_2.ts
#EXT-X-CUE-IN
#EXTINF:10.000,
segment_1.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    assert "segment_0.ts" in result
    assert "segment_1.ts" in result
    assert "ad_1.ts" not in result
    assert "ad_2.ts" not in result
    # 删除的是中间片段，media sequence 不变；边界应有 discontinuity
    assert "#EXT-X-MEDIA-SEQUENCE:0" in result
    assert "#EXT-X-DISCONTINUITY" in result


@pytest.mark.asyncio
async def test_blacklist_url_removes_ad_segment():
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
segment_0.ts
#EXT-X-DISCONTINUITY
#EXTINF:15.000,
https://ad.doubleclick.net/v1/ad.ts
#EXTINF:10.000,
segment_1.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    assert "segment_0.ts" in result
    assert "segment_1.ts" in result
    assert "ad.doubleclick.net" not in result


@pytest.mark.asyncio
async def test_master_playlist_rewrites_variant_to_proxy():
    text = """#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=800000,RESOLUTION=1280x720
3000k/hls/mixed.m3u8
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/master.m3u8", site_id=1
    )
    assert "3000k/hls/mixed.m3u8" not in result
    assert "/api/play/proxy-m3u8?site_id=1" in result
    assert "url=https%3A%2F%2Fcdn.example.com%2Fvideo%2F3000k%2Fhls%2Fmixed.m3u8" in result


@pytest.mark.asyncio
async def test_key_uri_rewritten_to_absolute():
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="key/key.bin"
#EXTINF:10.000,
segment_0.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    assert "https://cdn.example.com/video/key/key.bin" in result
    assert 'URI="key/key.bin"' not in result


@pytest.mark.asyncio
async def test_remove_initial_segment_adjusts_sequences():
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:5
#EXT-X-DISCONTINUITY-SEQUENCE:1
#EXTINF:10.000,
https://ad.doubleclick.net/ad_0.ts
#EXTINF:10.000,
segment_1.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    assert "ad.doubleclick.net" not in result
    assert "segment_1.ts" in result
    assert "#EXT-X-MEDIA-SEQUENCE:6" in result
    assert "#EXT-X-DISCONTINUITY-SEQUENCE:1" in result


@pytest.mark.asyncio
async def test_short_discontinuity_pod_removed_feifei_style():
    """feifei 站点：discontinuity 隔离的 5 段短 pod（总时长约 19.6s）应被删除。"""
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:8
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-DISCONTINUITY
#EXTINF:6.000000,
seg1.ts
#EXTINF:6.000000,
seg2.ts
#EXTINF:6.000000,
seg3.ts
#EXTINF:6.000000,
seg4.ts
#EXTINF:6.000000,
seg5.ts
#EXTINF:6.000000,
seg6.ts
#EXT-X-DISCONTINUITY
#EXTINF:4.866667,
ad1.ts
#EXTINF:3.333333,
ad2.ts
#EXTINF:6.366667,
ad3.ts
#EXTINF:1.733333,
ad4.ts
#EXTINF:3.333333,
ad5.ts
#EXT-X-DISCONTINUITY
#EXTINF:5.000000,
seg7.ts
#EXTINF:4.000000,
seg8.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    for seg in ("ad1.ts", "ad2.ts", "ad3.ts", "ad4.ts", "ad5.ts"):
        assert seg not in result
    assert "seg1.ts" in result
    assert "seg7.ts" in result
    assert result.count("#EXT-X-DISCONTINUITY") >= 1


@pytest.mark.asyncio
async def test_short_discontinuity_pod_removed_gghijk_style():
    """gghijk 站点：大量 2 秒 discontinuity block，短 pod 删除、长 pod 保留。"""
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2.000000,
a1.ts
#EXTINF:2.000000,
a2.ts
#EXTINF:2.000000,
a3.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000000,
b1.ts
#EXTINF:2.000000,
b2.ts
#EXTINF:2.000000,
b3.ts
#EXTINF:2.000000,
b4.ts
#EXTINF:2.000000,
b5.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000000,
c1.ts
#EXTINF:2.000000,
c2.ts
#EXTINF:2.000000,
c3.ts
#EXTINF:2.000000,
c4.ts
#EXTINF:2.000000,
c5.ts
#EXTINF:2.000000,
c6.ts
#EXTINF:2.000000,
c7.ts
#EXTINF:2.000000,
c8.ts
#EXTINF:2.000000,
c9.ts
#EXTINF:2.000000,
c10.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000000,
d1.ts
#EXTINF:2.000000,
d2.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000000,
e1.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    # b 块 5 段 10s、d 块 2 段 4s，均有后续 discontinuity，应删除
    for seg in ("b1.ts", "b2.ts", "b3.ts", "b4.ts", "b5.ts", "d1.ts", "d2.ts"):
        assert seg not in result
    # c 块 10 段 20s，超过 max_segments=6，保留
    assert "c1.ts" in result
    assert "c10.ts" in result
    # 开头无 discontinuity 的 a 块保留
    assert "a1.ts" in result
    # 尾部无后续 discontinuity 的 e 块保留，避免误删
    assert "e1.ts" in result


@pytest.mark.asyncio
async def test_long_discontinuity_block_not_removed():
    """总时长超过阈值的 discontinuity block 不应误删。"""
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:8
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-DISCONTINUITY
#EXTINF:6.000000,
seg1.ts
#EXTINF:6.000000,
seg2.ts
#EXTINF:6.000000,
seg3.ts
#EXTINF:6.000000,
seg4.ts
#EXTINF:6.000000,
seg5.ts
#EXTINF:6.000000,
seg6.ts
#EXT-X-DISCONTINUITY
#EXTINF:6.000000,
seg7.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    assert "seg1.ts" in result
    assert "seg7.ts" in result
