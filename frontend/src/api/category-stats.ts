import { get } from "./client";

export interface CategoryStats {
  counts: Record<string, number>;
  uncategorized: number;
  total: number;
}

export const getCategoryStats = () => get<CategoryStats>("/api/videos/categories/stats");
