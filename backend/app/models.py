from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {
        dict: JSON,
        list: JSON,
    }


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SystemCategory(Base):
    __tablename__ = "system_categories"
    __table_args__ = (
        Index("ix_system_categories_parent", "parent_id"),
        UniqueConstraint("parent_id", "name", name="uix_system_category_parent_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("system_categories.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class SiteCategoryMapping(Base):
    __tablename__ = "site_category_mappings"
    __table_args__ = (
        UniqueConstraint("site_id", "remote_id", name="uix_site_remote_id"),
        Index("ix_site_category_mappings_site_id", "site_id"),
        Index("ix_site_category_mappings_system_name", "system_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    remote_id: Mapped[str] = mapped_column(String, nullable=False)
    remote_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    system_name: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("title", "year", name="uix_favorite_title_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sources: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


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
        DateTime, default=_utcnow, onupdate=_utcnow
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )


class VideoCache(Base):
    __tablename__ = "video_cache"
    __table_args__ = (
        UniqueConstraint("site_id", "original_id", name="uix_video_cache"),
        Index("ix_video_cache_title_year", "title", "year"),
        Index("ix_video_cache_type", "site_id", "type_id"),
        Index("ix_video_cache_site_detail", "site_id", "has_detail"),
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
    cached_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    type_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    type_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    play_from: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    has_detail: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    search_vector: Mapped[Optional[TSVECTOR]] = mapped_column(TSVECTOR, nullable=True)


class AggregatedVideoV1(Base):
    """预聚合视频缓存表 v1（PostgreSQL 下不再使用，保留模型兼容历史数据）。"""

    __tablename__ = "aggregated_videos_v1"
    __table_args__ = (Index("ix_agg_v1_updated", "latest_updated_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sources: Mapped[list[dict]] = mapped_column(JSON, default=list)
    latest_updated_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    cached_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class AggregatedVideoV2(Base):
    """预聚合视频缓存表 v2（PostgreSQL 下不再使用，保留模型兼容历史数据）。"""

    __tablename__ = "aggregated_videos_v2"
    __table_args__ = (Index("ix_agg_v2_updated", "latest_updated_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sources: Mapped[list[dict]] = mapped_column(JSON, default=list)
    latest_updated_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    cached_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class AggregatedVideo(Base):
    """物化视图映射（只读）。

    对应物化视图 mv_aggregated_videos，由 SQL 脚本创建和维护。
    """

    __tablename__ = "mv_aggregated_videos"
    __table_args__ = {"info": {"is_view": True}}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sources: Mapped[list[dict]] = mapped_column(JSON, default=list)
    types: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    latest_updated_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class AppConfig(Base):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )
