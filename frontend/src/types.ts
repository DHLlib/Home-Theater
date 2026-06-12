export interface Episode {
  ep_name: string;
  url: string;
  suffix: string;
  index: number;
}

export interface PlaySource {
  site_id: number;
  site_name: string;
  original_id: string;
  episode_count: number;
  suffix: string;
}

export interface PlaySourcesResponse {
  sources: PlaySource[];
}

export interface SourceRef {
  site_id: number;
  site_name?: string | null;
  original_id: string;
  type?: string;
  category?: string;
  remarks?: string;
  updated_at?: string;
}

export interface AggregatedVideo {
  title: string;
  year?: number | null;
  poster_url?: string | null;
  sources: SourceRef[];
}

export interface AggregatedListResponse {
  items: AggregatedVideo[];
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

export interface DownloadTask {
  id: number;
  title: string;
  episode_index: number;
  episode_name: string;
  source_site_id: number;
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
  last_updated_at: string | null;
  history: HistoryPoint[];
  computed_at: string | null;
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
