"""一次性清理 video_cache 中的异常年份历史数据。

部分资源站会把年份写成 "201717"（yyyy-y-d 或 yyyy-yy），
本脚本把这类记录的前 4 位提取为合法年份，并刷新聚合缓存。
"""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db import async_session_factory
from app.services.aggregator import refresh_aggregated_view

# 只处理长度超过 4 位、且前 4 位落在 1900-2100 的记录
_NORMALIZE_YEAR_SQL = """
UPDATE video_cache
SET year = CAST(SUBSTR(CAST(year AS TEXT), 1, 4) AS INTEGER)
WHERE year IS NOT NULL
  AND LENGTH(CAST(year AS TEXT)) > 4
  AND CAST(SUBSTR(CAST(year AS TEXT), 1, 4) AS INTEGER) BETWEEN 1900 AND 2100;
"""


async def main() -> None:
    async with async_session_factory() as db:
        result = await db.execute(text(_NORMALIZE_YEAR_SQL))
        updated = result.rowcount or 0
        await db.commit()
        print(f"已归一化 {updated} 条年份记录")

        print("正在刷新聚合缓存...")
        ok = await refresh_aggregated_view(db)
        print(f"聚合缓存刷新：{'成功' if ok else '失败'}")


if __name__ == "__main__":
    asyncio.run(main())
