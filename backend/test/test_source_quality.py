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
from app.services.media_metadata import MediaMetadata, upsert_media_metadata
from app.services.source_quality import (
    SourceQualityStats,
    is_recommendable,
    quality_score,
)


def test_quality_recommendation_uses_personal_playback_evidence():
    good = SourceQualityStats(
        attempts=10, successes=9, avg_first_frame_ms=1500, stall_count=1
    )
    bad = SourceQualityStats(
        attempts=10, successes=4, avg_first_frame_ms=12000, stall_count=8
    )
    assert quality_score(good) > quality_score(bad)
    assert is_recommendable(good)
    assert not is_recommendable(bad)
    assert is_recommendable(
        SourceQualityStats(attempts=1, successes=1, avg_first_frame_ms=1000)
    )
    assert not is_recommendable(
        SourceQualityStats(attempts=1, successes=0, failures=1)
    )
    assert quality_score(None) is None

    interrupted = SourceQualityStats(
        attempts=3, successes=3, failures=1, avg_first_frame_ms=1500
    )
    uninterrupted = SourceQualityStats(
        attempts=3, successes=3, failures=0, avg_first_frame_ms=1500
    )
    assert quality_score(interrupted) < quality_score(uninterrupted)
    assert not is_recommendable(interrupted)


async def test_playback_events_drive_source_recommendation(db_session):
    app = FastAPI()
    app.include_router(play_router, prefix="/api")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db

    sites = [Site(name="稳定站点", base_url="https://good.test"), Site(name="较差站点", base_url="https://bad.test")]
    db_session.add_all(sites)
    await db_session.flush()
    good_site, bad_site = sites

    aggregate = AggregatedVideoV3(
        title="示例作品",
        norm_title=normalize_title("示例作品"),
        year=2024,
        source_count=2,
    )
    db_session.add(aggregate)
    await db_session.flush()

    rows = [
        VideoCache(
            site_id=good_site.id,
            original_id="good-1",
            title="示例作品",
            norm_title=normalize_title("示例作品"),
            year=2024,
            play_url_raw="第1集$https://good.test/1.m3u8$ffm3u8",
        ),
        VideoCache(
            site_id=bad_site.id,
            original_id="bad-1",
            title="示例作品【粤语】",
            norm_title=normalize_title("示例作品【粤语】"),
            year=None,
            play_url_raw="第1集$https://bad.test/1.m3u8$ffm3u8",
        ),
    ]
    db_session.add_all(rows)
    db_session.add_all(
        [
            AggregatedSource(
                aggregated_video_id=aggregate.id,
                site_id=good_site.id,
                original_id="good-1",
            ),
            AggregatedSource(
                aggregated_video_id=aggregate.id,
                site_id=bad_site.id,
                original_id="bad-1",
            ),
        ]
    )
    await db_session.commit()

    events = []
    for index in range(3):
        session_id = f"good-session-{index}"
        events.extend(
            [
                {
                    "event_id": f"good-attempt-{index}",
                    "session_id": session_id,
                    "site_id": good_site.id,
                    "original_id": "good-1",
                    "episode_index": 0,
                    "event_type": "attempt",
                },
                {
                    "event_id": f"good-first-{index}",
                    "session_id": session_id,
                    "site_id": good_site.id,
                    "original_id": "good-1",
                    "episode_index": 0,
                    "event_type": "first_frame",
                    "first_frame_ms": 1200 + index * 100,
                    "media": (
                        {
                            "url": "https://good.test/1.m3u8",
                            "width": 1920,
                            "height": 1080,
                            "video_bitrate": 6_000_000,
                            "codec": "h264",
                        }
                        if index == 0
                        else None
                    ),
                },
            ]
        )
        events.append(
            {
                "event_id": f"bad-attempt-{index}",
                "session_id": f"bad-session-{index}",
                "site_id": bad_site.id,
                "original_id": "bad-1",
                "episode_index": 0,
                "event_type": "attempt",
            }
        )
    events.append(
        {
            "event_id": "bad-first-0",
            "session_id": "bad-session-0",
            "site_id": bad_site.id,
            "original_id": "bad-1",
            "episode_index": 0,
            "event_type": "first_frame",
            "first_frame_ms": 9000,
        }
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first_response = await client.post("/api/play/events", json={"events": events})
        assert first_response.status_code == 202
        assert first_response.json() == {"accepted": len(events)}

        duplicate_response = await client.post("/api/play/events", json={"events": events})
        assert duplicate_response.status_code == 202
        assert duplicate_response.json() == {"accepted": 0}

        response = await client.get(
            "/api/play/sources", params={"title": "示例作品", "year": 2024}
        )

    assert response.status_code == 200
    sources = response.json()["sources"]
    assert len(sources) == 2
    assert sources[0]["original_id"] == "good-1"
    assert sources[0]["recommended"] is True
    assert sources[0]["stable_recommended"] is True
    assert sources[0]["hd_recommended"] is True
    assert sources[0]["quality"]["attempts"] == 3
    assert sources[0]["quality"]["success_rate"] == 1.0
    assert sources[0]["quality"]["avg_first_frame_ms"] == 1300
    assert "起播成功率 100%" in sources[0]["recommendation_reason"]
    assert sources[1]["recommended"] is False
    assert sources[1]["quality"]["attempts"] == 3
    assert sources[1]["quality"]["success_rate"] == 0.3333

    await upsert_media_metadata(
        db_session,
        bad_site.id,
        "bad-1",
        0,
        "https://bad.test/1.m3u8",
        MediaMetadata(
            width=3840,
            height=2160,
            video_bitrate=18_000_000,
            codec="h265",
            evidence="declared",
            method="hls_master",
        ),
    )
    await db_session.commit()
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        dual_response = await client.get(
            "/api/play/sources", params={"title": "示例作品", "year": 2024}
        )

    dual_sources = dual_response.json()["sources"]
    assert dual_sources[0]["original_id"] == "bad-1"
    assert dual_sources[0]["hd_recommended"] is True
    assert dual_sources[0]["stable_recommended"] is False
    assert "声明最高 3840×2160" in dual_sources[0]["hd_reason"]
    assert dual_sources[1]["original_id"] == "good-1"
    assert dual_sources[1]["stable_recommended"] is True
    assert dual_sources[1]["media"]["evidence"] == "actual"
