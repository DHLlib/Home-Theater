export interface Episode {
  ep_name: string;
  url: string;
  suffix: string;
  index: number;
  /** 播放前探测：false = 线路不通，null/undefined = 未探测 */
  reachable?: boolean | null;
}

export interface PlaySourceQuality {
  attempts: number;
  success_rate: number;
  avg_first_frame_ms?: number | null;
  stall_count: number;
  last_success_at?: string | null;
}

export interface SourceMediaInfo {
  width?: number | null;
  height?: number | null;
  video_bitrate?: number | null;
  codec?: string | null;
  evidence: "declared" | "probed" | "actual" | "unknown";
  method: string;
  checked_at: string;
  description?: string | null;
}

export interface SourceRef {
  site_id: number;
  site_name?: string | null;
  original_id: string;
  type?: string;
  category?: string;
  remarks?: string;
  updated_at?: string;
  recommended?: boolean;
  hd_recommended?: boolean;
  stable_recommended?: boolean;
  recommendation_reason?: string | null;
  hd_reason?: string | null;
  quality?: PlaySourceQuality | null;
  media?: SourceMediaInfo | null;
}

export interface PlaySource extends SourceRef {
  site_name: string;
  episode_count: number;
  suffix: string;
}

export interface PlaySourcesResponse {
  sources: PlaySource[];
  analyzed?: number;
  remaining?: number;
  analysis_running?: boolean;
  analysis_disabled?: boolean;
  next_offset?: number;
  total?: number;
}

export type PlaybackEventType =
  | "attempt"
  | "first_frame"
  | "stall"
  | "fatal_error"
  | "ended";

export interface PlaybackMediaInfo {
  url: string;
  width: number;
  height: number;
  video_bitrate?: number | null;
  codec?: string | null;
}

export interface PlaybackEventInput {
  event_id: string;
  session_id: string;
  site_id: number;
  original_id: string;
  episode_index: number;
  event_type: PlaybackEventType;
  first_frame_ms?: number | null;
  error?: string | null;
  media?: PlaybackMediaInfo;
}

export interface AggregatedVideo {
  id?: number | null;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  poster_urls?: string[] | null;
  sources: SourceRef[];
}

export interface AggregatedListResponse {
  items: AggregatedVideo[];
}

export interface HomeSection {
  category: string;
  items: AggregatedVideo[];
}

export interface HomeSectionsResponse {
  sections: HomeSection[];
}

export interface SourceDetail {
  site_id: number;
  site_name?: string | null;
  original_id: string;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  intro?: string | null;
  area?: string | null;
  actors?: string | null;
  director?: string | null;
  type_name?: string | null;
  episodes: Episode[];
}

export interface DetailRequest {
  title: string;
  year?: number | null;
  sources: SourceRef[];
}

export interface DetailResponse {
  title: string;
  year?: number | null;
  sources: SourceDetail[];
  /** 视频级系统分类（聚合表算出来的），null 表示未分类 */
  system_category?: string | null;
}

export interface DownloadTaskCreate {
  site_id: number;
  original_id: string;
  episode_index: number;
  episode_name: string;
  url: string;
  suffix: string;
  title: string;
  year?: number | null;
}

export interface DownloadBatchItem {
  episode_index: number;
  episode_name: string;
  url: string;
  suffix: string;
}

export interface DownloadBatchCreate {
  site_id: number;
  original_id: string;
  title: string;
  year?: number | null;
  episodes: DownloadBatchItem[];
}

export interface DownloadBatchResult {
  created: number[];
  skipped: number[];
  recreated: number[];
}

export interface DownloadTask {
  id: number;
  title: string;
  episode_index: number;
  episode_name: string;
  source_site_id: number;
  /** 站点名（列表接口 join sites 后返回），缺失时前端回退到「站点{id}」 */
  site_name?: string | null;
  source_video_id: string;
  url: string;
  suffix: string;
  file_path: string;
  total_bytes?: number | null;
  downloaded_bytes: number;
  total_segments?: number | null;
  downloaded_segments: number;
  status: string;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PlayProgressIn {
  title: string;
  year?: number | null;
  source_site_id: number;
  source_video_id: string;
  episode_index: number;
  episode_name: string;
  position_seconds: number;
  duration_seconds?: number | null;
}

export interface PlayProgress {
  id: number;
  title: string;
  year?: number | null;
  source_site_id: number;
  source_video_id: string;
  episode_index: number;
  episode_name: string;
  position_seconds: number;
  duration_seconds?: number | null;
  updated_at?: string | null;
}

export interface FavoriteIn {
  title: string;
  year?: number | null;
  poster_url?: string | null;
  sources?: SourceRef[];
}

export interface Favorite {
  id: number;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  sources?: SourceRef[];
  created_at?: string | null;
}

export interface ProbeResult {
  ok: boolean;
  latency_ms?: number | null;
  error?: string | null;
}

export interface SiteProbeResult {
  site_id: number;
  site_name: string;
  url: string;
  ok: boolean;
  latency_ms?: number | null;
  error?: string | null;
}

export interface CategoryMapping {
  remote_id: string;
  name: string;
  enabled?: boolean;
}

export interface CategoryMappingWithPid {
  remote_id: string;
  name: string;
  type_pid?: string | null;
}

export interface CategoryGroup {
  parent_id: string | null;
  parent_name: string | null;
  categories: CategoryMappingWithPid[];
}

export interface FetchCategoriesResponse {
  site_id: number;
  groups: CategoryGroup[];
}

export interface SiteCategoriesOut {
  site_id: number;
  categories: CategoryMapping[];
}

export interface SiteProbeLogEntry {
  id: number;
  site_id: number;
  ok: boolean;
  error?: string | null;
  latency_ms?: number | null;
  created_at?: string | null;
}

export interface SiteHealth {
  site_id: number;
  site_name: string;
  enabled: boolean;
  auto_disabled_at?: string | null;
  latest_probe?: SiteProbeLogEntry | null;
  recent_logs: SiteProbeLogEntry[];
  availability_24h: number;
}

export interface Site {
  id: number;
  name: string;
  base_url: string;
  enabled: boolean;
  sort: number;
  categories?: CategoryMapping[] | null;
  created_at?: string | null;
}

export interface CrawlerLog {
  timestamp: string;
  site_id: number;
  site_name: string;
  category: string;
  page: number;
  crawl_type: string;
  items_count: number;
  new_count: number;
  update_count: number;
  duration_ms: number;
}

export interface CrawlerLogsResponse {
  logs: CrawlerLog[];
}

export interface SiteStat {
  site_id: number;
  site_name: string;
  count: number;
  with_detail: number;
  without_detail: number;
}

export interface HistoryPoint {
  ts: string;
  total: number;
  with_detail: number;
}

export interface CrawlerStatsResponse {
  total: number;
  by_site: SiteStat[];
  with_detail: number;
  without_detail: number;
  aggregated_count: number;
  last_updated_at: string | null;
  history: HistoryPoint[];
  computed_at: string | null;
}

export type FillSiteState =
  | "pending"
  | "running"
  | "done"
  | "partial"
  | "blocked"
  | "failed";

export interface FillSiteStatus {
  site_id: number;
  site_name: string;
  state: FillSiteState;
  missing: number;
  filled: number;
  failed: number;
  skipped: number;
  error: string | null;
}

export type FillState =
  | "idle"
  | "running"
  | "done"
  | "partial"
  | "failed"
  | "interrupted";

export interface FillStatus {
  state: FillState;
  current_site_id: number | null;
  current_site_name: string | null;
  completed_sites: number;
  total_sites: number;
  missing: number;
  filled: number;
  failed: number;
  skipped: number;
  /** 后端按 epoch 秒或 ISO 字符串返回，两者都要兼容 */
  started_at: number | string | null;
  finished_at: number | string | null;
  error: string | null;
  sites: FillSiteStatus[];
}

export interface FillVideolistResponse {
  message: string;
  site_id: number | null;
  /** false = 已有任务在运行，本次没有启动新任务 */
  started: boolean;
  status: FillStatus;
}

export interface BatchProbeItem {
  name: string;
  url: string;
}

export interface BatchProbeResult {
  name: string;
  url: string;
  ok: boolean;
  latency_ms?: number | null;
  error?: string | null;
  added: boolean;
}

export interface BatchProbeResponse {
  results: BatchProbeResult[];
}

// ===== 站点导入导出 =====

export interface SiteExportMapping {
  remote_id: string;
  remote_name: string | null;
  system_name: string;
  enabled: boolean;
}

export interface SiteExportSite {
  name: string;
  base_url: string;
  enabled: boolean;
  sort: number;
  categories?: Record<string, unknown>[] | null;
  mappings: SiteExportMapping[];
}

export interface SiteExportOut {
  version: number;
  exported_at: string;
  sites: SiteExportSite[];
}

export interface SiteImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ===== AC-026 智能分类映射 =====

export interface SmartMatchItem {
  remote_id: string;
  remote_name: string;
  suggested_system_name: string | null;
  confidence: number;
  status: "auto_mapped" | "suggested" | "unrecognized" | "already_mapped";
  flag?: "adult_content" | null;
}

export interface SmartMatchSummary {
  total: number;
  auto_mapped: number;
  suggested: number;
  unrecognized: number;
  already_mapped: number;
}

export interface SmartMatchResponse {
  site_id: number;
  matches: SmartMatchItem[];
  summary: SmartMatchSummary;
}

// ===== AC-028 分类映射模板预设 =====

export interface TemplateApplySkipped {
  remote_id: string;
  name: string;
  reason: "already_mapped";
  existing_system_name: string;
}

export interface TemplateApplyUnrecognized {
  remote_id: string;
  name: string;
}

export interface TemplateApplySummary {
  total_in_template: number;
  applied_count: number;
  skipped_count: number;
  unrecognized_count: number;
}

export interface TemplateApplyResponse {
  site_id: number;
  template_matched: boolean;
  template_name: string | null;
  applied: CategoryMapping[];
  skipped: TemplateApplySkipped[];
  unrecognized: TemplateApplyUnrecognized[];
  summary: TemplateApplySummary;
}

export interface TemplatePreviewItem {
  remote_id: string;
  name: string;
  action: "apply" | "skip";
  existing?: string;
}

export interface TemplatePreviewResponse {
  site_id: number;
  template_matched: boolean;
  template_name: string | null;
  would_apply: number;
  would_skip: number;
  would_unrecognized: number;
  preview: TemplatePreviewItem[];
}

// ===== 统一运维任务（maintenance coordinator）=====

export type MaintenanceKind =
  | "crawl.full"
  | "crawl.incremental"
  | "detail.fill"
  | "cache.cleanup"
  | "site.discover";

export type MaintenanceState =
  | "queued"
  | "running"
  | "done"
  | "partial"
  | "failed"
  | "skipped"
  | "cancelled"
  | "interrupted";

export type MaintenanceTrigger = "manual" | "scheduled" | "startup" | "lifecycle";

export interface MaintenanceJob {
  id: string;
  kind: MaintenanceKind;
  state: MaintenanceState;
  trigger: MaintenanceTrigger;
  site_id: number | null;
  cancel_requested: boolean;
  progress_completed: number;
  progress_total: number;
  /** detail.fill 任务含 details.fill（FillStatus），cache.cleanup 含 details.cleanup（CleanupStatus） */
  details: Record<string, unknown>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** true = 已有同类活动任务，本次提交被去重，返回的是原有任务 */
  deduplicated?: boolean;
}

export interface MaintenanceProgressEvent {
  job_id: string;
  kind: MaintenanceKind;
  state: MaintenanceState;
  site_id: number | null;
  trigger: MaintenanceTrigger;
  progress_completed: number;
  progress_total: number;
  cancel_requested: boolean;
}

export interface SiteMaintenanceStatus {
  site_id: number;
  site_name: string;
  enabled: boolean;
  health: Record<string, unknown> | null;
  last_crawl_at: string | null;
  total: number;
  with_detail: number;
  without_detail: number;
  next_check_at: string | null;
  last_check_status: string | null;
  active_job_ids: string[];
}

export interface SiteScheduleInfo {
  next_health_at: string | null;
  next_check_at: string | null;
  last_check_status: string | null;
  last_error: string | null;
}

export interface MaintenanceScheduleSnapshot {
  health_interval_seconds: number;
  fill_next_run_at: string | null;
  sites: Record<string, SiteScheduleInfo>;
}

export interface MaintenanceOverview {
  sites: SiteMaintenanceStatus[];
  jobs: MaintenanceJob[];
  schedules: MaintenanceScheduleSnapshot;
}

// ===== SystemCategory: 系统分类（父子层级）=====

export interface SystemCategory {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
  created_at?: string | null;
}

export interface SystemCategoryTreeItem {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
  enabled?: boolean;
  children: SystemCategoryTreeItem[];
}
