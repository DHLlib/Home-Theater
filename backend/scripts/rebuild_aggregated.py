"""全量重建聚合中间表（aggregated_videos / aggregated_sources）。

用法（在任意目录执行都行）：
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\rebuild_aggregated.py
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\rebuild_aggregated.py --check

不带参数 = 全量重建：清空两张中间表后按 video_cache 重新聚合，接着回填
视频级分类、重建推荐表。后端不用停，但重建窗口内列表可能短暂变空/不全
（视频先提交、来源后提交），建议挑没人用的时候跑。

--check 只连库打印当前计数，不做任何写入。

重建过程带 PostgreSQL advisory lock，和后端进程里的增量刷新互斥：如果正好
有爬虫在刷新聚合表，脚本会打印「被跳过」并退出，等几秒重跑即可。
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Settings 里 env_file=".env" 是相对当前目录的，先切到 backend 再导入 app，
# 否则从仓库根目录跑会连到默认的 localhost 库（没有账号密码）。
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.db import async_session_factory, engine  # noqa: E402
from app.services.aggregator import refresh_aggregated_view  # noqa: E402

_COUNTS_SQL = text(
    """
    SELECT
        (SELECT count(*) FROM aggregated_videos) AS videos,
        (SELECT count(*) FROM aggregated_sources) AS sources,
        (SELECT count(*) FROM aggregated_videos av
          WHERE NOT EXISTS (
              SELECT 1 FROM aggregated_sources s
              WHERE s.aggregated_video_id = av.id
          )) AS orphans,
        (SELECT count(*) FROM recommended_videos) AS recommended,
        (SELECT count(*) FROM recommended_videos
          WHERE aggregated_video_id IS NOT NULL) AS recommended_with_id
    """
)


async def _counts(db: AsyncSession) -> dict[str, int]:
    row = (await db.execute(_COUNTS_SQL)).mappings().one()
    return {key: int(value) for key, value in row.items()}


def _print_counts(label: str, counts: dict[str, int]) -> None:
    print(
        f"{label}：聚合视频 {counts['videos']}，来源 {counts['sources']}，"
        f"无来源孤儿 {counts['orphans']}，"
        f"推荐 {counts['recommended']}（带 id {counts['recommended_with_id']}）"
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description="全量重建聚合中间表")
    parser.add_argument(
        "--check",
        action="store_true",
        help="只检查数据库连接和当前计数，不写入",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    async with async_session_factory() as db:
        _print_counts("重建前", await _counts(db))

    if args.check:
        print("--check 模式，未执行重建")
        await engine.dispose()
        return 0

    started = time.perf_counter()
    async with async_session_factory() as db:
        ok = await refresh_aggregated_view(db)
    elapsed = time.perf_counter() - started

    async with async_session_factory() as db:
        _print_counts("重建后", await _counts(db))

    if ok:
        print(f"全量重建完成，耗时 {elapsed:.1f}s")
    else:
        print(
            f"全量重建未完成（耗时 {elapsed:.1f}s）：可能有另一个进程正在重建，"
            "或全局操作锁被占用，稍后重跑即可"
        )
    await engine.dispose()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
