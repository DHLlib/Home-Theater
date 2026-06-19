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
    fav = Favorite(title=req.title, year=req.year, poster_url=req.poster_url, sources=[s.model_dump() for s in req.sources])
    db.add(fav)
    await db.commit()
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
