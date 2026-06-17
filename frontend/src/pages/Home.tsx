import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CategoryBar from "../components/CategoryBar";
import RecommendedCarousel from "../components/RecommendedCarousel";
import ScrollRow from "../components/ScrollRow";
import VideoCard from "../components/VideoCard";
import VirtualGrid from "../components/VirtualGrid";
import MobileSearchBar from "../components/MobileSearchBar";
import { useIsMobile } from "../hooks/useViewport";
import {
  useSitesQuery,
  useRecommendedVideosQuery,
  useCrawlerStatusQuery,
  useVideosInfinite,
} from "../hooks/useVideos";
import type { AggregatedVideo } from "../types";

function videoKey(item: AggregatedVideo): string {
  return `${item.title}-${item.year ?? "null"}`;
}

function getLatestUpdatedAt(item: AggregatedVideo): string | null {
  let latest: string | null = null;
  for (const s of item.sources) {
    if (s.updated_at) {
      if (!latest || s.updated_at > latest) {
        latest = s.updated_at;
      }
    }
  }
  return latest;
}

function compareByYearDescNullLast(a: AggregatedVideo, b: AggregatedVideo): number {
  const ya = a.year ?? -Infinity;
  const yb = b.year ?? -Infinity;
  if (ya !== yb) return yb - ya;
  const ta = getLatestUpdatedAt(a) || "";
  const tb = getLatestUpdatedAt(b) || "";
  return tb.localeCompare(ta);
}

/* ===== 主页面 ===== */

export default function Home() {
  const [showBackTop, setShowBackTop] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const wdFromUrl = searchParams.get("wd") || "";
  const activeCategory = searchParams.get("category") || null;
  const sort = searchParams.get("sort") === "year" ? "year" : "updated";

  const { data: sites = [] } = useSitesQuery();
  const { data: recommendedVideos = [], isLoading: recommendedLoading } =
    useRecommendedVideosQuery();
  const { data: crawlerStatus } = useCrawlerStatusQuery();
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isCapped,
  } = useVideosInfinite({ category: activeCategory, wd: wdFromUrl, sort });

  const videos = useMemo(() => {
    return data?.pages.flat() ?? [];
  }, [data]);

  const latestSection = useMemo(() => {
    const sorted = [...videos].sort((a, b) => {
      const ta = getLatestUpdatedAt(a);
      const tb = getLatestUpdatedAt(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });
    return sorted.slice(0, 12);
  }, [videos]);

  const allSection = useMemo(() => {
    const featured = new Set(latestSection.map((v) => videoKey(v)));
    const list = [...videos].filter((v) => !featured.has(videoKey(v)));
    if (sort === "year") {
      list.sort(compareByYearDescNullLast);
    } else {
      list.sort((a, b) => {
        const ta = getLatestUpdatedAt(a);
        const tb = getLatestUpdatedAt(b);
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return tb.localeCompare(ta);
      });
    }
    return list;
  }, [videos, latestSection, sort]);

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
    const statuses = Object.values(crawlerStatus?.site_status || {});
    const isSyncing = statuses.some(
      (s) => s === "full_crawling" || s === "incremental_running"
    );
    if (wasSyncingRef.current && !isSyncing && videos.length === 0) {
      refetch();
    }
    wasSyncingRef.current = isSyncing;
  }, [crawlerStatus, videos.length, refetch]);

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
    return (
      <div className="empty">
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
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          暂无采集站
        </h2>
        <p style={{ marginBottom: 20, color: "var(--text-secondary)" }}>
          添加采集站后即可浏览聚合后的视频内容。采集站是提供影视资源的外部站点，支持 AppleCMS 接口规范。
        </p>
        <button
          className="btn btn-primary"
          onClick={() => navigate("/settings")}
          style={{ minHeight: 44, padding: "10px 24px" }}
        >
          去设置
        </button>
      </div>
    );
  }

  const hasContent =
    recommendedVideos.length > 0 ||
    latestSection.length > 0 ||
    allSection.length > 0;

  const isSyncing = Object.values(crawlerStatus?.site_status || {}).some(
    (s) => s === "full_crawling" || s === "incremental_running"
  );

  return (
    <div>
      {/* ===== 移动端顶部搜索栏 + 分类 ===== */}
      {isMobile && <MobileSearchBar />}

      {isMobile && (
        <CategoryBar
          sites={sites}
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
      )}

      {/* ===== 加载骨架屏 ===== */}
      {isLoading && (
        <div className="grid" style={{ marginTop: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div
                className="skeleton"
                style={{ aspectRatio: "2/3", borderRadius: 4 }}
              />
              <div
                className="skeleton"
                style={{
                  height: 16,
                  marginTop: 10,
                  width: "80%",
                  borderRadius: 4,
                }}
              />
              <div
                className="skeleton"
                style={{
                  height: 12,
                  marginTop: 6,
                  width: "40%",
                  borderRadius: 4,
                }}
              />
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

      {/* ===== 首页模式：三区域 ===== */}
      {!isLoading && !wdFromUrl.trim() && (
        <>
          {/* 推荐视频轮播 */}
          {!activeCategory && (
            <RecommendedCarousel
              videos={recommendedVideos}
              loading={recommendedLoading}
              onSelect={(v) => {
                const params = new URLSearchParams();
                params.set("title", v.title);
                if (v.year != null) params.set("year", String(v.year));
                params.set("sources", JSON.stringify(v.sources));
                navigate(`/detail?${params.toString()}`, { state: v });
              }}
            />
          )}

          {!hasContent && (
            <div className="empty" style={{ padding: 40 }}>
              {isSyncing && !activeCategory ? (
                <>
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
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          <>
            {/* 区域一：最新更新 */}
            {latestSection.length > 0 && (
              <ScrollRow title="最新更新" titleColor="var(--primary)">
                {latestSection.map((v) => (
                  <div key={videoKey(v)} style={{ width: 160 }}>
                    <VideoCard item={v} width={160} />
                  </div>
                ))}
              </ScrollRow>
            )}

            {/* 区域二：全部视频 */}
            <section style={{ marginBottom: 24 }}>
              <div className="section-title">
                <span
                  className="section-title-bar"
                  style={{ background: "var(--text-secondary)" }}
                />
                全部视频
                <div style={{ flex: 1 }} />
                <div className="sort-toggle-group">
                  <button
                    className={`sort-toggle${
                      sort === "updated" ? " active" : ""
                    }`}
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.delete("sort");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    按更新时间
                  </button>
                  <button
                    className={`sort-toggle${
                      sort === "year" ? " active" : ""
                    }`}
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set("sort", "year");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    按年份
                  </button>
                </div>
              </div>
              {allSection.length === 0 && !isFetchingNextPage && (
                <div className="empty" style={{ padding: 20 }}>
                  <p>该条件下暂无更新</p>
                </div>
              )}
              <VirtualGrid
                items={allSection}
                itemKey={videoKey}
                renderItem={(v) => <VideoCard item={v} />}
                minItemWidth={160}
                gap={24}
                overscan={3}
              />
            </section>
          </>
        </>
      )}

      {/* 无限滚动 sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {isFetchingNextPage && (
        <div
          className="row"
          style={{ justifyContent: "center", padding: 20, gap: 8 }}
        >
          <div
            className="spinner"
            style={{ width: 20, height: 20, borderWidth: 2 }}
          />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
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
          {isCapped ? "— 已加载最大数量，请刷新或切换分类 —" : "— 已加载全部内容 —"}
        </div>
      )}

      {showBackTop && (
        <button
          className="btn"
          aria-label="返回顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          style={{
            position: "fixed",
            right: 20,
            bottom: 24,
            zIndex: 100,
            width: 44,
            height: 44,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--glass-bg)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--glass-border)",
            padding: 0,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
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
