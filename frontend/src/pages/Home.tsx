import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listSites } from "../api/sites";
import { listVideos, searchVideos } from "../api/videos";
import CategoryBar from "../components/CategoryBar";
import FailedSourcesPanel from "../components/FailedSourcesPanel";
import VideoCard from "../components/VideoCard";
import {
  getCachedAggregated,
  setCachedAggregated,
} from "../utils/cache";
import type { AggregatedVideo, Site, FailedSource } from "../types";

type ViewMode = "aggregated" | "source";
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

function getEarliestUpdatedAt(item: AggregatedVideo): string | null {
  let earliest: string | null = null;
  for (const s of item.sources) {
    if (s.updated_at) {
      if (!earliest || s.updated_at < earliest) {
        earliest = s.updated_at;
      }
    }
  }
  return earliest;
}

/* ===== 子组件 ===== */

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
  const [failed, setFailed] = useState<FailedSource[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("aggregated");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 读取搜索词
  const wdFromUrl = searchParams.get("wd") || "";

  // 计算聚合模式三区域
  const latestSection = useMemo(() => {
    if (viewMode !== "aggregated") return [];
    const sorted = [...videos].sort((a, b) => {
      const ta = getEarliestUpdatedAt(a);
      const tb = getEarliestUpdatedAt(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });
    return sorted.slice(0, 12);
  }, [videos, viewMode]);

  const hotSection = useMemo(() => {
    if (viewMode !== "aggregated") return [];
    const featured = new Set(latestSection.map((v) => videoKey(v)));
    const sorted = [...videos]
      .filter((v) => !featured.has(videoKey(v)))
      .sort((a, b) => b.sources.length - a.sources.length);
    return sorted.slice(0, 12);
  }, [videos, viewMode, latestSection]);

  const allSection = useMemo(() => {
    if (viewMode !== "aggregated") return [];
    const featured = new Set([
      ...latestSection.map((v) => videoKey(v)),
      ...hotSection.map((v) => videoKey(v)),
    ]);
    return videos.filter((v) => !featured.has(videoKey(v)));
  }, [videos, viewMode, latestSection, hotSection]);

  // 源站模式分组
  const sourceGroups = useMemo(() => {
    if (viewMode !== "source") return {};
    const groups: Record<number, { siteName: string; items: AggregatedVideo[] }> =
      {};
    for (const item of videos) {
      const source = item.sources[0];
      if (!source) continue;
      if (!groups[source.site_id]) {
        const site = sites.find((s) => s.id === source.site_id);
        groups[source.site_id] = {
          siteName: site?.name || `站点 ${source.site_id}`,
          items: [],
        };
      }
      groups[source.site_id].items.push(item);
    }
    return groups;
  }, [videos, viewMode, sites]);

  // 加载数据（先读缓存，再调 API 刷新）
  const loadPage = useCallback(
    async (pg: number, append: boolean) => {
      const q = wdFromUrl.trim();
      const cacheParams = {
        category: activeCategory,
        timeFilter,
        viewMode,
        page: pg,
        wd: q,
      };

      // 第 1 页：先读缓存立即渲染，减少白屏
      if (pg === 1 && !append) {
        const cached = await getCachedAggregated<{
          items: AggregatedVideo[];
          failed_sources: FailedSource[];
        }>(cacheParams);
        if (cached) {
          setVideos(cached.items);
          setFailed(cached.failed_sources);
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
        mode: viewMode,
      };
      if (timeFilter !== "all") params.h = timeFilter;
      if (activeCategory) params.category = activeCategory;

      try {
        let r;
        if (q) {
          const searchParams: {
            wd: string;
            pg: number;
            mode: string;
            category?: string;
          } = {
            wd: q,
            pg,
            mode: viewMode,
          };
          if (activeCategory) searchParams.category = activeCategory;
          r = await searchVideos(searchParams);
        } else {
          r = await listVideos(params);
        }
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
        setFailed(r.failed_sources);
        if (r.items.length === 0) {
          setNoMore(true);
        }
        // 写入缓存
        setCachedAggregated(cacheParams, {
          items: r.items,
          failed_sources: r.failed_sources,
        });
      } catch {
        if (pg === 1) {
          setVideos([]);
          setFailed([]);
        }
        setNoMore(true);
      } finally {
        if (pg === 1) {
          setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [timeFilter, activeCategory, viewMode, wdFromUrl]
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

  // 初始加载站点列表
  useEffect(() => {
    listSites().then((s) => {
      setSites(s);
    });
  }, []);

  // 筛选条件变化时重置加载
  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;
  useEffect(() => {
    if (sites.length > 0) {
      loadInitialRef.current();
    }
  }, [activeCategory, timeFilter, viewMode, sites.length, wdFromUrl]);

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
    viewMode === "aggregated"
      ? latestSection.length > 0 ||
        hotSection.length > 0 ||
        allSection.length > 0
      : Object.keys(sourceGroups).length > 0;

  return (
    <div>
      <FailedSourcesPanel failed={failed} onChange={() => loadInitial()} />

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
        {/* 视图模式切换 */}
        <div
          className="row"
          style={{
            gap: 0,
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          {(
            [
              { key: "aggregated" as ViewMode, label: "聚合" },
              { key: "source" as ViewMode, label: "源站" },
            ] as const
          ).map((m, idx, arr) => (
            <button
              key={m.key}
              className="btn"
              style={{
                borderRadius: 0,
                border: "none",
                borderRight: idx < arr.length - 1 ? "1px solid var(--border)" : "none",
                background: viewMode === m.key ? "var(--primary)" : undefined,
                color: viewMode === m.key ? "var(--primary-fg)" : undefined,
                fontSize: 13,
                padding: "6px 16px",
                minHeight: 36,
              }}
              onClick={() => setViewMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* 时间筛选 */}
        <div
          className="row"
          style={{
            gap: 0,
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          {TIME_OPTIONS.map((t, idx, arr) => (
            <button
              key={t.key}
              className="btn"
              style={{
                borderRadius: 0,
                border: "none",
                borderRight: idx < arr.length - 1 ? "1px solid var(--border)" : "none",
                background: timeFilter === t.key ? "var(--primary)" : undefined,
                color: timeFilter === t.key ? "var(--primary-fg)" : undefined,
                fontSize: 13,
                padding: "6px 14px",
                minHeight: 36,
              }}
              onClick={() => setTimeFilter(t.key)}
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

          {viewMode === "aggregated" && (
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
          )}

          {viewMode === "source" && (
            <>
              {Object.entries(sourceGroups).map(([siteId, group]) => (
                <section key={siteId} style={{ marginBottom: 24 }}>
                  <div className="section-title">
                    <span
                      className="section-title-bar"
                      style={{ background: "var(--primary)" }}
                    />
                    {group.siteName}
                  </div>
                  <div className="grid">
                    {group.items.map((v) => (
                      <VideoCard key={videoKey(v)} item={v} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
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
    </div>
  );
}
