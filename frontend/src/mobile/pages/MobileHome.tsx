import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import MobileVideoCard from "../components/MobileVideoCard";
import {
  useCrawlerStatusQuery,
  useRecommendedVideosQuery,
  useSitesQuery,
  useVideosInfinite,
} from "../../hooks/useVideos";
import { listSystemCategories } from "../../api/system-categories";
import { useQuery } from "@tanstack/react-query";
import type { SystemCategoryTreeItem } from "../../types";

function videoKey(item: { title: string; year?: number | null }): string {
  return `${item.title}-${item.year ?? "null"}`;
}

function getLatestUpdatedAt(item: { sources: { updated_at?: string }[] }): string | null {
  let latest: string | null = null;
  for (const s of item.sources) {
    if (s.updated_at) {
      if (!latest || s.updated_at > latest) latest = s.updated_at;
    }
  }
  return latest;
}

function flattenCategories(tree: SystemCategoryTreeItem[]): SystemCategoryTreeItem[] {
  const result: SystemCategoryTreeItem[] = [];
  for (const node of tree) {
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        result.push(child);
      }
    } else if (!node.parent_id) {
      result.push(node);
    }
  }
  return result;
}

export default function MobileHome() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") || null;
  const sort = searchParams.get("sort") === "year" ? "year" : "updated";

  const { data: sites = [] } = useSitesQuery();
  const { data: recommendedVideos = [], isLoading: recommendedLoading } =
    useRecommendedVideosQuery();
  const { data: crawlerStatus } = useCrawlerStatusQuery();
  const { data: categoriesTree = [] } = useQuery({
    queryKey: ["systemCategories"],
    queryFn: listSystemCategories,
  });
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isCapped,
  } = useVideosInfinite({ category: activeCategory, wd: "", sort });

  const videos = useMemo(() => data?.pages.flat() ?? [], [data]);

  const leafCategories = useMemo(
    () => flattenCategories(categoriesTree),
    [categoriesTree]
  );

  const latestSection = useMemo(() => {
    const sorted = [...videos].sort((a, b) => {
      const ta = getLatestUpdatedAt(a);
      const tb = getLatestUpdatedAt(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });
    return sorted.slice(0, 10);
  }, [videos]);

  const allSection = useMemo(() => {
    const featured = new Set(latestSection.map((v) => videoKey(v)));
    const list = [...videos].filter((v) => !featured.has(videoKey(v)));
    list.sort((a, b) => {
      if (sort === "year") {
        const ya = a.year ?? -Infinity;
        const yb = b.year ?? -Infinity;
        if (ya !== yb) return yb - ya;
      }
      const ta = getLatestUpdatedAt(a) || "";
      const tb = getLatestUpdatedAt(b) || "";
      return tb.localeCompare(ta);
    });
    return list;
  }, [videos, latestSection, sort]);

  const isSyncing = Object.values(crawlerStatus?.site_status || {}).some(
    (s) => s === "full_crawling" || s === "incremental_running"
  );

  // 刮削完成后自动刷新
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    const statuses = Object.values(crawlerStatus?.site_status || {});
    const syncing = statuses.some(
      (s) => s === "full_crawling" || s === "incremental_running"
    );
    if (wasSyncingRef.current && !syncing && videos.length === 0) {
      refetch();
    }
    wasSyncingRef.current = syncing;
  }, [crawlerStatus, videos.length, refetch]);

  // 无限滚动 sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchNextPageRef = useRef(fetchNextPage);
  fetchNextPageRef.current = fetchNextPage;
  const isCappedRef = useRef(isCapped);
  isCappedRef.current = isCapped;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || isLoading || isCappedRef.current) return;

    const rootMargin = 300;
    const maybeFetch = () => {
      if (!isCappedRef.current) fetchNextPageRef.current();
    };

    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    if (
      rect.top <= viewportHeight + rootMargin &&
      rect.bottom >= -rootMargin
    ) {
      maybeFetch();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isCappedRef.current) {
          fetchNextPageRef.current();
        }
      },
      { rootMargin: `${rootMargin}px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isLoading, videos.length, isCapped]);

  const hasContent =
    recommendedVideos.length > 0 || latestSection.length > 0 || allSection.length > 0;

  if (sites.length === 0) {
    return (
      <div className="mobile-page mobile-empty">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <path d="M14 10l-2.5 2.5L9 10" />
        </svg>
        <div className="mobile-empty-title">暂无采集站</div>
        <p>添加采集站后即可浏览内容</p>
      </div>
    );
  }

  return (
    <div className="mobile-page" style={{ paddingTop: 8 }}>
      {/* 分类 Tabs */}
      <div className="mobile-category-tabs">
        <button
          className={`mobile-category-tab${!activeCategory ? " active" : ""}`}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("category");
            setSearchParams(next, { replace: true });
          }}
        >
          全部
        </button>
        {leafCategories.map((cat) => (
          <button
            key={cat.id}
            className={`mobile-category-tab${activeCategory === cat.name ? " active" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("category", cat.name);
              setSearchParams(next, { replace: true });
            }}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* 推荐轮播 / 横向滚动 */}
      {!activeCategory && !isLoading && recommendedVideos.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="mobile-page-header" style={{ marginBottom: 10 }}>
            <h2 className="mobile-page-title" style={{ fontSize: 16 }}>
              推荐
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              paddingBottom: 8,
              scrollbarWidth: "none",
            }}
          >
            {recommendedLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{
                      width: 110,
                      aspectRatio: "2/3",
                      borderRadius: 8,
                      flexShrink: 0,
                    }}
                  />
                ))
              : recommendedVideos.slice(0, 10).map((v) => (
                  <div key={videoKey(v)} style={{ width: 110, flexShrink: 0 }}>
                    <MobileVideoCard item={v} />
                  </div>
                ))}
          </div>
        </section>
      )}

      {/* 最新更新横向滚动 */}
      {!activeCategory && latestSection.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="mobile-page-header" style={{ marginBottom: 10 }}>
            <h2 className="mobile-page-title" style={{ fontSize: 16 }}>
              最新更新
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              paddingBottom: 8,
              scrollbarWidth: "none",
            }}
          >
            {latestSection.map((v) => (
              <div key={videoKey(v)} style={{ width: 110, flexShrink: 0 }}>
                <MobileVideoCard item={v} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 全部视频 */}
      <section>
        <div
          className="mobile-page-header"
          style={{ marginBottom: 10, justifyContent: "space-between" }}
        >
          <h2 className="mobile-page-title" style={{ fontSize: 16 }}>
            {activeCategory || "全部视频"}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={`mobile-category-tab${sort === "updated" ? " active" : ""}`}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("sort");
                setSearchParams(next, { replace: true });
              }}
            >
              更新
            </button>
            <button
              className={`mobile-category-tab${sort === "year" ? " active" : ""}`}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("sort", "year");
                setSearchParams(next, { replace: true });
              }}
            >
              年份
            </button>
          </div>
        </div>

        {isLoading && allSection.length === 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i}>
                <div
                  className="skeleton"
                  style={{ aspectRatio: "2/3", borderRadius: 8 }}
                />
                <div
                  className="skeleton"
                  style={{ height: 14, marginTop: 8, borderRadius: 4 }}
                />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !hasContent && (
          <div className="mobile-empty">
            {isSyncing && !activeCategory ? (
              <>
                <div className="spinner" style={{ width: 40, height: 40, marginBottom: 12 }} />
                <div className="mobile-empty-title">正在同步数据</div>
                <p>首次初始化预计需要 20-40 分钟，请稍候...</p>
              </>
            ) : (
              <>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <div className="mobile-empty-title">该条件下暂无更新</div>
              </>
            )}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
          }}
        >
          {allSection.map((v) => (
            <MobileVideoCard key={videoKey(v)} item={v} />
          ))}
        </div>
      </section>

      <div ref={sentinelRef} style={{ height: 1 }} />

      {isFetchingNextPage && (
        <div style={{ textAlign: "center", padding: 16 }}>
          <div className="spinner" style={{ width: 20, height: 20, display: "inline-block" }} />
          <span style={{ marginLeft: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            加载中...
          </span>
        </div>
      )}

      {(isCapped || !hasNextPage) && hasContent && (
        <div
          style={{
            textAlign: "center",
            padding: 24,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          {isCapped ? "— 已加载最大数量 —" : "— 已加载全部内容 —"}
        </div>
      )}
    </div>
  );
}
