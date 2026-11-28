import { delWithBody, get, post } from "./client";

export interface CategoryNode {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
  enabled: boolean;
  videos: number;
  remotes: number;
  children: CategoryNode[];
}

export interface CategorySummary {
  unmapped_remotes: number;
  uncategorized_videos: number;
  linked_remotes: number;
  sites: number;
}

export interface CategoryOverview {
  categories: CategoryNode[];
  summary: CategorySummary;
}

export interface RemoteCategoryItem {
  site_id: number;
  site_name: string;
  site_enabled: boolean;
  remote_id: string;
  name: string;
  parent_remote_id: string | null;
  parent_name: string | null;
  sort: number;
  last_seen_at: string;
  stale: boolean;
  attached_category_id: number | null;
  attached_category_name: string | null;
  sources: number;
  videos: number;
  samples: string[];
}

export interface CategoryLinkInput {
  site_id: number;
  remote_id: string;
  system_category_id: number;
}

export interface CategoryActionResult {
  ok: boolean;
  linked?: number;
  unlinked?: number;
  affected_videos: number;
}

export interface RefreshResult {
  ok: boolean;
  sites: number;
  added: number;
  updated: number;
  errors: { site_id: number; site: string; error: string }[];
}

export const getCategoryOverview = () =>
  get<CategoryOverview>("/api/category-settings/overview");

export const getCategoryRemotes = () =>
  get<{ items: RemoteCategoryItem[] }>("/api/category-settings/remotes", 60000);

export const attachCategoryLinks = (items: CategoryLinkInput[]) =>
  post<CategoryActionResult>("/api/category-settings/links", { items }, 120000);

export const detachCategoryLinks = (items: { site_id: number; remote_id: string }[]) =>
  delWithBody<CategoryActionResult>("/api/category-settings/links", { items }, 120000);

export const refreshRemoteCategories = () =>
  post<RefreshResult>("/api/category-settings/refresh", {}, 180000);
