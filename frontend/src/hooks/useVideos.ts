import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { listSites } from "../api/sites";
import {
  getDetail,
  getRecommendedVideos,
  getCrawlerStatus,
  listVideos,
  searchVideos,
} from "../api/videos";
import type { SourceRef } from "../types";

export const queryKeys = {
  sites: ["sites"] as const,
  recommended: ["recommendedVideos"] as const,
  crawlerStatus: ["crawlerStatus"] as const,
  videosInfinite: (filters: { category?: string | null; wd?: string }) =>
    ["videos", "infinite", filters] as const,
  search: (wd: string) => ["videos", "search", wd] as const,
  detail: (title: string, year?: number | null) =>
    ["detail", title, year ?? "null"] as const,
};

export function useSitesQuery() {
  return useQuery({
    queryKey: queryKeys.sites,
    queryFn: listSites,
  });
}

export function useRecommendedVideosQuery() {
  return useQuery({
    queryKey: queryKeys.recommended,
    queryFn: () => getRecommendedVideos().then((r) => r.items),
  });
}

export function useCrawlerStatusQuery() {
  return useQuery({
    queryKey: queryKeys.crawlerStatus,
    queryFn: getCrawlerStatus,
    refetchInterval: 10000,
  });
}

export function useVideosInfinite(filters: {
  category?: string | null;
  wd?: string;
}) {
  const wd = filters.wd?.trim() ?? "";
  return useInfiniteQuery({
    queryKey: queryKeys.videosInfinite(filters),
    queryFn: async ({ pageParam = 1 }) => {
      const categoryParam = filters.category
        ? { category: filters.category }
        : {};
      const response = wd
        ? await searchVideos({
            wd,
            pg: pageParam,
            mode: "aggregated",
            ...categoryParam,
          })
        : await listVideos({
            pg: pageParam,
            mode: "aggregated",
            ...categoryParam,
          });
      return response.items;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length === 0) return undefined;
      return allPages.length + 1;
    },
    initialPageParam: 1,
  });
}

export function useSearchVideosQuery(wd: string) {
  const q = wd.trim();
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () =>
      searchVideos({ wd: q, pg: 1, mode: "aggregated" }).then((r) => r.items),
    enabled: q.length > 0,
  });
}

export function useDetailQuery(
  title: string,
  year: number | null | undefined,
  sources: SourceRef[]
) {
  return useQuery({
    queryKey: queryKeys.detail(title, year),
    queryFn: () => getDetail({ title, year, sources }).then((r) => r.sources),
    enabled: title.length > 0 && sources.length > 0,
  });
}
