import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listSites } from "../api/sites";
import { listVideos, searchVideos, getCrawlerStatus } from "../api/videos";
import CategoryBar from "../components/CategoryBar";
import VideoCard from "../components/VideoCard";
import MobileSearchBar from "../components/MobileSearchBar";
import { useIsMobile } from "../hooks/useViewport";
import {
  getCachedAggregated,
  setCachedAggregated,
} from "../utils/cache";
import type { AggregatedVideo, Site } from "../types";

type TimeFilter = "all" | 24 | 72 | 168;

const TIME_OPTIONS: { key: TimeFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: 24, label: "24h" },
  { key: 72, label: "72h" },
  { key: 168, label: "7天" },
];

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

/* ===== 子组件 ===== */

function HeroSection({
  video,
  onClick,
}: {
  video: AggregatedVideo;
  onClick: () => void;
}) {
  const poster = video.poster_url || "";
  return (
    <div
      className="hero-section"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${video.title}${video.year ? ` (${video.year})` : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      {/* 背景画报 */}
      <div
        className="hero-bg"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: poster ? `url(${poster})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          filter: "brightness(0.4)",
        }}
      />
      {/* 底部渐变：融入黑色 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, var(--bg) 0%, transparent 60%), linear-gradient(to right, var(--bg) 0%, transparent 50%)",
        }}
      />
      {/* 内容层 */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "0 24px 80px",
          zIndex: 2,
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.15em",
            color: "var(--primary)",
            textTransform: "uppercase",
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          最新推荐
        </div>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(36px, 6vw, 60px)",
            fontWeight: 700,
            lineHeight: 1.1,
            color: "var(--text-primary)",
            marginBottom: 12,
            maxWidth: 700,
            textWrap: "balance",
          }}
        >
          {video.title}
        </h1>
        {video.year && (
          <div
            style={{
              fontSize: 16,
              color: "var(--text-secondary)",
              marginBottom: 20,
              fontWeight: 300,
            }}
          >
            {video.year}
          </div>
        )}
        <div className="row" style={{ gap: 12 }}>
          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onClick(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            立即观看
          </button>
        </div>
      </div>
    </div>
  );
}

function ChevronLeftIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ScrollRow({
  title,
  titleColor,
  children,
}: {
  title: string;
  titleColor: string;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <div className="scroll-row-wrap">
      <div className="section-title">
        <span className="section-title-bar" style={{ background: titleColor }} />
        {title}
      </div>
      <button
        className="scroll-arrow left"
        onClick={() => scroll("left")}
        aria-label={`向左滚动 ${title}`}
      >
        <ChevronLeftIcon />
      </button>
      <div ref={scrollRef} className="scroll-row">
        {children}
      </div>
      <button
        className="scroll-arrow right"
        onClick={() => scroll("right")}
        aria-label={`向右滚动 ${title}`}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/* ===== 主页面 ===== */

export default function Home() {
  const [sites, setSites] = useState<Site[]>([]);
  const [videos, setVideos] = useState<AggregatedVideo[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [crawlerStatus, setCrawlerStatus] = useState<{ running: boolean; site_status: Record<string, string> } | null>(null);
  const [showBackTop, setShowBackTop] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  // 从 URL 读取搜索词
  const wdFromUrl = searchParams.get("wd") || "";

  // 计算聚合模式三区域
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

  const hotSection = useMemo(() => {
    const featured = new Set(latestSection.map((v) => videoKey(v)));
    const sorted = [...videos]
      .filter((v) => !featured.has(videoKey(v)))
      .sort((a, b) => b.sources.length - a.sources.length);
    return sorted.slice(0, 12);
  }, [videos, latestSection]);

  const allSection = useMemo(() => {
    const featured = new Set([
      ...latestSection.map((v) => videoKey(v)),
      ...hotSection.map((v) => videoKey(v)),
    ]);
    return [...videos]
      .filter((v) => !featured.has(videoKey(v)))
      .sort((a, b) => {
        const ta = getLatestUpdatedAt(a);
        const tb = getLatestUpdatedAt(b);
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return tb.localeCompare(ta);
      });
  }, [videos, latestSection, hotSection]);

  // 加载数据（先读缓存，再调 API 刷新）
  const loadPage = useCallback(
    async (pg: number, append: boolean) => {
      const q = wdFromUrl.trim();
      const cacheParams = {
        category: activeCategory,
        timeFilter,
        viewMode: "aggregated",
        page: pg,
        wd: q,
      };

      // 第 1 页：先读缓存立即渲染，减少白屏
      if (pg === 1 && !append) {
        const cached = await getCachedAggregated<{
          items: AggregatedVideo[];
        }>(cacheParams);
        if (cached) {
          setVideos(cached.items);
          // 有缓存时先结束 loading，让 UI 立即可交互
          setLoading(false);
        }
      }

      if (pg === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const params: Record<string, string | number> = {
        pg,
        mode: "aggregated",
      };
      if (timeFilter !== "all") params.h = timeFilter;
      if (activeCategory) params.category = activeCategory;

      let cacheResult: { items: AggregatedVideo[] } | undefined;
      try {
        const r = q
          ? await searchVideos({
              wd: q,
              pg,
              mode: "aggregated",
              ...(activeCategory ? { category: activeCategory } : {}),
            })
          : await listVideos(params);
        cacheResult = r;
        if (pg === 1) {
          setVideos(r.items);
        } else {
          setVideos((prev) => {
            const map = new Map<string, AggregatedVideo>();
            for (const v of prev) map.set(videoKey(v), v);
            for (const v of r.items) map.set(videoKey(v), v);
            return Array.from(map.values());
          });
        }
        if (r.items.length === 0) {
          setNoMore(true);
        }
      } catch {
        if (pg === 1) {
          setVideos([]);
        }
        setNoMore(true);
      } finally {
        if (pg === 1) {
          setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }

      // fire-and-forget：缓存写入不阻塞 UI 状态更新
      if (cacheResult) {
        setCachedAggregated(cacheParams, { items: cacheResult.items }).catch(
          () => {}
        );
      }
    },
    [timeFilter, activeCategory, wdFromUrl]
  );

  const loadInitial = useCallback(() => {
    setPage(1);
    setNoMore(false);
    loadPage(1, false);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || noMore || loading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadPage(nextPage, true);
  }, [loadingMore, noMore, loading, page, loadPage]);

  // 返回顶部按钮显隐
  useEffect(() => {
    const onScroll = () => {
      setShowBackTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 初始加载站点列表
  useEffect(() => {
    listSites().then((s) => {
      setSites(s);
    });
  }, []);

  // 定期检查刮削状态
  useEffect(() => {
    const check = () => {
      getCrawlerStatus().then(setCrawlerStatus).catch(() => {});
    };
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  // 刮削完成后自动刷新（从 syncing 变为 idle）
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    const statuses = Object.values(crawlerStatus?.site_status || {});
    const isSyncing = statuses.some((s) => s === "full_crawling" || s === "incremental_running");
    if (wasSyncingRef.current && !isSyncing && videos.length === 0) {
      loadInitialRef.current();
    }
    wasSyncingRef.current = isSyncing;
  }, [crawlerStatus, videos.length]);

  // 筛选条件变化时重置加载
  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;
  useEffect(() => {
    if (sites.length > 0) {
      loadInitialRef.current();
    }
  }, [activeCategory, timeFilter, sites.length, wdFromUrl]);

  // 无限滚动：监听 sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || noMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreRef.current();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [noMore, loading, videos.length]);

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
          请先去「设置」页添加资源站点。
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
    latestSection.length > 0 ||
    hotSection.length > 0 ||
    allSection.length > 0;

  const isSyncing = Object.values(crawlerStatus?.site_status || {}).some(
    (s) => s === "full_crawling" || s === "incremental_running"
  );

  return (
    <div>
      {/* ===== 移动端顶部搜索栏 ===== */}
      {isMobile && <MobileSearchBar />}

      {/* ===== 工具栏：紧凑排列 ===== */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {/* 时间筛选 */}
        <div className="row" style={{ gap: 0 }}>
          {TIME_OPTIONS.map((t) => (
            <button
              key={t.key}
              className="nav-link"
              onClick={() => setTimeFilter(t.key)}
              style={{
                color:
                  timeFilter === t.key
                    ? "var(--text-primary)"
                    : undefined,
                borderBottom:
                  timeFilter === t.key
                    ? "2px solid var(--primary)"
                    : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <CategoryBar
        sites={sites}
        activeCategory={activeCategory}
        onSelect={(cat) => setActiveCategory(cat)}
      />

      {/* ===== 加载骨架屏 ===== */}
      {loading && (
        <div className="grid" style={{ marginTop: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div
                className="skeleton"
                style={{ aspectRatio: "2/3", borderRadius: 8 }}
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
      {!loading && wdFromUrl.trim() && (
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
      {!loading && !wdFromUrl.trim() && (
        <>
          {/* Hero 首屏画报 */}
          {!activeCategory && latestSection.length > 0 && (
            <HeroSection
              video={latestSection[0]}
              onClick={() => {
                const v = latestSection[0];
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

            {/* 区域二：热门视频 */}
            {hotSection.length > 0 && (
              <ScrollRow title="热门视频" titleColor="var(--warning)">
                {hotSection.map((v) => (
                  <div key={videoKey(v)} style={{ width: 160 }}>
                    <VideoCard item={v} width={160} />
                  </div>
                ))}
              </ScrollRow>
            )}

            {/* 区域三：全部视频 */}
            <section style={{ marginBottom: 24 }}>
              <div className="section-title">
                <span
                  className="section-title-bar"
                  style={{ background: "var(--text-secondary)" }}
                />
                全部视频
              </div>
              {allSection.length === 0 && !loadingMore && (
                <div className="empty" style={{ padding: 20 }}>
                  <p>该条件下暂无更新</p>
                </div>
              )}
              <div className="grid">
                {allSection.map((v) => (
                  <VideoCard key={videoKey(v)} item={v} />
                ))}
              </div>
            </section>
          </>
        </>
      )}

      {/* 无限滚动 sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {loadingMore && (
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

      {noMore && hasContent && (
        <div
          style={{
            textAlign: "center",
            padding: 24,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          — 已加载全部内容 —
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
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
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
