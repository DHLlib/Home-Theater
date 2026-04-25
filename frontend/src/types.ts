export interface Episode {
  ep_name: string;
  url: string;
  suffix: string;
  index: number;
}

export interface SourceRef {
  site_id: number;
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
  failed_sources: FailedSource[];
}

export interface SourceDetail {
  site_id: number;
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
}

export interface Favorite {
  id: number;
  title: string;
  year?: number | null;
  poster_url?: string | null;
  created_at?: string | null;
}

export interface ProbeResult {
  ok: boolean;
  latency_ms?: number | null;
  error?: string | null;
}

export interface FailedSource {
  site_id?: number | null;
  site_name?: string | null;
  error: string;
}

export interface CategoryMapping {
  remote_id: string;
  name: string;
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
