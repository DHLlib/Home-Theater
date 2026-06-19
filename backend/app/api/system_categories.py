import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import SystemCategory
from app.schemas import SystemCategoryCreate, SystemCategoryOut, SystemCategoryTreeItem, SystemCategoryUpdate

router = APIRouter(prefix="/system-categories", tags=["system-categories"])
logger = logging.getLogger(__name__)


@router.get("")
async def list_system_categories(db: AsyncSession = Depends(get_db)):
    """列出所有系统分类（树形结构）。"""
    result = await db.execute(select(SystemCategory).order_by(SystemCategory.sort, SystemCategory.id))
    rows = result.scalars().all()

    # 构建 parent_id -> children 映射
    by_parent: dict[int | None, list[SystemCategory]] = {}
    for r in rows:
        by_parent.setdefault(r.parent_id, []).append(r)

    def build_tree(parent_id: int | None) -> list[SystemCategoryTreeItem]:
        items = []
        for r in by_parent.get(parent_id, []):
            items.append(SystemCategoryTreeItem(
                id=r.id,
                parent_id=r.parent_id,
                name=r.name,
                sort=r.sort,
                enabled=r.enabled,
                children=build_tree(r.id),
            ))
        return items

    return build_tree(None)


@router.post("")
async def create_system_category(
    body: SystemCategoryCreate,
    db: AsyncSession = Depends(get_db),
):
    """新增系统分类（大类或小类）。"""
    # 检查名称是否已存在
    existing = await db.execute(select(SystemCategory).where(SystemCategory.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"系统分类 '{body.name}' 已存在")

    # 如果指定了 parent_id，检查父分类是否存在
    if body.parent_id is not None:
        parent = await db.get(SystemCategory, body.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="父分类不存在")

    cat = SystemCategory(name=body.name, parent_id=body.parent_id, sort=body.sort)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    logger.info("system_category_created id=%d name=%s parent_id=%s", cat.id, cat.name, cat.parent_id)
    return SystemCategoryOut(id=cat.id, parent_id=cat.parent_id, name=cat.name, sort=cat.sort, enabled=cat.enabled, created_at=str(cat.created_at))


@router.patch("/{cat_id}")
async def update_system_category(
    cat_id: int,
    body: SystemCategoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """修改系统分类。"""
    cat = await db.get(SystemCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")

    data = body.model_dump(exclude_unset=True)

    # 检查名称冲突
    if "name" in data:
        existing = await db.execute(
            select(SystemCategory).where(SystemCategory.name == data["name"], SystemCategory.id != cat_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"系统分类 '{data['name']}' 已存在")

    # 检查 parent_id 是否形成循环
    if "parent_id" in data and data["parent_id"] is not None:
        if data["parent_id"] == cat_id:
            raise HTTPException(status_code=400, detail="不能将自己设为父分类")
        parent = await db.get(SystemCategory, data["parent_id"])
        if not parent:
            raise HTTPException(status_code=404, detail="父分类不存在")

    # 如果 enabled 发生变化，立即使分类过滤缓存失效
    if "enabled" in data:
        global _category_filter_cache, _category_filter_cache_ts
        _category_filter_cache = None
        _category_filter_cache_ts = 0

    for key, value in data.items():
        setattr(cat, key, value)

    await db.commit()
    await db.refresh(cat)
    return SystemCategoryOut(id=cat.id, parent_id=cat.parent_id, name=cat.name, sort=cat.sort, enabled=cat.enabled, created_at=str(cat.created_at))


@router.delete("/{cat_id}")
async def delete_system_category(cat_id: int, db: AsyncSession = Depends(get_db)):
    """删除系统分类（会级联删除子分类）。"""
    cat = await db.get(SystemCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")

    # 级联删除子分类
    async def delete_children(parent_id: int):
        result = await db.execute(select(SystemCategory).where(SystemCategory.parent_id == parent_id))
        children = result.scalars().all()
        for child in children:
            await delete_children(child.id)
            await db.delete(child)

    await delete_children(cat_id)
    await db.delete(cat)
    await db.commit()
    logger.info("system_category_deleted id=%d name=%s", cat_id, cat.name)
    return {"ok": True}
