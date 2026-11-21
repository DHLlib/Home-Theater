import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import MobileVideoCard from "../components/MobileVideoCard";
import HomeCategorySections from "../../components/HomeCategorySections";
import { SearchIcon } from "../../components/icons";
import { listSystemCategories } from "../../api/system-categories";
import { useHomeSections } from "../../hooks/useHomeSections";
import {
  useCrawlerStatusQuery,
  useSitesQuery,
  useVideosInfinite,
} from "../../hooks/useVideos";

function videoKey(item: { id?: number | null; title: string; year?: number | null }): string {
  return item.id != null ? `v-${item.id}` : `${item.title}-${item.year ?? "null"}`;
}

export default function MobileHome() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeCategory = searchParams.get("category") || null;
  const sort = searchParams.get("sort") === "year" ? "year" : "updated";

  const { data: sites = [] } = useSitesQuery();
  const { data: crawlerStatus } = useCrawlerStatusQuery();
  const { data: categoriesTree = [] } = useQuery({
    queryKey: ["systemCategories"],
    queryFn: listSystemCategories,
  });
  const {
    data: homeSectionsData,
    isLoading: homeSectionsLoading,
    isError: homeSectionsError,
    refetch: refetchHomeSections,
  } = useHomeSections(!activeCategory);
  const homeSections = homeSectionsData?.sections ?? [];
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isCapped,
  } = useVideosInfinite(
    { category: activeCategory, wd: "", sort },
    { enabled: Boolean(activeCategory) }
  );

  const videos = useMemo(() => data?.pages.flat() ?? [], [data]);

  const parentCategories = useMemo(
    () =>
      categoriesTree.filter(
        (c) => c.enabled !== false && (c.children?.length ?? 0) > 0
      ),
    [categoriesTree]
  );

  const activeParent = useMemo(
    () =>
      parentCategories.find(
        (p) =>
          p.name === activeCategory ||
          p.children.some((c) => c.name === activeCategory)
      ) ?? null,
    [parentCategories, activeCategory]
  );

  const setCategory = (name: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (name) {
      next.set("category", name);
    } else {
      next.delete("category");
    }
    setSearchParams(next, { replace: true });
  };

  const allSection = videos;

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
    if (wasSyncingRef.current && !syncing) {
      if (activeCategory && videos.length === 0) {
        refetch();
      } else if (!activeCategory && homeSections.length === 0) {
        refetchHomeSections();
      }
    }
    wasSyncingRef.current = syncing;
  }, [
    activeCategory,
    crawlerStatus,
    homeSections.length,
    refetch,
    refetchHomeSections,
    videos.length,
  ]);

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

  const hasContent = activeCategory
    ? allSection.length > 0
    : homeSections.some((section) => section.items.length > 0);

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
    <div className="mobile-page mobile-home">
      <header className="mobile-home-head">
        <div className="mobile-home-brand">HOME THEATER</div>
        <button
          type="button"
          className="mobile-home-search"
          onClick={() => navigate("/search")}
        >
          <SearchIcon size={15} />
          <span>搜索片名、演员、年份</span>
        </button>
      </header>

      {activeCategory && (
        <div className="mobile-category-tabs">
          <button
            className="mobile-category-tab"
            onClick={() => setCategory(null)}
          >
            全部
          </button>
          {parentCategories.map((cat) => (
            <button
              key={cat.id}
              className={`mobile-category-tab${
                activeCategory === cat.name || activeParent?.id === cat.id
                  ? " active"
                  : ""
              }`}
              onClick={() => setCategory(cat.name)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {activeParent && activeParent.children.length > 0 && (
        <div className="mobile-category-tabs mobile-category-subtabs">
          {activeParent.children
            .filter((c) => c.enabled !== false)
            .map((child) => (
              <button
                key={child.id}
                className={`mobile-category-tab${
                  activeCategory === child.name ? " active" : ""
                }`}
                onClick={() => setCategory(child.name)}
              >
                {child.name}
              </button>
            ))}
        </div>
      )}

      {!activeCategory ? (
        isSyncing && !homeSectionsLoading && !homeSectionsError && !hasContent ? (
          <div className="mobile-empty">
            <div className="spinner" style={{ width: 40, height: 40, marginBottom: 12 }} />
            <div className="mobile-empty-title">正在同步数据</div>
            <p>首次初始化预计需要 20-40 分钟，请稍候...</p>
          </div>
        ) : (
          <HomeCategorySections
            sections={homeSections}
            isLoading={homeSectionsLoading}
            isError={homeSectionsError}
            onRetry={() => refetchHomeSections()}
            onViewAll={setCategory}
            renderItem={(item) => <MobileVideoCard item={item} />}
          />
        )
      ) : (
        <section>
          <div
            className="mobile-page-header"
            style={{ marginBottom: 10, justifyContent: "space-between" }}
          >
            <h2 className="mobile-page-title" style={{ fontSize: 16 }}>
              {activeCategory}
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
            <div className="mobile-poster-grid">
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
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <div className="mobile-empty-title">该条件下暂无更新</div>
            </div>
          )}

          <div className="mobile-poster-grid">
            {allSection.map((v) => (
              <MobileVideoCard key={videoKey(v)} item={v} />
            ))}
          </div>
        </section>
      )}

      {activeCategory && <div ref={sentinelRef} style={{ height: 1 }} />}

      {activeCategory && isFetchingNextPage && (
        <div style={{ textAlign: "center", padding: 16 }}>
          <div className="spinner" style={{ width: 20, height: 20, display: "inline-block" }} />
          <span style={{ marginLeft: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            加载中...
          </span>
        </div>
      )}

      {activeCategory && (isCapped || !hasNextPage) && hasContent && (
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
