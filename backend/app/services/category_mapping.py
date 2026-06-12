import logging
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Site, SiteCategoryMapping

logger = logging.getLogger(__name__)

# 配置开关：是否强制使用中间表读路径
# 环境变量 USE_CATEGORY_MAPPING_TABLE=false 可回退到 JSON
import os

_USE_MAPPING_TABLE = os.getenv("USE_CATEGORY_MAPPING_TABLE", "true").lower() != "false"


async def get_site_category_mappings(
    db: AsyncSession,
    site_id: int,
    use_mapping_table: Optional[bool] = None,
) -> list[dict]:
    """读取站点分类映射。

    返回格式与 site.categories 保持一致：
        [{"remote_id": ..., "name": ..., "enabled": ...}, ...]

    参数:
        use_mapping_table: None=按全局配置选择；True=强制中间表；False=强制 JSON
    """
    force_table = use_mapping_table if use_mapping_table is not None else _USE_MAPPING_TABLE

    if force_table:
        result = await db.execute(
            select(SiteCategoryMapping)
            .where(SiteCategoryMapping.site_id == site_id)
            .order_by(SiteCategoryMapping.remote_id)
        )
        rows = result.scalars().all()
        if rows:
            return [
                {
                    "remote_id": r.remote_id,
                    "name": r.system_name,
                    "enabled": r.enabled,
                }
                for r in rows
            ]

    # 回退到 JSON（双轨兼容）
    site = await db.get(Site, site_id)
    return list(site.categories or []) if site else []


async def save_site_category_mappings(
    db: AsyncSession,
    site_id: int,
    mappings: list[dict],
    *,
    sync_json: bool = True,
) -> None:
    """保存站点分类映射到中间表，并可选同步回 JSON 字段。

    参数:
        mappings: [{"remote_id": ..., "name": ..., "enabled": ...}, ...]
        sync_json: 是否同时更新 sites.categories 字段（双轨期建议 True）
    """
    # 1. 清空旧映射
    await db.execute(
        delete(SiteCategoryMapping).where(SiteCategoryMapping.site_id == site_id)
    )

    # 2. 插入新映射
    for m in mappings:
        remote_id = m.get("remote_id")
        if remote_id is None:
            continue
        db.add(
            SiteCategoryMapping(
                site_id=site_id,
                remote_id=str(remote_id),
                remote_name=m.get("remote_name"),
                system_name=m.get("name", ""),
                enabled=bool(m.get("enabled", True)),
            )
        )

    # 3. 同步 JSON（双轨兼容期保留）
    if sync_json:
        site = await db.get(Site, site_id)
        if site:
            site.categories = [
                {
                    "remote_id": m.get("remote_id"),
                    "name": m.get("name", ""),
                    "enabled": bool(m.get("enabled", True)),
                }
                for m in mappings
                if m.get("remote_id") is not None
            ]


async def load_all_site_mappings(db: AsyncSession) -> dict[int, dict[str, dict]]:
    """加载所有站点分类映射，用于首页分类禁用过滤。

    返回格式与 videos.py 中 _load_category_filter_maps 的 site_mappings 一致：
        {site_id: {remote_id: {"enabled": ..., "system_name": ...}, ...}, ...}
    """
    if not _USE_MAPPING_TABLE:
        # 回退到 JSON 读取
        result = await db.execute(select(Site))
        site_mappings: dict[int, dict[str, dict]] = {}
        for s in result.scalars().all():
            site_mappings[s.id] = {}
            for c in (s.categories or []):
                rid = c.get("remote_id")
                if rid is not None:
                    site_mappings[s.id][str(rid)] = {
                        "enabled": c.get("enabled", True),
                        "system_name": c.get("name", ""),
                    }
        return site_mappings

    result = await db.execute(select(SiteCategoryMapping))
    site_mappings = {}
    for row in result.scalars().all():
        site_mappings.setdefault(row.site_id, {})[row.remote_id] = {
            "enabled": row.enabled,
            "system_name": row.system_name,
        }
    return site_mappings


async def migrate_categories_to_mapping_table(db: AsyncSession) -> dict:
    """将 sites.categories JSON 迁移到 site_category_mappings 中间表。

    幂等：若中间表已有数据则跳过。
    """
    count_result = await db.execute(
        select(func.count()).select_from(SiteCategoryMapping)
    )
    if count_result.scalar_one() > 0:
        return {"status": "already_migrated", "migrated": 0, "total_mappings": 0}

    result = await db.execute(select(Site))
    sites = result.scalars().all()

    migrated = 0
    total_mappings = 0
    for site in sites:
        cats = site.categories or []
        if not cats:
            continue
        for c in cats:
            rid = c.get("remote_id")
            if rid is None:
                continue
            db.add(
                SiteCategoryMapping(
                    site_id=site.id,
                    remote_id=str(rid),
                    remote_name=c.get("remote_name"),
                    system_name=c.get("name", ""),
                    enabled=c.get("enabled", True),
                )
            )
            total_mappings += 1
        migrated += 1

    await db.commit()
    logger.info(
        "分类映射迁移完成: migrated_sites=%d, total_mappings=%d",
        migrated,
        total_mappings,
    )
    return {
        "status": "migrated",
        "migrated": migrated,
        "total_mappings": total_mappings,
    }
