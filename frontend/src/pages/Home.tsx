import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import CategoryBar from "../components/CategoryBar";
import HomeCategorySections from "../components/HomeCategorySections";
import { listSystemCategories } from "../api/system-categories";
import VideoCard from "../components/VideoCard";
import VirtualGrid from "../components/VirtualGrid";
import MobileSearchBar from "../components/MobileSearchBar";
import { useIsMobile } from "../hooks/useViewport";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import {
  useSitesQuery,
  useCrawlerStatusQuery,
  useVideosInfinite,
} from "../hooks/useVideos";
import { useHomeSections } from "../hooks/useHomeSections";
import type { AggregatedVideo } from "../types";
import "./Home.css";

function videoKey(item: AggregatedVideo): string {
  // 优先用聚合行 id：标题+年份在重复行存在时会让虚拟列表 key 冲突，
  // 表现为同一张卡片重复出现、并留下空位
  return item.id != null ? `v-${item.id}` : `${item.title}-${item.year ?? "null"}`;
}

/* ===== 主页面 ===== */

export default function Home() {
  const [showBackTop, setShowBackTop] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const wdFromUrl = searchParams.get("wd") || "";
  const activeCategory = searchParams.get("category") || null;
  const sort = searchParams.get("sort") === "year" ? "year" : "updated";
  const isDefaultView = !wdFromUrl.trim() && !activeCategory;

  const { data: sites = [], isLoading: sitesLoading } = useSitesQuery();
  const {
    data: homeSectionsData,
    isLoading: homeSectionsLoading,
    isError: homeSectionsError,
    refetch: refetchHomeSections,
  } = useHomeSections(isDefaultView);
  const homeSections = homeSectionsData?.sections ?? [];
  const [categoriesTree, setCategoriesTree] = useState<
    Awaited<ReturnType<typeof listSystemCategories>>
  >([]);
  useEffect(() => {
    if (!isDefaultView) return;
    let cancelled = false;
    listSystemCategories()
      .then((items) => {
        if (!cancelled) setCategoriesTree(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isDefaultView]);
  const { data: crawlerStatus } = useCrawlerStatusQuery();
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isCapped,
    pagesRestored,
  } = useVideosInfinite(
    { category: activeCategory, wd: wdFromUrl, sort },
    { enabled: !isDefaultView }
  );

  const videos = useMemo(() => {
    return data?.pages.flat() ?? [];
  }, [data]);

  const mobileGridMinWidth = isMobile ? 130 : 190;

  // 稳定的 renderItem 引用，避免每次渲染重建所有 VideoCard 使其 React.memo 失效
  const renderGridItem = useCallback(
    (v: AggregatedVideo) => <VideoCard item={v} />,
    []
  );

  const handleViewAll = useCallback(
    (category: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("category", category);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleSectionsRetry = useCallback(() => {
    void refetchHomeSections();
  }, [refetchHomeSections]);

  const isSyncing = Object.values(crawlerStatus?.site_status || {}).some(
    (s) => s === "full_crawling" || s === "incremental_running"
  );

  // F5/浏览器刷新后恢复滚动位置：等虚拟列表把内容高度撑起来再滚，
  // 否则浏览器的默认恢复会被夹到顶部
  useScrollRestoration(
    `home:${location.pathname}${location.search}`,
    sites.length > 0 &&
      (isDefaultView
        ? !homeSectionsLoading
        : !isLoading && pagesRestored)
  );

  // 返回顶部按钮显隐
  useEffect(() => {
    const onScroll = () => {
      setShowBackTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 刮削完成后自动刷新（从 syncing 变为 idle）
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    const hasNoContent = isDefaultView
      ? homeSections.length === 0
      : videos.length === 0;
    if (wasSyncingRef.current && !isSyncing && hasNoContent) {
      if (isDefaultView) {
        void refetchHomeSections();
      } else {
        void refetch();
      }
    }
    wasSyncingRef.current = isSyncing;
  }, [
    crawlerStatus,
    homeSections.length,
    isDefaultView,
    isSyncing,
    videos.length,
    refetch,
    refetchHomeSections,
  ]);

  // 无限滚动：监听 sentinel
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
      if (!isCappedRef.current) {
        fetchNextPageRef.current();
      }
    };

    // 若 sentinel 已在视口+rootMargin 范围内（常见于首屏内容不足一屏时），
    // 立即触发加载，避免 IntersectionObserver 因无交叉事件而漏掉。
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

  if (sites.length === 0) {
    // 站点还在加载时不要谎报「暂无采集站」
    if (sitesLoading) {
      return (
        <div className="home-loading" aria-busy="true" aria-label="正在加载">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="home-loading-item">
              <div className="skeleton home-loading-poster" />
              <div className="skeleton home-loading-title" />
              <div className="skeleton home-loading-meta" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="empty home-empty">
        <svg
          className="empty-icon"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <path d="M14 10l-2.5 2.5L9 10" />
        </svg>
        <h2 className="home-empty-title">暂无采集站</h2>
        <p className="home-empty-text">
          添加采集站后即可浏览聚合后的视频内容。采集站是提供影视资源的外部站点，支持 AppleCMS 接口规范。
        </p>
        <button
          className="btn btn-primary"
          onClick={() => navigate("/settings")}
        >
          去设置
        </button>
      </div>
    );
  }

  const hasContent = videos.length > 0;
  const showInitialSync =
    isDefaultView &&
    isSyncing &&
    !homeSectionsLoading &&
    !homeSectionsError &&
    homeSections.length === 0 &&
    categoriesTree.length === 0;

  return (
    <div>
      <h1 className="visually-hidden">HOME THEATER 片库</h1>

      {/* ===== 移动端顶部搜索栏 + 分类 ===== */}
      {isMobile && <MobileSearchBar />}

      {!isDefaultView && (
        <div className="home-cats">
          <CategoryBar
            activeCategory={activeCategory}
            onSelect={(cat) => {
              const next = new URLSearchParams(searchParams);
              if (cat) {
                next.set("category", cat);
              } else {
                next.delete("category");
              }
              setSearchParams(next, { replace: true });
            }}
          />
        </div>
      )}

      {/* ===== 加载骨架屏 ===== */}
      {!isDefaultView && isLoading && (
        <div className="home-loading">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="home-loading-item">
              <div className="skeleton home-loading-poster" />
              <div className="skeleton home-loading-title" />
              <div className="skeleton home-loading-meta" />
            </div>
          ))}
        </div>
      )}

      {/* ===== 搜索模式 ===== */}
      {!isLoading && wdFromUrl.trim() && (
        <>
          {videos.length === 0 && (
            <div className="empty" style={{ padding: 40 }}>
              <svg
                className="empty-icon"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p>未找到相关视频</p>
              <button
                className="btn"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setSearchParams({});
                }}
              >
                清除搜索
              </button>
            </div>
          )}
          <div className="grid">
            {videos.map((v) => (
              <VideoCard key={videoKey(v)} item={v} />
            ))}
          </div>
        </>
      )}

      {/* ===== 默认分类分区 ===== */}
      {isDefaultView &&
        (showInitialSync ? (
          <div className="empty" style={{ padding: 40 }}>
            <div
              className="spinner"
              style={{
                width: 48,
                height: 48,
                margin: "0 auto 16px",
                borderWidth: 3,
              }}
            />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              正在同步数据
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              首次初始化预计需要 20-40 分钟，请稍候...
            </p>
          </div>
        ) : (
          <HomeCategorySections
            sections={homeSections}
            categories={categoriesTree}
            isLoading={homeSectionsLoading}
            isError={homeSectionsError}
            onRetry={handleSectionsRetry}
            onViewAll={handleViewAll}
            renderItem={renderGridItem}
          />
        ))}

      {/* ===== 分类筛选模式 ===== */}
      {!isLoading && !isDefaultView && !wdFromUrl.trim() && (
        <>
          {!hasContent && (
            <div className="empty" style={{ padding: 40 }}>
              <svg
                className="empty-icon"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p>该条件下暂无更新</p>
            </div>
          )}

          {/* 全部视频 */}
          <section className="home-section">
            <div className="home-section-head">
              <h2 className="home-section-title">全部视频</h2>
              <div className="sort-toggle-group" role="group" aria-label="排序方式">
                <button
                  className={`sort-toggle${sort === "updated" ? " active" : ""}`}
                  aria-pressed={sort === "updated"}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("sort");
                    setSearchParams(next, { replace: true });
                  }}
                >
                  最近更新
                </button>
                <button
                  className={`sort-toggle${sort === "year" ? " active" : ""}`}
                  aria-pressed={sort === "year"}
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
            {videos.length === 0 && !isFetchingNextPage && (
              <div className="empty" style={{ padding: 20 }}>
                <p>该条件下暂无更新</p>
              </div>
            )}
            <VirtualGrid
              items={videos}
              itemKey={videoKey}
              renderItem={renderGridItem}
              minItemWidth={mobileGridMinWidth}
              gap={isMobile ? 12 : 24}
              overscan={isMobile ? 2 : 3}
            />
          </section>
        </>
      )}

      {/* 无限滚动 sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {isFetchingNextPage && (
        <div className="home-load-more">
          <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            加载中...
          </span>
        </div>
      )}

      {(isCapped || !hasNextPage) && hasContent && (
        <div className="home-end-text">
          {isCapped ? "— 已加载最大数量，请刷新或切换分类 —" : "— 已加载全部内容 —"}
        </div>
      )}

      {showBackTop && (
        <button
          className={`btn home-back-top ${isMobile ? 'mobile' : ''}`}
          aria-label="返回顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      )}
    </div>
  );
}
