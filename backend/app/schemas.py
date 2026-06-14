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
    type_id: int | None = None
    category: str | None = None
    remarks: str | None = None
    updated_at: str | None = None


class AggregatedVideo(BaseModel):
    title: str
    year: int | None = None
    poster_url: str | None = None
    sources: list[SourceRef]
    source_count: int = 1


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


class DownloadBatchItem(BaseModel):
    episode_index: int
    episode_name: str
    url: str
    suffix: str


class DownloadBatchCreate(BaseModel):
    site_id: int
    original_id: str
    title: str
    year: int | None = None
    episodes: list[DownloadBatchItem]


class DownloadBatchResult(BaseModel):
    created: list[int] = Field(default_factory=list)
    skipped: list[int] = Field(default_factory=list)
    recreated: list[int] = Field(default_factory=list)


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
    sources: list[SourceRef] = Field(default_factory=list)


class FavoriteOut(BaseModel):
    id: int
    title: str
    year: int | None = None
    poster_url: str | None = None
    sources: list[SourceRef] = Field(default_factory=list)
    created_at: str | None = None


class ProbeResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    error: str | None = None


class SiteProbeResult(BaseModel):
    site_id: int
    site_name: str
    url: str
    ok: bool
    latency_ms: int | None = None
    error: str | None = None


class SiteProbeLogEntry(BaseModel):
    id: int
    site_id: int
    ok: bool
    error: str | None = None
    latency_ms: int | None = None
    created_at: str | None = None


class SiteHealthOut(BaseModel):
    site_id: int
    site_name: str
    enabled: bool
    auto_disabled_at: str | None = None
    latest_probe: SiteProbeLogEntry | None = None
    recent_logs: list[SiteProbeLogEntry] = Field(default_factory=list)
    availability_24h: float = 0.0


class ProbeSitesBatchRequest(BaseModel):
    site_ids: list[int] | None = None


class CategoryMapping(BaseModel):
    remote_id: str
    name: str
    enabled: bool = True


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


class BatchProbeItem(BaseModel):
    name: str = Field(..., min_length=1)
    url: str = Field(..., min_length=1)


class BatchProbeResult(BaseModel):
    name: str
    url: str
    ok: bool
    latency_ms: int | None
    error: str | None
    added: bool


class BatchProbeResponse(BaseModel):
    results: list[BatchProbeResult]


class SiteStat(BaseModel):
    site_id: int
    site_name: str
    count: int
    with_detail: int
    without_detail: int


class HistoryPoint(BaseModel):
    """历史统计快照点"""
    ts: str
    total: int
    with_detail: int


class CrawlerStatsResponse(BaseModel):
    total: int
    by_site: list[SiteStat]
    with_detail: int
    without_detail: int
    aggregated_count: int
    last_updated_at: str | None = None
    history: list[HistoryPoint] = Field(default_factory=list)
    computed_at: str | None = None


class FillVideolistRequest(BaseModel):
    site_id: int | None = None


class FillVideolistSiteResult(BaseModel):
    site_id: int
    site_name: str
    missing: int
    filled: int
    failed: int


class FillVideolistResponse(BaseModel):
    message: str
    site_id: int | None = None
    results: list[FillVideolistSiteResult] = Field(default_factory=list)


# ===== AC-026: 智能分类映射 Schema =====

class SmartMatchItem(BaseModel):
    remote_id: str
    remote_name: str
    suggested_system_name: str | None
    confidence: float = Field(..., ge=0.0, le=1.0)
    status: str  # auto_mapped | suggested | unrecognized | already_mapped
    flag: str | None = None  # adult_content | None


class SmartMatchSummary(BaseModel):
    total: int
    auto_mapped: int
    suggested: int
    unrecognized: int
    already_mapped: int


class SmartMatchResponse(BaseModel):
    site_id: int
    matches: list[SmartMatchItem]
    summary: SmartMatchSummary


# ===== AC-027: 分类层级展示 Schema =====

class CategoryMappingWithPid(BaseModel):
    """带子分类标记的分类映射"""
    remote_id: str
    name: str
    type_pid: str | None = None


class CategoryGroup(BaseModel):
    """父分类分组"""
    parent_id: str | None = None
    parent_name: str | None = None
    categories: list[CategoryMappingWithPid]


class SiteCategoriesFetchOut(BaseModel):
    """fetch-categories 新响应格式（层级分组）"""
    site_id: int
    groups: list[CategoryGroup]


# ===== AC-028: 分类映射模板预设 Schema =====

class TemplateMatchRules(BaseModel):
    site_name_keywords: list[str]
    url_keywords: list[str]


class CategoryTemplate(BaseModel):
    name: str
    match_rules: TemplateMatchRules
    mappings: dict[str, str]  # remote_id -> system_name


class TemplateApplySkipped(BaseModel):
    remote_id: str
    name: str
    reason: str  # "already_mapped"
    existing_system_name: str


class TemplateApplyUnrecognized(BaseModel):
    remote_id: str
    name: str


class TemplateApplySummary(BaseModel):
    total_in_template: int
    applied_count: int
    skipped_count: int
    unrecognized_count: int


class TemplateApplyResponse(BaseModel):
    site_id: int
    template_matched: bool
    template_name: str | None
    applied: list[CategoryMapping]
    skipped: list[TemplateApplySkipped]
    unrecognized: list[TemplateApplyUnrecognized]
    summary: TemplateApplySummary


class TemplatePreviewItem(BaseModel):
    remote_id: str
    name: str
    action: str  # "apply" | "skip"
    existing: str | None = None


class TemplatePreviewResponse(BaseModel):
    site_id: int
    template_matched: bool
    template_name: str | None
    would_apply: int
    would_skip: int
    would_unrecognized: int
    preview: list[TemplatePreviewItem]


# ===== SystemCategory: 系统分类（父子层级）=====

class SystemCategoryCreate(BaseModel):
    name: str = Field(..., min_length=1)
    parent_id: int | None = None
    sort: int = 0


class SystemCategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    sort: int | None = None
    enabled: bool | None = None


class SystemCategoryOut(BaseModel):
    id: int
    parent_id: int | None = None
    name: str
    sort: int
    enabled: bool = True
    created_at: str | None = None


class SystemCategoryTreeItem(BaseModel):
    id: int
    parent_id: int | None = None
    name: str
    sort: int
    enabled: bool = True
    children: list[SystemCategoryTreeItem] = Field(default_factory=list)
