from __future__ import annotations

from pydantic import BaseModel, Field


class Episode(BaseModel):
    ep_name: str
    url: str
    suffix: str
    index: int


class SourceRef(BaseModel):
    site_id: int
    site_name: str | None = None
    original_id: str
    type: str | None = None
    category: str | None = None
    remarks: str | None = None
    updated_at: str | None = None


class AggregatedVideo(BaseModel):
    title: str
    year: int | None = None
    poster_url: str | None = None
    sources: list[SourceRef]


class AggregatedListResponse(BaseModel):
    items: list[AggregatedVideo]
    failed_sources: list[dict] = Field(default_factory=list)


class SourceDetail(BaseModel):
    site_id: int
    site_name: str | None = None
    original_id: str
    title: str
    year: int | None = None
    poster_url: str | None = None
    intro: str | None = None
    area: str | None = None
    actors: str | None = None
    director: str | None = None
    episodes: list[Episode] = Field(default_factory=list)


class DetailRequest(BaseModel):
    title: str
    year: int | None = None
    sources: list[SourceRef]


class DetailResponse(BaseModel):
    title: str
    year: int | None = None
    sources: list[SourceDetail]


class DownloadTaskCreate(BaseModel):
    site_id: int
    original_id: str
    episode_index: int
    episode_name: str
    url: str
    suffix: str
    title: str
    year: int | None = None


class DownloadTaskOut(BaseModel):
    id: int
    title: str
    episode_index: int
    episode_name: str
    source_site_id: int
    source_video_id: str
    url: str
    suffix: str
    file_path: str
    total_bytes: int | None
    downloaded_bytes: int
    total_segments: int | None
    downloaded_segments: int
    status: str
    error: str | None
    created_at: str | None = None
    updated_at: str | None = None


class PlayProgressIn(BaseModel):
    title: str
    year: int | None = None
    source_site_id: int
    source_video_id: str
    episode_index: int
    episode_name: str
    position_seconds: int
    duration_seconds: int | None = None


class PlayProgressOut(BaseModel):
    id: int
    title: str
    year: int | None = None
    source_site_id: int
    source_video_id: str
    episode_index: int
    episode_name: str
    position_seconds: int
    duration_seconds: int | None = None
    updated_at: str | None = None


class FavoriteIn(BaseModel):
    title: str
    year: int | None = None
    poster_url: str | None = None


class FavoriteOut(BaseModel):
    id: int
    title: str
    year: int | None = None
    poster_url: str | None = None
    created_at: str | None = None


class ProbeResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    error: str | None = None


class CategoryMapping(BaseModel):
    remote_id: str
    name: str


class SiteCategoriesOut(BaseModel):
    site_id: int
    categories: list[CategoryMapping]


class SiteCategoriesUpdate(BaseModel):
    categories: list[CategoryMapping]


class FailedSource(BaseModel):
    site_id: int | None = None
    site_name: str | None = None
    error: str


class SiteCreate(BaseModel):
    name: str = Field(..., min_length=1)
    base_url: str = Field(..., min_length=1)
    enabled: bool = True
    sort: int = 0


class SitePatch(BaseModel):
    name: str | None = None
    base_url: str | None = None
    enabled: bool | None = None
    sort: int | None = None
    categories: list[dict] | None = None


class CrawlerLog(BaseModel):
    timestamp: str
    site_id: int
    site_name: str
    category: str
    page: int
    crawl_type: str
    items_count: int
    new_count: int
    update_count: int
    duration_ms: int


class CrawlerLogsResponse(BaseModel):
    logs: list[CrawlerLog]


class SiteStat(BaseModel):
    site_id: int
    site_name: str
    count: int


class CrawlerStatsResponse(BaseModel):
    total: int
    by_site: list[SiteStat]
    with_detail: int
    last_updated_at: str | None = None
