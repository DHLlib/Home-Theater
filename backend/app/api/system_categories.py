import logging

from fastapi import APIRouter, Depends
from app.errors import (
    category_cycle,
    category_exists,
    category_not_found,
    validation_error,
)
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.videos import invalidate_category_filter_cache
from app.db import get_db
from app.models import AggregatedVideoV3, SiteCategoryLink, SystemCategory
from app.schemas import (
    SystemCategoryCreate,
    SystemCategoryOut,
    SystemCategoryTreeItem,
    SystemCategoryUpdate,
)

router = APIRouter(prefix="/system-categories", tags=["system-categories"])
logger = logging.getLogger(__name__)


def _invalidate_all() -> None:
    """分类结构变化后作废分类过滤/统计缓存。"""
    invalidate_category_filter_cache()


async def _descendants(db: AsyncSession, cat: SystemCategory) -> list[SystemCategory]:
    """分类自身 + 所有子孙分类（按先子后父顺序返回）。"""
    out: list[SystemCategory] = [cat]
    result = await db.execute(
        select(SystemCategory).where(SystemCategory.parent_id == cat.id)
    )
    for child in result.scalars().all():
        out.extend(await _descendants(db, child))
    return out


async def _would_form_cycle(
    db: AsyncSession, cat_id: int, parent_id: int | None
) -> bool:
    if parent_id is None:
        return False
    current_id = parent_id
    visited: set[int] = set()
    while current_id is not None:
        if current_id == cat_id or current_id in visited:
            return True
        visited.add(current_id)
        parent = await db.get(SystemCategory, current_id)
        if not parent:
            break
        current_id = parent.parent_id
    return False


@router.get("")
async def list_system_categories(db: AsyncSession = Depends(get_db)):
    """列出所有系统分类（树形结构）。"""
    result = await db.execute(
        select(SystemCategory).order_by(SystemCategory.sort, SystemCategory.id)
    )
    rows = result.scalars().all()

    by_parent: dict[int | None, list[SystemCategory]] = {}
    for row in rows:
        by_parent.setdefault(row.parent_id, []).append(row)

    def build_tree(parent_id: int | None) -> list[SystemCategoryTreeItem]:
        items = []
        for row in by_parent.get(parent_id, []):
            items.append(
                SystemCategoryTreeItem(
                    id=row.id,
                    parent_id=row.parent_id,
                    name=row.name,
                    sort=row.sort,
                    enabled=row.enabled,
                    children=build_tree(row.id),
                )
            )
        return items

    return build_tree(None)


@router.post("")
async def create_system_category(
    body: SystemCategoryCreate,
    db: AsyncSession = Depends(get_db),
):
    """新增系统分类；只支持大类（parent_id=None）和小类（父级必须是大类）。"""
    name = (body.name or "").strip()
    if not name:
        raise validation_error("分类名不能为空")

    existing = await db.execute(
        select(SystemCategory).where(SystemCategory.name == name)
    )
    if existing.scalar_one_or_none():
        raise category_exists(name)

    if body.parent_id is not None:
        parent = await db.get(SystemCategory, body.parent_id)
        if not parent:
            raise category_not_found("父分类")
        if parent.parent_id is not None:
            raise validation_error("只支持两级分类：小类只能挂在大类下")

    cat = SystemCategory(name=name, parent_id=body.parent_id, sort=body.sort)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    _invalidate_all()
    logger.info(
        "system_category_created id=%d name=%s parent_id=%s",
        cat.id,
        cat.name,
        cat.parent_id,
    )
    return SystemCategoryOut(
        id=cat.id,
        parent_id=cat.parent_id,
        name=cat.name,
        sort=cat.sort,
        enabled=cat.enabled,
        created_at=str(cat.created_at),
    )


@router.patch("/{cat_id}")
async def update_system_category(
    cat_id: int,
    body: SystemCategoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """改名 / 调序 / 启停。改名会同步视频级分类；挂载关系按 id 保留。"""
    cat = await db.get(SystemCategory, cat_id)
    if not cat:
        raise category_not_found(str(cat_id))

    data = body.model_dump(exclude_unset=True)
    new_name = data.get("name")
    if new_name is not None:
        new_name = str(new_name).strip()
        if not new_name:
            raise validation_error("分类名不能为空")
        existing = await db.execute(
            select(SystemCategory).where(
                SystemCategory.name == new_name,
                SystemCategory.id != cat_id,
            )
        )
        if existing.scalar_one_or_none():
            raise category_exists(new_name)
        data["name"] = new_name

    if "parent_id" in data:
        parent_id = data["parent_id"]
        if parent_id is not None:
            if parent_id == cat_id:
                raise category_cycle()
            parent = await db.get(SystemCategory, parent_id)
            if not parent:
                raise category_not_found("父分类")
            if parent.parent_id is not None:
                raise validation_error("只支持两级分类：小类只能挂在大类下")
            child_count = (
                await db.execute(
                    select(func.count())
                    .select_from(SystemCategory)
                    .where(SystemCategory.parent_id == cat_id)
                )
            ).scalar_one()
            if child_count:
                raise validation_error("该分类下还有小类，不能挂到其他分类下")
            if await _would_form_cycle(db, cat_id, parent_id):
                raise category_cycle()

    old_name = cat.name
    for key, value in data.items():
        setattr(cat, key, value)

    if new_name and new_name != old_name:
        await db.execute(
            update(AggregatedVideoV3)
            .where(AggregatedVideoV3.system_category == old_name)
            .values(system_category=new_name)
        )

    await db.commit()
    await db.refresh(cat)
    _invalidate_all()
    logger.info(
        "system_category_updated id=%d name=%s parent_id=%s",
        cat.id,
        cat.name,
        cat.parent_id,
    )
    return SystemCategoryOut(
        id=cat.id,
        parent_id=cat.parent_id,
        name=cat.name,
        sort=cat.sort,
        enabled=cat.enabled,
        created_at=str(cat.created_at),
    )


@router.delete("/{cat_id}")
async def delete_system_category(
    cat_id: int,
    db: AsyncSession = Depends(get_db),
):
    """删除分类（含子类）。

    不做迁移：相关远程分类回到未挂载，相关视频直接置为未分类，不重新投票。
    """
    cat = await db.get(SystemCategory, cat_id)
    if not cat:
        raise category_not_found(str(cat_id))

    descendants = await _descendants(db, cat)
    ids = [row.id for row in descendants]
    names = [row.name for row in descendants]

    videos_reset = (
        await db.execute(
            update(AggregatedVideoV3)
            .where(AggregatedVideoV3.system_category.in_(names))
            .values(system_category=None)
        )
    ).rowcount or 0
    links_removed = (
        await db.execute(
            delete(SiteCategoryLink).where(
                SiteCategoryLink.system_category_id.in_(ids)
            )
        )
    ).rowcount or 0

    # 先删子分类，再删父分类（外键自引用）
    async def delete_subtree(node: SystemCategory) -> None:
        children = (
            await db.execute(
                select(SystemCategory).where(SystemCategory.parent_id == node.id)
            )
        ).scalars().all()
        for child in children:
            await delete_subtree(child)
        await db.delete(node)

    await delete_subtree(cat)
    await db.commit()
    _invalidate_all()
    logger.info(
        "system_category_deleted id=%d name=%s names=%s links=%d videos=%d",
        cat_id,
        cat.name,
        names,
        links_removed,
        videos_reset,
    )
    return {
        "ok": True,
        "names": names,
        "links_removed": int(links_removed),
        "videos_reset": int(videos_reset),
    }
