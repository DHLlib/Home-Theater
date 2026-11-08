import { get, post, put, del } from "./client";

export interface CategoryAliasItem {
  name_key: string;
  system_name: string;
  enabled: boolean;
  source: string;
  raw_names: string[];
  source_count: number;
  site_count: number;
}

export interface UnmappedCategoryItem {
  name_key: string;
  raw_names: string[];
  source_count: number;
  site_count: number;
  suggested_system_name: string | null;
}

export interface CategoryStats {
  counts: Record<string, number>;
  uncategorized: number;
  total: number;
}

export const listCategoryAliases = () =>
  get<{ items: CategoryAliasItem[]; system_categories: string[] }>(
    "/api/category-aliases"
  );

export const listUnmappedCategories = () =>
  get<{ items: UnmappedCategoryItem[] }>("/api/category-aliases/unmapped");

export const listCategoryOverrides = () =>
  get<{
    items: {
      id: number;
      site_id: number;
      site_name: string | null;
      name_key: string;
      raw_name: string;
      system_name: string;
    }[];
  }>("/api/category-aliases/overrides");

export const saveCategoryOverride = (
  siteId: number,
  rawName: string,
  systemName: string
) =>
  post<{ ok: boolean; id: number; name_key: string; system_name: string }>(
    "/api/category-aliases/overrides",
    { site_id: siteId, raw_name: rawName, system_name: systemName }
  );

export const deleteCategoryOverride = (siteId: number, nameKey: string) =>
  del<{ ok: boolean }>(
    `/api/category-aliases/overrides?site_id=${siteId}&name_key=${encodeURIComponent(
      nameKey
    )}`
  );

export const saveCategoryAlias = (rawName: string, systemName: string) =>
  post<{ ok: boolean; name_key: string; system_name: string }>(
    "/api/category-aliases",
    { raw_name: rawName, system_name: systemName }
  );

export const updateCategoryAlias = (
  nameKey: string,
  body: { system_name?: string; enabled?: boolean }
) =>
  put<{ ok: boolean; name_key: string; system_name: string; enabled: boolean }>(
    `/api/category-aliases/${encodeURIComponent(nameKey)}`,
    body
  );

export const deleteCategoryAlias = (nameKey: string) =>
  del<{ ok: boolean }>(`/api/category-aliases/${encodeURIComponent(nameKey)}`);

export const adoptCategoryAliases = (
  items: { raw_name: string; system_name: string }[]
) => post<{ ok: boolean; adopted: number }>("/api/category-aliases/adopt", { items });

export const getCategoryStats = () =>
  get<CategoryStats>("/api/videos/categories/stats");
