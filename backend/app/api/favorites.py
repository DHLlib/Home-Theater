import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import favorite_not_found, validation_error
from app.models import Favorite
from app.schemas import FavoriteIn

router = APIRouter(prefix="/favorites", tags=["favorites"])
logger = logging.getLogger(__name__)


@router.get("")
async def list_favorites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Favorite).order_by(Favorite.created_at.desc())
    )
    return result.scalars().all()


@router.get("/status")
async def get_favorite_status(title: str, year: int | None = None, db: AsyncSession = Depends(get_db)):
    """查询指定 title+year 是否已被收藏。"""
    stmt = select(Favorite).where(Favorite.title == title)
    stmt = stmt.where(Favorite.year.is_(None) if year is None else Favorite.year == year)
    existing = (await db.execute(stmt)).scalars().first()
    return {"favorited": existing is not None, "id": existing.id if existing else None}


@router.post("")
async def add_favorite(req: FavoriteIn, db: AsyncSession = Depends(get_db)):
    """添加收藏。使用 INSERT ... ON CONFLICT 处理并发冲突。"""
    stmt = pg_insert(Favorite).values(
        title=req.title,
        year=req.year,
        poster_url=req.poster_url,
        sources=[s.model_dump() for s in req.sources],
    )
    stmt = stmt.on_conflict_do_nothing(
        index_elements=["title", "year"]
    )
    result = await db.execute(stmt)
    await db.commit()

    if result.rowcount == 0:
        # 已存在，返回现有记录
        existing = await db.execute(
            select(Favorite).where(
                Favorite.title == req.title,
                Favorite.year.is_(None) if req.year is None else Favorite.year == req.year,
            )
        )
        fav = existing.scalars().first()
        logger.info("favorite_already_exists title=%s year=%s", req.title, req.year)
        return fav

    # 获取新插入的记录
    existing = await db.execute(
        select(Favorite).where(
            Favorite.title == req.title,
            Favorite.year.is_(None) if req.year is None else Favorite.year == req.year,
        )
    )
    fav = existing.scalars().first()
    logger.info("favorite_added fav_id=%d title=%s year=%s", fav.id, req.title, req.year)
    return fav


@router.post("/toggle")
async def toggle_favorite(req: FavoriteIn, db: AsyncSession = Depends(get_db)):
    """按 title+year 切换收藏：已存在则取消，否则新增。返回切换后的状态。
    
    使用数据库唯一约束处理并发，避免竞态条件。
    """
    # 先尝试查询现有记录
    stmt = select(Favorite).where(Favorite.title == req.title)
    stmt = stmt.where(Favorite.year.is_(None) if req.year is None else Favorite.year == req.year)
    existing = (await db.execute(stmt)).scalars().first()

    if existing:
        # 已存在，删除（取消收藏）
        fav_id = existing.id
        await db.delete(existing)
        await db.commit()
        logger.info("favorite_toggled_off fav_id=%d title=%s year=%s", fav_id, req.title, req.year)
        return {"favorited": False, "id": None}

    # 不存在，插入（添加收藏）
    # 使用 ON CONFLICT DO NOTHING 处理并发插入
    insert_stmt = pg_insert(Favorite).values(
        title=req.title,
        year=req.year,
        poster_url=req.poster_url,
        sources=[s.model_dump() for s in req.sources],
    )
    insert_stmt = insert_stmt.on_conflict_do_nothing(
        index_elements=["title", "year"]
    )
    result = await db.execute(insert_stmt)
    await db.commit()

    if result.rowcount == 0:
        # 并发场景：另一请求已插入，返回当前状态
        existing = (await db.execute(stmt)).scalars().first()
        if existing:
            logger.info("favorite_toggle_race_resolved fav_id=%d title=%s year=%s", existing.id, req.title, req.year)
            return {"favorited": True, "id": existing.id}
        # 极端情况：插入失败但查询不到，返回错误
        raise validation_error("收藏操作失败，请重试")

    # 获取新插入的记录
    existing = (await db.execute(stmt)).scalars().first()
    logger.info("favorite_toggled_on fav_id=%d title=%s year=%s", existing.id, req.title, req.year)
    return {"favorited": True, "id": existing.id}


@router.delete("/{fav_id}")
async def remove_favorite(fav_id: int, db: AsyncSession = Depends(get_db)):
    fav = await db.get(Favorite, fav_id)
    if not fav:
        raise favorite_not_found(fav_id)
    await db.delete(fav)
    await db.commit()
    logger.info("favorite_removed fav_id=%d title=%s", fav_id, fav.title)
    return {"ok": True}
