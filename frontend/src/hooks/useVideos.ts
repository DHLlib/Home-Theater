import {
  useQuery,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listSites } from "../api/sites";
import {
  getDetail,
  getRecommendedVideos,
  getCrawlerStatus,
  listVideos,
  searchVideos,
} from "../api/videos";
import { queryClient } from "../lib/queryClient";
import type { AggregatedVideo, SourceRef } from "../types";

/* 无限分页内存封顶：超过该数量后裁剪最旧页面，防止 JS 堆无限增长 */
const MAX_INFINITE_ITEMS = 1000;

/* 刷新后恢复已加载页数（配合滚动位置恢复，避免深滚动只能回到第一页底部） */
const PAGES_STORAGE_PREFIX = "home-pages:";

export const queryKeys = {
  sites: ["sites"] as const,
  recommended: ["recommendedVideos"] as const,
  crawlerStatus: ["crawlerStatus"] as const,
  videosInfinite: (filters: { category?: string | null; wd?: string; sort?: string }) =>
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
  sort?: string;
}) {
  const wd = filters.wd?.trim() ?? "";
  const pagesKey = PAGES_STORAGE_PREFIX + JSON.stringify(filters);
  const query = useInfiniteQuery({
    queryKey: queryKeys.videosInfinite(filters),
    queryFn: async ({ pageParam = 1 }) => {
      const categoryParam = filters.category
        ? { category: filters.category }
        : {};
      const sortParam = filters.sort ? { sort: filters.sort } : {};
      const response = wd
        ? await searchVideos({
            wd,
            pg: pageParam,
            mode: "aggregated",
            ...categoryParam,
            ...sortParam,
          })
        : await listVideos({
            pg: pageParam,
            mode: "aggregated",
            ...categoryParam,
            ...sortParam,
          });
      return response.items;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length === 0) return undefined;
      return allPages.length + 1;
    },
    initialPageParam: 1,
  });

  const fetchNextPage = query.fetchNextPage;
  const [pagesRestored, setPagesRestored] = useState(false);
  const restoredPagesRef = useRef(false);

  // 切换筛选条件时允许对新 key 重新恢复
  useEffect(() => {
    restoredPagesRef.current = false;
    setPagesRestored(false);
  }, [pagesKey]);

  // 记录已加载页数，供刷新后补齐；恢复完成前不写入，避免把保存值冲成 1
  useEffect(() => {
    if (!query.data || !pagesRestored) return;
    try {
      sessionStorage.setItem(pagesKey, String(query.data.pages.length));
    } catch {
      // 隐私模式/配额满：忽略
    }
  }, [query.data, pagesKey, pagesRestored]);

  // 刷新后把页数补回保存值，补完再允许滚动恢复
  useEffect(() => {
    if (restoredPagesRef.current) return;
    const data = query.data;
    if (!data) return;

    let saved = 1;
    try {
      saved = Number(sessionStorage.getItem(pagesKey) ?? "1") || 1;
    } catch {
      saved = 1;
    }

    if (data.pages.length >= saved || !query.hasNextPage) {
      restoredPagesRef.current = true;
      setPagesRestored(true);
      return;
    }
    if (!query.isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [
    query.data,
    query.hasNextPage,
    query.isFetchingNextPage,
    fetchNextPage,
    pagesKey,
  ]);

  // 内存封顶：当缓存页累计超过阈值时，裁剪最旧的页面
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    const total = data.pages.reduce((sum, page) => sum + page.length, 0);
    if (total <= MAX_INFINITE_ITEMS) return;

    queryClient.setQueryData<InfiniteData<AggregatedVideo[], number>>(
      queryKeys.videosInfinite(filters),
      (old) => {
        if (!old) return old;
        let kept = 0;
        const newPages: AggregatedVideo[][] = [];
        for (const page of old.pages) {
          if (kept + page.length <= MAX_INFINITE_ITEMS) {
            newPages.push(page);
            kept += page.length;
          } else {
            const take = MAX_INFINITE_ITEMS - kept;
            if (take > 0) newPages.push(page.slice(0, take));
            break;
          }
        }
        return {
          ...old,
          pages: newPages,
          pageParams: old.pageParams.slice(0, newPages.length),
        };
      }
    );
  }, [query.data, filters]);

  const totalItems =
    query.data?.pages.reduce((sum, page) => sum + page.length, 0) ?? 0;
  const isCapped = totalItems >= MAX_INFINITE_ITEMS;

  return {
    ...query,
    totalItems,
    isCapped,
    maxItems: MAX_INFINITE_ITEMS,
    pagesRestored,
  };
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
    queryFn: () => getDetail({ title, year, sources }),
    enabled: title.length > 0 && sources.length > 0,
    // 详情失败时不再自动重试：一次 15 秒超时已经够久，重试只会叠出多个 toast
    retry: false,
  });
}
