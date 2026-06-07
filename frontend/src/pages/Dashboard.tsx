import { useEffect, useMemo, useState } from "react";
import { getCrawlerStats } from "../api/videos";
import type { CrawlerStatsResponse, SiteStat } from "../types";

const CACHE_KEY = "dashboard_stats_cache";
const CACHE_TTL_MS = 60_000; // 60 秒缓存

function loadCache(): CrawlerStatsResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(data: CrawlerStatsResponse) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // ignore
  }
}

/* ---------- Skeleton ---------- */

function SkeletonCard() {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 280,
        background: "var(--card)",
        borderRadius: 16,
        padding: "24px 28px",
        border: "1px solid var(--border)",
      }}
    >
      <div className="skeleton" style={{ width: 80, height: 14, marginBottom: 12, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 120, height: 36, marginBottom: 10, borderRadius: 6 }} />
      <div className="skeleton" style={{ width: 60, height: 14, marginBottom: 6, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 140, height: 12, borderRadius: 4 }} />
    </div>
  );
}

function SkeletonBarRow() {
  return (
    <div className="row" style={{ padding: "10px 20px", alignItems: "center", gap: 8 }}>
      <div className="skeleton" style={{ width: 100, height: 14, flexShrink: 0, borderRadius: 4 }} />
      <div className="skeleton" style={{ flex: 1, height: 16, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 58, height: 14, flexShrink: 0, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 58, height: 14, flexShrink: 0, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 58, height: 14, flexShrink: 0, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 52, height: 14, flexShrink: 0, borderRadius: 4 }} />
    </div>
  );
}

/* ---------- Stat Card ---------- */

function StatCard({
  icon,
  label,
  value,
  tag,
  desc,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  tag: string;
  desc: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 240,
        background: "var(--card)",
        borderRadius: 16,
        padding: "24px 28px",
        border: "1px solid var(--border)",
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      <div
        style={{
          marginTop: 10,
          display: "inline-block",
          padding: "3px 10px",
          background: "var(--muted)",
          borderRadius: 10,
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        {tag}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>{desc}</div>
    </div>
  );
}

/* ---------- Bar Chart ---------- */

function BarChart({ data, total }: { data: SiteStat[]; total: number }) {

  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 12,
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* 表头 */}
      <div
        className="row"
        style={{
          padding: "12px 20px",
          background: "var(--muted)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-secondary)",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ width: 100, flexShrink: 0 }}>站点</div>
        <div style={{ flex: 1 }}>资源占比</div>
        <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>已刮削</div>
        <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>未刮削</div>
        <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>已补全</div>
        <div style={{ width: 52, textAlign: "right", flexShrink: 0 }}>补全率</div>
      </div>

      {data.map((s, i) => {
        const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
        const completeRate = s.count > 0 ? Math.round((s.with_detail / s.count) * 100) : 0;
        return (
          <div
            key={s.site_id}
            className="row"
            style={{
              padding: "10px 20px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "var(--muted)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
          >
            {/* 站点名 */}
            <div
              style={{
                width: 100,
                flexShrink: 0,
                fontWeight: 500,
                color: "var(--fg)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={s.site_name}
            >
              {s.site_name}
            </div>

            {/* 柱状图 */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  background: "var(--muted)",
                  borderRadius: 5,
                  overflow: "hidden",
                  maxWidth: 240,
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: completeRate >= 80
                      ? "linear-gradient(90deg, #22c55e, #4ade80)"
                      : completeRate >= 50
                        ? "linear-gradient(90deg, #3b82f6, #60a5fa)"
                        : "linear-gradient(90deg, #f59e0b, #fbbf24)",
                    borderRadius: 5,
                    transition: "width 0.6s ease-out",
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", width: 36, flexShrink: 0 }}>
                {pct}%
              </span>
            </div>

            {/* 已刮削 */}
            <div
              style={{
                width: 58,
                textAlign: "right",
                flexShrink: 0,
                fontWeight: 600,
                color: "var(--fg)",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
              }}
            >
              {s.count.toLocaleString("zh-CN")}
            </div>

            {/* 未刮削 */}
            <div
              style={{
                width: 58,
                textAlign: "right",
                flexShrink: 0,
                fontWeight: 600,
                color: "var(--text-secondary)",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
              }}
            >
              {s.without_detail.toLocaleString("zh-CN")}
            </div>

            {/* 已补全 */}
            <div
              style={{
                width: 58,
                textAlign: "right",
                flexShrink: 0,
                fontWeight: 600,
                color: "#22c55e",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
              }}
            >
              {s.with_detail.toLocaleString("zh-CN")}
            </div>

            {/* 补全率标签 */}
            <div style={{ width: 52, textAlign: "right", flexShrink: 0 }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  background:
                    completeRate >= 80
                      ? "color-mix(in srgb, #22c55e 12%, transparent)"
                      : completeRate >= 50
                        ? "color-mix(in srgb, #3b82f6 12%, transparent)"
                        : "color-mix(in srgb, #f59e0b 12%, transparent)",
                  color: completeRate >= 80 ? "#22c55e" : completeRate >= 50 ? "#3b82f6" : "#f59e0b",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {completeRate}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function Dashboard() {
  const [crawlerStats, setCrawlerStats] = useState<CrawlerStatsResponse | null>(() => loadCache());
  const [statsLoading, setStatsLoading] = useState(!loadCache());

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setCrawlerStats(cached);
      setStatsLoading(false);
      // 后台静默刷新
      getCrawlerStats()
        .then((res) => {
          setCrawlerStats(res);
          saveCache(res);
        })
        .catch(() => {});
    } else {
      setStatsLoading(true);
      getCrawlerStats()
        .then((res) => {
          setCrawlerStats(res);
          saveCache(res);
        })
        .catch(() => setCrawlerStats(null))
        .finally(() => setStatsLoading(false));
    }
  }, []);

  // 按数量降序排列
  const sortedBySite = useMemo(() => {
    if (!crawlerStats) return [];
    return [...crawlerStats.by_site].sort((a, b) => b.count - a.count);
  }, [crawlerStats]);

  return (
    <div className="col" style={{ gap: 16, padding: "16px 0" }}>
      {/* 页面标题 */}
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 20 }}>📊</span>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>看板</h2>
        {crawlerStats?.last_updated_at && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-secondary)" }}>
            最近更新 {new Date(crawlerStats.last_updated_at).toLocaleString("zh-CN")}
          </span>
        )}
      </div>

      {/* 汇总卡片 */}
      {statsLoading ? (
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : crawlerStats ? (
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <StatCard
            icon="📦"
            label="总刮削数量"
            value={crawlerStats.total.toLocaleString("zh-CN")}
            tag="累计资源"
            desc="所有站点已刮削资源总数"
            color="var(--primary)"
          />
          <StatCard
            icon="✅"
            label="已补全详情"
            value={crawlerStats.with_detail.toLocaleString("zh-CN")}
            tag="完整元数据"
            desc={`覆盖率 ${crawlerStats.total > 0 ? Math.round((crawlerStats.with_detail / crawlerStats.total) * 100) : 0}%`}
            color="#22c55e"
          />
        </div>
      ) : null}

      {/* 站点柱状图标题 */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--fg)" }}>
          📈 站点资源分布
        </h3>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          共 {crawlerStats?.by_site.length ?? 0} 个站点
        </span>
      </div>

      {/* 柱状图 */}
      {statsLoading ? (
        <div
          style={{
            background: "var(--card)",
            borderRadius: 12,
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div
            className="row"
            style={{
              padding: "12px 20px",
              background: "var(--muted)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ width: 100, flexShrink: 0 }}>站点</div>
            <div style={{ flex: 1 }}>资源占比</div>
            <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>已刮削</div>
            <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>未刮削</div>
            <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>已补全</div>
            <div style={{ width: 52, textAlign: "right", flexShrink: 0 }}>补全率</div>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBarRow key={i} />
          ))}
        </div>
      ) : crawlerStats && sortedBySite.length > 0 ? (
        <BarChart data={sortedBySite} total={crawlerStats?.total ?? 0} />
      ) : null}
    </div>
  );
}
