"""只读审计聚合中间表；任何一致性指标非零时退出码为 1。

用法：
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\audit_aggregated.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import async_session_factory, engine  # noqa: E402
from app.services.aggregator import audit_aggregation_integrity  # noqa: E402

_LABELS = {
    "duplicate_keys": "重复聚合键",
    "orphan_videos": "无来源聚合行",
    "dangling_sources": "指向不存在视频的来源",
    "source_count_mismatch": "source_count 与实际来源数不一致",
    "duplicate_sources": "重复来源",
    "empty_norm_titles": "空归一化键",
}


async def main() -> int:
    async with async_session_factory() as db:
        counts = await audit_aggregation_integrity(db)
    await engine.dispose()

    failed = False
    for key, label in _LABELS.items():
        value = counts[key]
        print(f"{label}: {value}")
        failed |= value > 0
    print("聚合完整性审计通过。" if not failed else "聚合完整性审计失败；请修复数据后再重建或发布。")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
