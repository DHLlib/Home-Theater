from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (Index("ix_sites_enabled_sort", "enabled", "sort"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    base_url: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    categories: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)
    auto_disabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("title", "year", name="uix_favorite_title_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PlayProgress(Base):
    __tablename__ = "play_progress"
    __table_args__ = (
        UniqueConstraint("title", "year", name="uix_progress_title_year"),
        Index("ix_progress_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_site_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sites.id"), nullable=False
    )
    source_video_id: Mapped[str] = mapped_column(String, nullable=False)
    episode_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    episode_name: Mapped[str] = mapped_column(String, default="", nullable=False)
    position_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class DownloadTask(Base):
    __tablename__ = "download_tasks"
    __table_args__ = (Index("ix_download_created_at", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    episode_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    episode_name: Mapped[str] = mapped_column(String, default="", nullable=False)
    source_site_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sites.id"), nullable=False
    )
    source_video_id: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    suffix: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    total_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    downloaded_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_segments: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    downloaded_segments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String, default="queued", nullable=False, index=True
    )
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class VideoCache(Base):
    __tablename__ = "video_cache"
    __table_args__ = (
        UniqueConstraint("site_id", "original_id", name="uix_video_cache"),
        Index("ix_video_cache_title_year", "title", "year"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(Integer, ForeignKey("sites.id"), nullable=False)
    original_id: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    intro: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    area: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    actors: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    director: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    play_url_raw: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_updated_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    cached_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppConfig(Base):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
