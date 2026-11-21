"""按需媒体元数据与双推荐的解析、缓存和资源预算测试。"""

import httpx
from fastapi import FastAPI

from app.api.play import router as play_router
from app.db import get_db
from app.models import (
    AggregatedSource,
    AggregatedVideoV3,
    Site,
    VideoCache,
)
from app.services.aggregator import normalize_title
from app.services.media_analysis import analyze_candidates
from app.services.media_metadata import (
    MediaMetadata,
    load_media_metadata,
    parse_hls_master,
    upsert_media_metadata,
)


def test_hls_master_selects_highest_declared_resolution_without_segments():
    metadata = parse_hls_master(
        """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720,CODECS=\"avc1.4d401f,mp4a.40.2\"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8000000,AVERAGE-BANDWIDTH=7000000,RESOLUTION=1920x1080,CODECS=\"hvc1.1.6.L120,mp4a.40.2\"
1080/index.m3u8
""",
        "https://media.test/master.m3u8",
    )

    assert metadata is not None
    assert (metadata.width, metadata.height) == (1920, 1080)
    assert metadata.video_bitrate == 7_000_000
    assert metadata.codec == "H.265"
    assert metadata.evidence == "declared"
    assert metadata.variant_url == "https://media.test/1080/index.m3u8"


def test_hls_media_playlist_does_not_invent_resolution():
    assert parse_hls_master(
        "#EXTM3U\n#EXTINF:6,\nsegment-1.ts\n", "https://media.test/index.m3u8"
    ) is None


async def test_media_analysis_is_bounded_and_reuses_fresh_cache(
    db_session, monkeypatch
):
    db_session.add(Site(id=1, name="站点", base_url="https://site.test"))
    for index in range(3):
        db_session.add(
            VideoCache(
                site_id=1,
                original_id=f"video-{index}",
                title="示例",
                play_url_raw=f"第1集$https://media.test/{index}.m3u8$ffm3u8",
            )
        )
    await db_session.commit()
    calls = []

    async def fake_probe(url, suffix, headers):
        calls.append(url)
        return MediaMetadata(
            width=1920,
            height=1080,
            video_bitrate=6_000_000,
            evidence="declared",
            method="hls_master",
        )

    monkeypatch.setattr("app.services.media_analysis.probe_media_metadata", fake_probe)
    candidates = [(1, f"video-{index}") for index in range(3)]

    first = await analyze_candidates(db_session, candidates)
    second = await analyze_candidates(db_session, candidates)

    assert first.processed == 2
    assert first.probed == 2
    assert len(calls) == 2
    assert second.probed == 0
    assert second.skipped == 2
    assert len(calls) == 2

    loaded = await load_media_metadata(db_session, [(1, "video-0")])
    assert loaded[(1, "video-0")].height == 1080


async def test_media_analysis_stops_when_request_is_cancelled(db_session, monkeypatch):
    db_session.add(Site(id=1, name="站点", base_url="https://site.test"))
    for index in range(2):
        db_session.add(
            VideoCache(
                site_id=1,
                original_id=f"cancel-{index}",
                title="示例",
                play_url_raw=f"第1集$https://media.test/{index}.m3u8$ffm3u8",
            )
        )
    await db_session.commit()
    calls = 0

    async def fake_probe(url, suffix, headers):
        nonlocal calls
        calls += 1
        return MediaMetadata(width=1280, height=720, evidence="declared")

    monkeypatch.setattr("app.services.media_analysis.probe_media_metadata", fake_probe)
    checks = 0

    async def should_continue():
        nonlocal checks
        checks += 1
        return checks == 1

    outcome = await analyze_candidates(
        db_session,
        [(1, "cancel-0"), (1, "cancel-1")],
        should_continue=should_continue,
    )

    assert outcome.processed == 1
    assert calls == 1


async def test_actual_playback_wins_over_declaration_at_same_resolution(db_session):
    db_session.add(Site(id=1, name="站点", base_url="https://site.test"))
    await upsert_media_metadata(
        db_session,
        1,
        "video-1",
        0,
        "https://media.test/1.m3u8",
        MediaMetadata(
            width=1920,
            height=1080,
            video_bitrate=8_000_000,
            evidence="declared",
            method="hls_master",
        ),
    )
    await upsert_media_metadata(
        db_session,
        1,
        "video-1",
        0,
        "https://media.test/1.m3u8",
        MediaMetadata(
            width=1920,
            height=1080,
            video_bitrate=5_000_000,
            evidence="actual",
            method="playing",
        ),
    )
    await db_session.commit()

    loaded = await load_media_metadata(db_session, [(1, "video-1")])
    assert loaded[(1, "video-1")].evidence == "actual"


async def test_media_analysis_endpoint_returns_hd_recommendation_and_reuses_cache(
    db_session, monkeypatch
):
    app = FastAPI()
    app.include_router(play_router, prefix="/api")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    db_session.add(Site(id=1, name="站点", base_url="https://site.test"))
    aggregate = AggregatedVideoV3(
        title="示例",
        norm_title=normalize_title("示例"),
        year=2026,
        source_count=1,
    )
    db_session.add(aggregate)
    await db_session.flush()
    db_session.add_all([
        VideoCache(
            site_id=1,
            original_id="video-1",
            title="示例",
            norm_title=normalize_title("示例"),
            year=2026,
            play_url_raw="第1集$https://media.test/master.m3u8$ffm3u8",
        ),
        AggregatedSource(
            aggregated_video_id=aggregate.id,
            site_id=1,
            original_id="video-1",
        ),
    ])
    await db_session.commit()
    calls = 0

    async def fake_probe(url, suffix, headers):
        nonlocal calls
        calls += 1
        return MediaMetadata(
            width=1920,
            height=1080,
            video_bitrate=6_000_000,
            evidence="declared",
            method="hls_master",
        )

    monkeypatch.setattr("app.services.media_analysis.probe_media_metadata", fake_probe)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/api/play/sources/analyze", json={"title": "示例", "year": 2026}
        )
        second = await client.post(
            "/api/play/sources/analyze", json={"title": "示例", "year": 2026}
        )
        heartbeat = await client.post(
            "/api/play/heartbeat", json={"session_id": "api-session", "active": True}
        )
        stopped = await client.post(
            "/api/play/heartbeat", json={"session_id": "api-session", "active": False}
        )

    assert first.status_code == 200
    assert first.json()["analyzed"] == 1
    source = first.json()["sources"][0]
    assert source["hd_recommended"] is True
    assert source["stable_recommended"] is False
    assert source["media"]["evidence"] == "declared"
    assert second.json()["analyzed"] == 0
    assert calls == 1
    assert heartbeat.status_code == 204
    assert stopped.status_code == 204
