from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import distinct, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import (
    PLAYBACK_QUALITY_MIN_ATTEMPTS,
    PLAYBACK_QUALITY_MIN_SUCCESS_RATE,
    PLAYBACK_QUALITY_SMOOTHNESS_WEIGHT,
    PLAYBACK_QUALITY_STARTUP_WEIGHT,
    PLAYBACK_QUALITY_SUCCESS_WEIGHT,
    PLAYBACK_QUALITY_WINDOW_DAYS,
    PLAYBACK_STARTUP_BEST_MS,
    PLAYBACK_STARTUP_WORST_MS,
)
from app.models import PlaybackEvent, _utcnow


@dataclass(frozen=True)
class SourceQualityStats:
    attempts: int = 0
    successes: int = 0
    failures: int = 0
    avg_first_frame_ms: float | None = None
    stall_count: int = 0
    last_success_at: datetime | None = None

    @property
    def success_rate(self) -> float:
        return self.successes / self.attempts if self.attempts else 0.0

    @property
    def smoothed_success_rate(self) -> float:
        effective_successes = max(self.successes - self.failures, 0)
        return (effective_successes + 1) / (self.attempts + 2)


def quality_score(stats: SourceQualityStats | None) -> float | None:
    if stats is None or stats.attempts == 0:
        return None

    if stats.avg_first_frame_ms is None:
        startup_score = 0.5
    else:
        startup_score = (
            PLAYBACK_STARTUP_WORST_MS - stats.avg_first_frame_ms
        ) / (PLAYBACK_STARTUP_WORST_MS - PLAYBACK_STARTUP_BEST_MS)
        startup_score = min(1.0, max(0.0, startup_score))

    smoothness_score = 1 / (1 + stats.stall_count / max(stats.successes, 1))
    return 100 * (
        PLAYBACK_QUALITY_SUCCESS_WEIGHT * stats.smoothed_success_rate
        + PLAYBACK_QUALITY_STARTUP_WEIGHT * startup_score
        + PLAYBACK_QUALITY_SMOOTHNESS_WEIGHT * smoothness_score
    )


def is_recommendable(stats: SourceQualityStats | None) -> bool:
    return bool(
        stats
        and stats.attempts >= PLAYBACK_QUALITY_MIN_ATTEMPTS
        and stats.smoothed_success_rate >= PLAYBACK_QUALITY_MIN_SUCCESS_RATE
    )


def quality_reason(stats: SourceQualityStats) -> str | None:
    if stats.attempts == 0:
        return None
    parts = [
        f"近 {PLAYBACK_QUALITY_WINDOW_DAYS} 天 {stats.attempts} 次播放",
        f"起播成功率 {round(stats.success_rate * 100)}%",
    ]
    if stats.avg_first_frame_ms is not None:
        parts.append(f"平均起播 {stats.avg_first_frame_ms / 1000:.1f} 秒")
    if stats.stall_count:
        parts.append(f"卡顿 {stats.stall_count} 次")
    return " · ".join(parts)


async def load_source_quality(
    db: AsyncSession, pairs: list[tuple[int, str]]
) -> dict[tuple[int, str], SourceQualityStats]:
    if not pairs:
        return {}

    since = _utcnow() - timedelta(days=PLAYBACK_QUALITY_WINDOW_DAYS)
    attempts = func.count(distinct(PlaybackEvent.session_id)).filter(
        PlaybackEvent.event_type == "attempt"
    )
    successes = func.count(distinct(PlaybackEvent.session_id)).filter(
        PlaybackEvent.event_type == "first_frame"
    )
    failures = func.count(distinct(PlaybackEvent.session_id)).filter(
        PlaybackEvent.event_type == "fatal_error"
    )
    avg_first_frame = func.avg(PlaybackEvent.first_frame_ms).filter(
        PlaybackEvent.event_type == "first_frame",
        PlaybackEvent.first_frame_ms.isnot(None),
    )
    stalls = func.count(PlaybackEvent.id).filter(PlaybackEvent.event_type == "stall")
    last_success = func.max(PlaybackEvent.created_at).filter(
        PlaybackEvent.event_type == "first_frame"
    )

    result = await db.execute(
        select(
            PlaybackEvent.site_id,
            PlaybackEvent.original_id,
            attempts.label("attempts"),
            successes.label("successes"),
            failures.label("failures"),
            avg_first_frame.label("avg_first_frame_ms"),
            stalls.label("stall_count"),
            last_success.label("last_success_at"),
        )
        .where(
            tuple_(PlaybackEvent.site_id, PlaybackEvent.original_id).in_(pairs),
            PlaybackEvent.created_at >= since,
        )
        .group_by(PlaybackEvent.site_id, PlaybackEvent.original_id)
    )

    return {
        (row.site_id, row.original_id): SourceQualityStats(
            attempts=row.attempts or 0,
            successes=row.successes or 0,
            failures=row.failures or 0,
            avg_first_frame_ms=(
                float(row.avg_first_frame_ms)
                if row.avg_first_frame_ms is not None
                else None
            ),
            stall_count=row.stall_count or 0,
            last_success_at=row.last_success_at,
        )
        for row in result.all()
    }
