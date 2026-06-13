import { useEffect, useMemo, useState } from "react";
import { getCrawlerStats } from "../api/videos";
import type { CrawlerStatsResponse, HistoryPoint, SiteStat } from "../types";

const CACHE_KEY = "dashboard_stats_cache_v3";
const CACHE_TTL_MS = 60_000;

const PALETTE = [
  "var(--primary)",
  "var(--text-secondary)",
  "var(--danger)",
  "rgba(74, 222, 128, 0.5)",
  "rgba(163, 163, 163, 0.5)",
  "rgba(251, 113, 133, 0.5)",
];

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
    const data = deduped.slice(-30);
    const maxV = Math.max(...data.map(d => d.total), 1) * 1.08;
    const xStep = w / (data.length - 1 || 1);
    const yScale = (v: number) => h - (v / maxV) * h;
    const ptsTotal = data.map((d, i) => `${pad.l + i * xStep},${pad.t + yScale(d.total)}`).join(" ");
    const ptsDetail = data.map((d, i) => `${pad.l + i * xStep},${pad.t + yScale(d.with_detail)}`).join(" ");
    const areaPts = `${pad.l},${pad.t + h} ${ptsTotal} ${pad.l + (data.length - 1) * xStep},${pad.t + h}`;

    // 控制 X 轴标签密度，避免重叠：最多显示 8 个
    const maxLabels = 8;
    const labelStep = Math.max(1, Math.floor((data.length - 1) / maxLabels));
    const labels = data
      .map((d, i) => ({
        x: pad.l + i * xStep,
        t: new Date(d.ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
        show: i === 0 || i === data.length - 1 || i % labelStep === 0,
      }))
      .filter(l => l.show);

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

/* ---------- Donut Chart ---------- */
function DonutChart({ data, total }: { data: SiteStat[]; total: number }) {
  const size = 320, cx = size / 2, cy = size / 2, r = 130, innerR = 78;
  const circ = 2 * Math.PI * r;
  const segs = useMemo(() => {
    if (total === 0) return [];
    const sorted = [...data].sort((a, b) => b.count - a.count);
    const threshold = total * 0.015;
    const big = sorted.filter(s => s.count >= threshold);
    const smallCount = sorted.filter(s => s.count < threshold).reduce((s, x) => s + x.count, 0);
    const items = big.map(s => ({ name: s.site_name, value: s.count }));
    if (smallCount > 0) items.push({ name: "其他", value: smallCount });
    let off = 0;
    return items.map((it, i) => {
      const pct = it.value / total;
      const dash = pct * circ;
      const gap = circ - dash;
      const seg = { name: it.name, pct: Math.round(pct * 100), color: PALETTE[i % PALETTE.length], dasharray: `${dash} ${gap}`, offset: -off };
      off += dash;
      return seg;
    });
  }, [data, total, circ]);

  return (
    <div style={{ padding: "20px 0", borderBottom: "1px solid var(--glass-border)", flex: 1, minWidth: 280 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, letterSpacing: "0.03em" }}>站点占比</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
        <svg viewBox={`0 0 ${size} ${size}`} style={{ width: 260, height: 260, flexShrink: 0 }}>
          {segs.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={r - innerR} strokeDasharray={s.dasharray} strokeDashoffset={s.offset} transform={`rotate(-90 ${cx} ${cy})`} />
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={24} fontWeight={700} fill="var(--text-primary)" fontFamily="monospace">{fmt(total)}</text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">总已收录</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          {segs.slice(0, 8).map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, whiteSpace: "nowrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", width: 80 }} title={s.name}>{s.name}</span>
              <span style={{ color: "var(--text-muted)", fontFamily: "monospace" }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Site Table ---------- */
function SiteTable({ data }: { data: SiteStat[] }) {
  return (
    <div style={{ padding: "20px 0" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, letterSpacing: "0.03em" }}>站点明细</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--glass-border)" }}>
              {["站点", "资源数", "补全率"].map((h, i) => (
                <th key={i} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "right", color: "var(--text-muted)", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((s) => {
              const rate = s.count > 0 ? Math.round((s.with_detail / s.count) * 100) : 0;
              const color = rate >= 80 ? "var(--primary)" : rate >= 50 ? "var(--text-secondary)" : "var(--danger)";
              return (
                <tr key={s.site_id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                  <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap" }}>{s.site_name}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontFamily: "monospace" }}>{fmt(s.count)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, fontFamily: "monospace", color }}>{rate}%</span>
                  </td>
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

      {/* Donut + Table */}
      {loading ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 280 }}><SkeletonBar w={120} h={14} /><div style={{ height: 260, marginTop: 16 }}><SkeletonBar w="100%" h={260} /></div></div>
          <div style={{ flex: 1, minWidth: 280 }}><SkeletonBar w={120} h={14} /><div style={{ height: 260, marginTop: 16 }}><SkeletonBar w="100%" h={260} /></div></div>
        </div>
      ) : stats && sortedBySite.length > 0 ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <DonutChart data={sortedBySite} total={stats.total} />
          <SiteTable data={sortedBySite} />
        </div>
      ) : null}
    </div>
  );
}
