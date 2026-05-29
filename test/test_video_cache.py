import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models import Site, VideoCache
from app.api.videos import _evict_video_cache_overflow

pytestmark = pytest.mark.asyncio


async def test_video_cache_eviction_at_limit(async_client: AsyncClient, db_session: AsyncSession):
    # Create a site for FK
    site = Site(name="CacheSite", base_url="http://cache.com", enabled=True, sort=0)
    db_session.add(site)
    await db_session.commit()
    await db_session.refresh(site)

    base_time = datetime.utcnow() - timedelta(days=1)
    for i in range(5000):
        db_session.add(VideoCache(
            site_id=site.id,
            original_id=f"vid-{i}",
            title=f"Video {i}",
            cached_at=base_time + timedelta(seconds=i),
        ))
    await db_session.commit()

    # At exactly 5000, eviction should not remove anything
    await _evict_video_cache_overflow(db_session)
    count_result = await db_session.execute(select(func.count()).select_from(VideoCache))
    assert count_result.scalar_one() == 5000

    # Insert one more record
    db_session.add(VideoCache(
        site_id=site.id,
        original_id="vid-new",
        title="Video New",
        cached_at=datetime.utcnow(),
    ))
    await db_session.commit()

    await _evict_video_cache_overflow(db_session)
    count_result = await db_session.execute(select(func.count()).select_from(VideoCache))
    assert count_result.scalar_one() == 5000

    # Verify the oldest record (vid-0) was evicted
    result = await db_session.execute(select(VideoCache).where(VideoCache.original_id == "vid-0"))
    assert result.scalar_one_or_none() is None

    # Verify the newest record remains
    result = await db_session.execute(select(VideoCache).where(VideoCache.original_id == "vid-new"))
    assert result.scalar_one_or_none() is not None


async def test_video_cache_eviction_multiple(async_client: AsyncClient, db_session: AsyncSession):
    # Create a site for FK
    site = Site(name="CacheSite2", base_url="http://cache2.com", enabled=True, sort=0)
    db_session.add(site)
    await db_session.commit()
    await db_session.refresh(site)

    base_time = datetime.utcnow() - timedelta(days=1)
    for i in range(5005):
        db_session.add(VideoCache(
            site_id=site.id,
            original_id=f"vid-{i}",
            title=f"Video {i}",
            cached_at=base_time + timedelta(seconds=i),
        ))
    await db_session.commit()

    # 5005 records: should evict 5 oldest
    await _evict_video_cache_overflow(db_session)
    count_result = await db_session.execute(select(func.count()).select_from(VideoCache))
    assert count_result.scalar_one() == 5000

    # Insert one more record
    db_session.add(VideoCache(
        site_id=site.id,
        original_id="vid-new",
        title="Video New",
        cached_at=datetime.utcnow(),
    ))
    await db_session.commit()

    await _evict_video_cache_overflow(db_session)
    count_result = await db_session.execute(select(func.count()).select_from(VideoCache))
    assert count_result.scalar_one() == 5000

    # Verify the 6 oldest records (vid-0 to vid-5) were evicted
    for i in range(6):
        result = await db_session.execute(select(VideoCache).where(VideoCache.original_id == f"vid-{i}"))
        assert result.scalar_one_or_none() is None

    # Verify vid-6 still exists (it was the 7th oldest, survived first eviction)
    result = await db_session.execute(select(VideoCache).where(VideoCache.original_id == "vid-6"))
    assert result.scalar_one_or_none() is not None

    # Verify the newest record remains
    result = await db_session.execute(select(VideoCache).where(VideoCache.original_id == "vid-new"))
    assert result.scalar_one_or_none() is not None
