from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Favorite
from app.schemas import FavoriteIn

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.get("")
async def list_favorites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Favorite).order_by(Favorite.created_at.desc())
    )
    return result.scalars().all()


@router.post("")
async def add_favorite(req: FavoriteIn, db: AsyncSession = Depends(get_db)):
    fav = Favorite(title=req.title, year=req.year, poster_url=req.poster_url)
    db.add(fav)
    await db.commit()
    await db.refresh(fav)
    return fav


@router.delete("/{fav_id}")
async def remove_favorite(fav_id: int, db: AsyncSession = Depends(get_db)):
    fav = await db.get(Favorite, fav_id)
    if not fav:
        raise HTTPException(status_code=404, detail="Favorite not found")
    await db.delete(fav)
    await db.commit()
    return {"ok": True}
