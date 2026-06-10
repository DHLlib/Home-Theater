import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models import Site, VideoCache
from app.api.videos import _evict_video_cache_overflow

pytestmark = pytest.mark.asyncio


async def test_video_cache_no_eviction(async_client: AsyncClient, db_session: AsyncSession):
    """LRU 淘汰已取消（AC-014），完整保留所有刮削数据。"""
    site = Site(name="CacheSite", base_url="http://cache.com", enabled=True, sort=0)
    db_session.add(site)
    await db_session.commit()
    await db_session.refresh(site)

    base_time = datetime.utcnow() - timedelta(days=1)
    for i in range(100):
        db_session.add(VideoCache(
            site_id=site.id,
            original_id=f"vid-{i}",
            title=f"Video {i}",
            cached_at=base_time + timedelta(seconds=i),
        ))
    await db_session.commit()

    await _evict_video_cache_overflow(db_session)
    count_result = await db_session.execute(select(func.count()).select_from(VideoCache))
    assert count_result.scalar_one() == 100

    # All records remain
    for i in range(100):
        result = await db_session.execute(select(VideoCache).where(VideoCache.original_id == f"vid-{i}"))
        assert result.scalar_one_or_none() is not None
