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
async def test_uniform_slice_pods_not_removed_gghijk_style():
    """gghijk 站点：全片均匀 2 秒切片，广告 pod 与正片时长无异（极差≈0）。

    新判据要求 pod 内片段时长参差（极差 > 1.0s）才视为广告特征，故这类站点的
    discontinuity 短 pod 不再被删——换取「全片均匀切片」的正片绝不被误封。
    """
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
    # 均匀切片：所有片段时长一致，无广告特征，全部保留
    for seg in ("a1.ts", "a2.ts", "a3.ts", "b1.ts", "b2.ts", "b3.ts", "b4.ts",
                "b5.ts", "c1.ts", "c2.ts", "d1.ts", "d2.ts", "e1.ts"):
        assert seg in result


@pytest.mark.asyncio
async def test_short_pod_circuit_breaker_keeps_segments_when_over_ratio():
    """短 pod 启发式删除占比超过阈值（50%）时熔断，整体放弃删除，避免误删整集。

    构造：b/c/d 三个被 discontinuity 隔离的短 pod，各 2 段、时长 1s+5s（极差 4s
    > 1.0s，具备广告特征），且后续仍有 discontinuity（bounded），均是删除候选；
    尾部 e 块 1 段无后续 discontinuity（unbounded），本就保留。
    候选总时长 b+c+d = 18s / 全片 19s ≈ 95% > 50% → 熔断，候选全部保留。
    """
    text = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-DISCONTINUITY
#EXTINF:1.000000,
b1.ts
#EXTINF:5.000000,
b2.ts
#EXT-X-DISCONTINUITY
#EXTINF:1.000000,
c1.ts
#EXTINF:5.000000,
c2.ts
#EXT-X-DISCONTINUITY
#EXTINF:1.000000,
d1.ts
#EXTINF:5.000000,
d2.ts
#EXT-X-DISCONTINUITY
#EXTINF:1.000000,
e1.ts
#EXT-X-ENDLIST
"""
    result = await sanitize_m3u8_text(
        text, "https://cdn.example.com/video/mixed.m3u8", site_id=1
    )
    # 熔断生效：所有候选短 pod 片段都应保留
    for seg in ("b1.ts", "b2.ts", "c1.ts", "c2.ts", "d1.ts", "d2.ts", "e1.ts"):
        assert seg in result


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
