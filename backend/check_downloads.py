import asyncio
from app.db import async_session_factory
from app.models import DownloadTask
from sqlalchemy import select

async def main():
    async with async_session_factory() as session:
        result = await session.execute(
            select(DownloadTask).order_by(DownloadTask.created_at.desc())
        )
        tasks = result.scalars().all()
        print(f"total tasks: {len(tasks)}")
        for t in tasks:
            url = t.url[:100] + "..." if len(t.url) > 100 else t.url
            print(f"\nID={t.id} status={t.status} suffix={t.suffix}")
            print(f"  URL={url}")
            print(f"  size={t.downloaded_bytes}/{t.total_bytes}")
            print(f"  error={t.error}")

if __name__ == "__main__":
    asyncio.run(main())
