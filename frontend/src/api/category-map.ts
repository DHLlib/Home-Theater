import { get, post } from "./client";

export interface CategoryMapName {
  raw_name: string;
  sources: number;
  videos: number;
  samples: string[];
  adult: boolean;
}

export interface CategoryMapGroup {
  group_key: string;
  names: CategoryMapName[];
  sources: number;
  videos: number;
  mapped: boolean;
  /** 组内部分类名已映射（仍有变体未映射） */
  partial: boolean;
  current_system: string | null;
  scope: "global" | "site" | null;
  suggested_system: string | null;
  suggestion_source: "history" | "rule" | "similarity" | "none" | string;
  confidence: number;
  cross_site: { sites: number; sources: number };
}

export interface CategoryMapStats {
  names: number;
  mapped: number;
  unmapped: number;
  videos: number;
  uncategorized_videos: number;
  no_name_sources: number;
  no_name_videos: number;
}

export interface CategoryMapResponse {
  site: { id: number; name: string };
  stats: CategoryMapStats;
  groups: CategoryMapGroup[];
}

export interface CategoryMapSaveItem {
  raw_names: string[];
  system_name: string;
  scope: "global" | "site";
}

export interface CategoryMapSaveResult {
  ok: boolean;
  aliases_written: number;
  overrides_written: number;
  names_touched: number;
  recomputed_videos: number;
  uncategorized_before: number;
  uncategorized_after: number;
  undo_available: boolean;
}

export const getSiteCategoryMap = (siteId: number) =>
  get<CategoryMapResponse>(`/api/sites/${siteId}/category-map`, 60000);

export interface CategoryMapSummaryItem {
  site_id: number;
  names: number;
  unmapped: number;
  sources: number;
}

export const getCategoryMapSummary = () =>
  get<{ items: CategoryMapSummaryItem[] }>("/api/sites/category-map/summary", 30000);

export const saveSiteCategoryMap = (
  siteId: number,
  items: CategoryMapSaveItem[],
  fillRestSystem?: string | null
) =>
  post<CategoryMapSaveResult>(
    `/api/sites/${siteId}/category-map`,
    { items, fill_rest_system: fillRestSystem || null },
    120000
  );

export const undoSiteCategoryMap = (siteId: number) =>
  post<{ ok: boolean; names_restored?: number; detail?: string }>(
    `/api/sites/${siteId}/category-map/undo`,
    {},
    120000
  );
