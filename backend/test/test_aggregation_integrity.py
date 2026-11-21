"""聚合中间表只读完整性审计。"""

from app.models import AggregatedSource, AggregatedVideoV3, Site
from app.services.aggregator import audit_aggregation_integrity


async def _video(title: str, norm_title: str, source_count: int) -> AggregatedVideoV3:
    return AggregatedVideoV3(
        title=title,
        year=2026,
        norm_title=norm_title,
        source_count=source_count,
    )


def _source(video: AggregatedVideoV3, site_id: int, original_id: str) -> AggregatedSource:
    return AggregatedSource(
        aggregated_video_id=video.id,
        site_id=site_id,
        original_id=original_id,
    )


async def test_aggregation_integrity_accepts_consistent_rows(db_session):
    db_session.add(Site(id=1, name="站点", base_url="https://example.com"))
    video = await _video("示例", "示例", 1)
    db_session.add(video)
    await db_session.flush()
    db_session.add(_source(video, 1, "video-1"))
    await db_session.commit()

    counts = await audit_aggregation_integrity(db_session)

    assert set(counts) == {
        "duplicate_keys",
        "orphan_videos",
        "dangling_sources",
        "source_count_mismatch",
        "duplicate_sources",
        "empty_norm_titles",
    }
    assert all(value == 0 for value in counts.values())


async def test_aggregation_integrity_detects_orphans_counts_and_empty_keys(db_session):
    db_session.add(Site(id=1, name="站点", base_url="https://example.com"))
    orphan = await _video("孤儿", "孤儿", 1)
    mismatched = await _video("计数错误", "计数错误", 2)
    empty_key = await _video("空键", "", 1)
    db_session.add_all([orphan, mismatched, empty_key])
    await db_session.flush()
    db_session.add_all([
        _source(mismatched, 1, "video-2"),
        _source(empty_key, 1, "video-3"),
    ])
    await db_session.commit()

    counts = await audit_aggregation_integrity(db_session)

    assert counts["orphan_videos"] == 1
    assert counts["source_count_mismatch"] == 2
    assert counts["empty_norm_titles"] == 1
    assert counts["duplicate_keys"] == 0
    assert counts["dangling_sources"] == 0
    assert counts["duplicate_sources"] == 0
