import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
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
    fav = Favorite(title=req.title, year=req.year, poster_url=req.poster_url, sources=[s.model_dump() for s in req.sources])
    db.add(fav)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        logger.warning("favorite_duplicate title=%s year=%s", req.title, req.year)
        raise HTTPException(
            status_code=409,
            detail=f"Favorite already exists for title='{req.title}' and year={req.year}",
        )
    await db.refresh(fav)
    logger.info("favorite_added fav_id=%d title=%s year=%s", fav.id, req.title, req.year)
    return fav


@router.post("/toggle")
async def toggle_favorite(req: FavoriteIn, db: AsyncSession = Depends(get_db)):
    """按 title+year 切换收藏：已存在则取消，否则新增。返回切换后的状态。"""
    stmt = select(Favorite).where(Favorite.title == req.title)
    stmt = stmt.where(Favorite.year.is_(None) if req.year is None else Favorite.year == req.year)
    existing = (await db.execute(stmt)).scalars().first()
    if existing:
        fav_id = existing.id
        await db.delete(existing)
        await db.commit()
        logger.info("favorite_toggled_off fav_id=%d title=%s year=%s", fav_id, req.title, req.year)
        return {"favorited": False, "id": None}
    fav = Favorite(
        title=req.title,
        year=req.year,
        poster_url=req.poster_url,
        sources=[s.model_dump() for s in req.sources],
    )
    db.add(fav)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # 并发场景：另一请求已插入，重查一次返回当前状态
        existing = (await db.execute(stmt)).scalars().first()
        if existing:
            logger.info("favorite_toggle_race_resolved fav_id=%d title=%s year=%s", existing.id, req.title, req.year)
            return {"favorited": True, "id": existing.id}
        logger.warning(
            "favorite_toggle_duplicate title=%s year=%s", req.title, req.year
        )
        raise HTTPException(
            status_code=409,
            detail=f"Favorite already exists for title='{req.title}' and year={req.year}",
        )
    await db.refresh(fav)
    logger.info("favorite_toggled_on fav_id=%d title=%s year=%s", fav.id, req.title, req.year)
    return {"favorited": True, "id": fav.id}


@router.delete("/{fav_id}")
async def remove_favorite(fav_id: int, db: AsyncSession = Depends(get_db)):
    fav = await db.get(Favorite, fav_id)
    if not fav:
        raise HTTPException(status_code=404, detail="Favorite not found")
    await db.delete(fav)
    await db.commit()
    logger.info("favorite_removed fav_id=%d title=%s", fav_id, fav.title)
    return {"ok": True}
