import { useEffect, useMemo, useRef, useState } from "react";
import { getCrawlerStats } from "../api/videos";
import type { CrawlerStatsResponse, HistoryPoint, SiteStat } from "../types";

const CACHE_KEY = "dashboard_stats_cache_v3";
const CACHE_TTL_MS = 60_000;

/* ---------- Utils ---------- */
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
  } catch {}
}

function fmt(n: number) {
  return n.toLocaleString("zh-CN");
}
function fmtPct(v: number): string {
  return `${v.toFixed(2)}%`;
}
function fmtAxis(v: number): string {
  if (v === 0) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  return (v / 1000).toFixed(0) + "k";
}

/* ---------- Skeleton ---------- */
function SkeletonBar({ w, h = 12 }: { w: number | string; h?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: 4 }} />;
}

/* ---------- KPI Cards ---------- */
function KpiCards({ stats }: { stats: CrawlerStatsResponse }) {
  const cards = [
    { label: "总已收录数", value: stats.total, color: "var(--primary)" },
    { label: "总已补全数", value: stats.with_detail, color: "var(--text-secondary)" },
    { label: "总未补全", value: stats.without_detail, color: "var(--danger)" },
    { label: "已聚合数", value: stats.aggregated_count, color: "var(--warning)" },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
        marginBottom: 24,
      }}
      className="dashboard-kpi-grid"
    >
      {cards.map((c, i) => (
        <div
          key={i}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--glass-border)",
            borderTop: `3px solid ${c.color}`,
            borderRadius: 10,
            padding: "16px 14px",
            boxShadow: "0 10px 24px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(255, 255, 255, 0.03)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, textAlign: "center" }}>
            {c.label}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "var(--text-primary)",
              fontFamily: "monospace",
              lineHeight: 1,
              textAlign: "center",
            }}
          >
            {fmt(c.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
        padding: "16px 14px",
        boxShadow: "0 10px 24px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(255, 255, 255, 0.03)",
      }}
    >
      <SkeletonBar w={60} h={12} />
      <div style={{ marginTop: 12 }}><SkeletonBar w="80%" h={28} /></div>
    </div>
  );
}

/* ---------- Trend Chart ---------- */
function TrendChart({ history }: { history: HistoryPoint[] }) {
  const W = 1200, H = 240;
  const pad = { t: 8, r: 8, b: 32, l: 56 };
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b;

  const { totalPath, detailPath, areaPath, xLabels, gridYs } = useMemo(() => {
    if (history.length < 2) return { totalPath: "", detailPath: "", areaPath: "", xLabels: [] as { x: number; t: string }[], gridYs: [] as { y: number; v: number }[] };
    const deduped: HistoryPoint[] = [];
    const seen = new Set<string>();
    for (let i = history.length - 1; i >= 0; i--) {
      const d = new Date(history[i].ts);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!seen.has(k)) { seen.add(k); deduped.unshift(history[i]); }
    }
    // 排除今天，取最近 7 天
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const data = deduped
      .filter(d => {
        const dk = new Date(d.ts);
        return `${dk.getFullYear()}-${dk.getMonth()}-${dk.getDate()}` !== todayKey;
      })
      .slice(-7);
    if (data.length < 2) return { totalPath: "", detailPath: "", areaPath: "", xLabels: [] as { x: number; t: string }[], gridYs: [] as { y: number; v: number }[] };
    const maxV = Math.max(...data.map(d => d.total), 1) * 1.08;
    const xStep = w / (data.length - 1 || 1);
    const yScale = (v: number) => h - (v / maxV) * h;
    const ptsTotal = data.map((d, i) => `${pad.l + i * xStep},${pad.t + yScale(d.total)}`).join(" ");
    const ptsDetail = data.map((d, i) => `${pad.l + i * xStep},${pad.t + yScale(d.with_detail)}`).join(" ");
    const areaPts = `${pad.l},${pad.t + h} ${ptsTotal} ${pad.l + (data.length - 1) * xStep},${pad.t + h}`;

    // 7 天全显示
    const labels = data.map((d, i) => ({
      x: pad.l + i * xStep,
      t: new Date(d.ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    }));

    const grids = Array.from({ length: 5 }, (_, i) => {
      const r = i / 4;
      return { y: pad.t + h * (1 - r), v: Math.round(maxV * r) };
    });
    return { totalPath: ptsTotal, detailPath: ptsDetail, areaPath: areaPts, xLabels: labels, gridYs: grids };
  }, [history, w, h, pad.l, pad.t]);

  if (history.length < 2) {
    return (
      <div style={{ padding: "20px 0", borderBottom: "1px solid var(--glass-border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, letterSpacing: "0.03em" }}>刮削趋势</div>
        <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: 13 }}>
          数据积累中，需至少两个历史快照
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 0", borderBottom: "1px solid var(--glass-border)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, letterSpacing: "0.03em" }}>刮削趋势</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 20, fontSize: 12, marginBottom: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />
          总已收录数
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text-secondary)", flexShrink: 0 }} />
          总已补全数
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map((g, i) => (
          <g key={i}>
            <line x1={pad.l} y1={g.y} x2={pad.l + w} y2={g.y} stroke="var(--glass-border)" strokeWidth={0.5} strokeDasharray="4,4" />
            <text x={pad.l - 8} y={g.y + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)" fontFamily="monospace">{fmtAxis(g.v)}</text>
          </g>
        ))}
        <polygon points={areaPath} fill="url(#areaGrad)" />
        <polyline points={totalPath} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={detailPath} fill="none" stroke="var(--text-secondary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{l.t}</text>
        ))}
      </svg>
    </div>
  );
}

/* ---------- Header with tooltip ---------- */
function HeaderWithTip({ label, tip }: { label: string; tip: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLSpanElement>(null);

  const handleEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }
    setShow(true);
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {label}
      <span
        ref={iconRef}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1px solid var(--text-muted)",
          color: "var(--text-muted)",
          fontSize: 9,
          cursor: "help",
          flexShrink: 0,
        }}
      >?</span>
      {show && (
        <div
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: "translate(-50%, -100%)",
            background: "var(--surface)",
            border: "1px solid var(--glass-border)",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 11,
            fontWeight: 400,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}

/* ---------- Site Table ---------- */
function SiteTable({ data, total }: { data: SiteStat[]; total: number }) {
  return (
    <div style={{ padding: "20px 0" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, letterSpacing: "0.03em" }}>站点明细</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--glass-border)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-primary)", fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>站点</th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>已收录</th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>已补全</th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>未补全</th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                <HeaderWithTip label="补全率" tip="已补全 / 已收录 × 100%" />
              </th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                <HeaderWithTip label="资源占比" tip="已收录 / 总已收录 × 100%" />
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => {
              const completionRate = s.count > 0 ? (s.with_detail / s.count) * 100 : 0;
              const share = total > 0 ? (s.count / total) * 100 : 0;
              const color = completionRate >= 80 ? "var(--primary)" : completionRate >= 50 ? "var(--text-secondary)" : "var(--danger)";
              return (
                <tr key={s.site_id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                  <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap" }}>{s.site_name}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontFamily: "monospace" }}>{fmt(s.count)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--primary)", fontFamily: "monospace" }}>{fmt(s.with_detail)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--danger)", fontFamily: "monospace" }}>{fmt(s.without_detail)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, fontFamily: "monospace", color }}>{fmtPct(completionRate)}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontFamily: "monospace" }}>{fmtPct(share)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Main Page ---------- */
export default function Dashboard() {
  const [stats, setStats] = useState<CrawlerStatsResponse | null>(() => loadCache());
  const [loading, setLoading] = useState(!loadCache());

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setStats(cached);
      setLoading(false);
      getCrawlerStats().then(res => { setStats(res); saveCache(res); }).catch(() => {});
    } else {
      setLoading(true);
      getCrawlerStats().then(res => { setStats(res); saveCache(res); }).catch(() => setStats(null)).finally(() => setLoading(false));
    }
  }, []);

  const sortedBySite = useMemo(() => {
    if (!stats) return [];
    return [...stats.by_site].sort((a, b) => b.count - a.count);
  }, [stats]);

  return (
    <div style={{ minHeight: "100vh", margin: "-16px", padding: "32px 24px 48px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>数据看板</h1>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          {stats?.computed_at ? `统计于 ${new Date(stats.computed_at).toLocaleString("zh-CN")}` : "加载中..."}
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
      ) : stats ? (
        <KpiCards stats={stats} />
      ) : null}

      {/* Trend */}
      {loading ? (
        <div style={{ marginBottom: 16 }}>
          <SkeletonBar w={120} h={14} />
          <div style={{ height: 200, marginTop: 16 }}><SkeletonBar w="100%" h={200} /></div>
        </div>
      ) : stats && sortedBySite.length > 0 ? (
        <div style={{ marginBottom: 16 }}><TrendChart history={stats.history || []} /></div>
      ) : null}

      {/* Site Table */}
      {loading ? (
        <div style={{ marginBottom: 16 }}>
          <SkeletonBar w={120} h={14} />
          <div style={{ height: 260, marginTop: 16 }}><SkeletonBar w="100%" h={260} /></div>
        </div>
      ) : stats && sortedBySite.length > 0 ? (
        <div style={{ marginBottom: 16 }}><SiteTable data={sortedBySite} total={stats.total} /></div>
      ) : null}
    </div>
  );
}
