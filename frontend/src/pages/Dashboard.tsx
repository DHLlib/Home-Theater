import { useEffect, useMemo, useRef, useState } from "react";
import { getCrawlerStats } from "../api/videos";
import type { CrawlerStatsResponse, HistoryPoint, SiteStat } from "../types";

const CACHE_KEY = "dashboard_stats_cache_v2";
const CACHE_TTL_MS = 60_000;

const CHART_COLORS = ["#f97316", "#14b8a6", "#3b82f6", "#f43f5e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981", "#6366f1", "#84cc16", "#d946ef"];

const C_ORANGE = "#f97316";
const C_TEAL = "#14b8a6";
const C_BLUE = "#3b82f6";
const C_AMBER = "#f59e0b";

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

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>();
  useEffect(() => {
    const startTime = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setValue(Math.round(target * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return value;
}

function formatNum(n: number) {
  return n.toLocaleString("zh-CN");
}

function formatAxis(v: number): string {
  if (v === 0) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  return (v / 1000).toFixed(0) + "k";
}

/* ---------- Skeleton ---------- */
function SkeletonCard() {
  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "24px 28px",
      minWidth: 200,
      flex: 1,
    }}>
      <div className="skeleton" style={{ width: 80, height: 12, marginBottom: 16, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 120, height: 40, marginBottom: 8, borderRadius: 6 }} />
      <div className="skeleton" style={{ width: 60, height: 12, borderRadius: 4 }} />
    </div>
  );
}
function SkeletonChart({ h = 260 }: { h?: number }) {
  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 20,
      height: h,
      flex: 1,
      minWidth: 280,
    }}>
      <div className="skeleton" style={{ width: 120, height: 14, marginBottom: 16, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: "100%", height: h - 60, borderRadius: 4 }} />
    </div>
  );
}

/* ---------- Metric Card ---------- */
function MetricCard({ icon, label, value, sub, color, delay = 0 }: {
  icon: string; label: string; value: number; sub: string; color: string; delay?: number;
}) {
  const animated = useCountUp(value);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), delay); return () => clearTimeout(t); }, [delay]);
  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "24px 28px",
      minWidth: 200,
      flex: 1,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(12px)",
      transition: "all 0.6s cubic-bezier(0.22,1,0.36,1)",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>{icon}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", letterSpacing: "0.05em" }}>{label}</span>
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
          {formatNum(animated)}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>{sub}</div>
      </div>
    </div>
  );
}

/* ---------- Chart Wrapper ---------- */
function ChartWrap({ title, children, delay = 0, style }: { title: string; children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), delay); return () => clearTimeout(t); }, [delay]);
  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 20,
      flex: 1,
      minWidth: 280,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(16px)",
      transition: "all 0.7s cubic-bezier(0.22,1,0.36,1)",
      ...style,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 16, letterSpacing: "0.03em", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: C_ORANGE }} />
        {title}
      </div>
      <div style={{ paddingTop: 8 }}>
        {children}
      </div>
    </div>
  );
}

/* ---------- Trend Line Chart ---------- */
function TrendChart({ history }: { history: HistoryPoint[] }) {
  const W = 900, H = 240, pad = { t: 4, r: 4, b: 32, l: 50 };
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
    const areaPts = `${pad.l},${pad.t + h} ` + ptsTotal + ` ${pad.l + (data.length - 1) * xStep},${pad.t + h}`;
    const labels = data.map((d, i) => ({
      x: pad.l + i * xStep,
      t: new Date(d.ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    }));
    const gridCount = 5;
    const grids = Array.from({ length: gridCount }, (_, i) => {
      const r = i / (gridCount - 1);
      return { y: pad.t + h * (1 - r), v: Math.round(maxV * r) };
    });
    return { totalPath: ptsTotal, detailPath: ptsDetail, areaPath: areaPts, xLabels: labels, gridYs: grids };
  }, [history, w, h, pad.l, pad.t]);

  if (history.length < 2) {
    return (
      <ChartWrap title="刮削趋势" delay={200}>
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: 13 }}>
          数据积累中，需至少两个历史快照
        </div>
      </ChartWrap>
    );
  }

  return (
    <ChartWrap title="刮削趋势" delay={200} style={{ minWidth: 360 }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 24, fontSize: 12, color: "var(--fg)", marginBottom: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C_ORANGE, flexShrink: 0 }} />
          <span>总刮削</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C_TEAL, flexShrink: 0 }} />
          <span>已补全</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C_ORANGE} stopOpacity="0.15" />
            <stop offset="100%" stopColor={C_ORANGE} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map((g, i) => (
          <g key={i}>
            <line x1={pad.l} y1={g.y} x2={pad.l + w} y2={g.y} stroke="var(--muted)" strokeWidth={0.5} strokeDasharray="4,4" />
            <text x={pad.l - 8} y={g.y + 4} textAnchor="end" fontSize={10} fill="var(--text-secondary)" fontFamily="monospace">{formatAxis(g.v)}</text>
          </g>
        ))}
        <polygon points={areaPath} fill="url(#areaGrad)" />
        <polyline points={totalPath} fill="none" stroke={C_ORANGE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={detailPath} fill="none" stroke={C_TEAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">{l.t}</text>
        ))}
      </svg>
    </ChartWrap>
  );
}

/* ---------- Donut Chart ---------- */
function DonutChart({ data, total }: { data: SiteStat[]; total: number }) {
  const size = 380, cx = size / 2, cy = size / 2, r = 154, innerR = 93;
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
      const seg = { name: it.name, pct: Math.round(pct * 100), color: CHART_COLORS[i % CHART_COLORS.length], dasharray: `${dash} ${gap}`, offset: -off };
      off += dash;
      return seg;
    });
  }, [data, total, circ]);
  return (
    <ChartWrap title="站点占比" delay={300}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
        <svg viewBox={`0 0 ${size} ${size}`} style={{ width: 380, height: 380, flexShrink: 0 }}>
          {segs.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={r - innerR} strokeDasharray={s.dasharray} strokeDashoffset={s.offset} transform={`rotate(-90 ${cx} ${cy})`} />
          ))}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize={28} fontWeight={700} fill="var(--fg)" fontFamily="monospace">{formatNum(total)}</text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize={12} fill="var(--text-secondary)">总资源</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
          {segs.slice(0, 8).map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, whiteSpace: "nowrap" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", width: 90 }} title={s.name}>{s.name}</span>
              <span style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </ChartWrap>
  );
}

/* ---------- Treemap Chart ---------- */
interface TreemapNode {
  x: number; y: number; w: number; h: number;
  name: string; count: number; color: string;
}

function buildTreemap(items: { name: string; count: number }[], W: number, H: number): TreemapNode[] {
  if (items.length === 0) return [];
  const total = items.reduce((s, i) => s + i.count, 0);
  const norm = items.map((it, idx) => ({ ...it, norm: it.count / total, idx }));
  const result: TreemapNode[] = [];

  function layout(nodes: typeof norm, x: number, y: number, w: number, h: number) {
    if (nodes.length === 0) return;
    if (nodes.length === 1) {
      const n = nodes[0];
      result.push({ x, y, w: Math.max(w, 1), h: Math.max(h, 1), name: n.name, count: n.count, color: CHART_COLORS[n.idx % CHART_COLORS.length] });
      return;
    }
    const sum = nodes.reduce((s, n) => s + n.norm, 0);
    let best = 1, bestDiff = Infinity, acc = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      acc += nodes[i].norm;
      const diff = Math.abs(acc / sum - (1 - acc / sum));
      if (diff < bestDiff) { bestDiff = diff; best = i + 1; }
    }
    const left = nodes.slice(0, best);
    const right = nodes.slice(best);
    const leftRatio = left.reduce((s, n) => s + n.norm, 0) / sum;
    if (w >= h) {
      const lw = w * leftRatio;
      layout(left, x, y, lw, h);
      layout(right, x + lw, y, w - lw, h);
    } else {
      const lh = h * leftRatio;
      layout(left, x, y, w, lh);
      layout(right, x, y + lh, w, h - lh);
    }
  }
  layout(norm, 0, 0, W, H);
  return result;
}

function TreemapChart({ data }: { data: SiteStat[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 400, h: 260 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setDims({ w: Math.max((rect.width - 8) * 0.92, 200), h: Math.max(rect.height * 0.92, 180) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.count - a.count);
    return buildTreemap(sorted.map((s) => ({ name: s.site_name, count: s.count })), dims.w, dims.h);
  }, [data, dims.w, dims.h]);

  return (
    <ChartWrap title="资源分布" delay={500}>
      <div ref={containerRef} style={{ height: 340, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: dims.w, height: dims.h, borderRadius: 6, overflow: "hidden" }}>
          {items.map((it, idx) => (
            <div
              key={idx}
              style={{
                position: "absolute",
                left: it.x,
                top: it.y,
                width: it.w,
                height: it.h,
                background: it.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: Math.min(it.w / 6, it.h / 3, 13),
                color: "#fff",
                fontWeight: 600,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                padding: "0 4px",
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
                opacity: 0.92,
              }}
              title={`${it.name}: ${formatNum(it.count)}`}
            >
              {it.w > 50 && it.h > 24 ? it.name : ""}
            </div>
          ))}
        </div>
      </div>
    </ChartWrap>
  );
}

/* ---------- Detail Table ---------- */
function DetailTable({ data, total }: { data: SiteStat[]; total: number }) {
  return (
    <ChartWrap title="站点明细" delay={700}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["站点", "资源占比", "已刮削", "未刮削", "已补全", "补全率"].map((h, i) => (
                <th key={i} style={{ padding: "10px 12px", textAlign: i >= 2 ? "right" : "left", color: "var(--text-secondary)", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((s) => {
              const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
              const rate = s.count > 0 ? Math.round((s.with_detail / s.count) * 100) : 0;
              return (
                <tr key={s.site_id} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.15s" }} onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--muted)"; }} onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}>
                  <td style={{ padding: "10px 12px", color: "var(--fg)", fontWeight: 500, whiteSpace: "nowrap" }}>{s.site_name}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--muted)", borderRadius: 3, overflow: "hidden", maxWidth: 100 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: rate >= 80 ? C_TEAL : rate >= 50 ? C_BLUE : C_AMBER, borderRadius: 3, transition: "width 0.6s ease-out" }} />
                      </div>
                      <span style={{ color: "var(--text-secondary)", fontSize: 10, fontFamily: "monospace", width: 28 }}>{pct}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--fg)", fontFamily: "monospace" }}>{formatNum(s.count)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-secondary)", fontFamily: "monospace" }}>{formatNum(s.without_detail)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C_TEAL, fontFamily: "monospace" }}>{formatNum(s.with_detail)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, fontFamily: "monospace", background: rate >= 80 ? `${C_TEAL}20` : rate >= 50 ? `${C_BLUE}20` : `${C_AMBER}20`, color: rate >= 80 ? C_TEAL : rate >= 50 ? C_BLUE : C_AMBER }}>{rate}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartWrap>
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
      getCrawlerStats().then(res => { setCrawlerStats(res); saveCache(res); }).catch(() => {});
    } else {
      setStatsLoading(true);
      getCrawlerStats().then(res => { setCrawlerStats(res); saveCache(res); }).catch(() => setCrawlerStats(null)).finally(() => setStatsLoading(false));
    }
  }, []);

  const sortedBySite = useMemo(() => {
    if (!crawlerStats) return [];
    return [...crawlerStats.by_site].sort((a, b) => b.count - a.count);
  }, [crawlerStats]);

  const siteCount = crawlerStats?.by_site.length ?? 0;
  const coverage = crawlerStats && crawlerStats.total > 0 ? Math.round((crawlerStats.with_detail / crawlerStats.total) * 100) : 0;
  const avgPerSite = siteCount > 0 && crawlerStats ? Math.round(crawlerStats.total / siteCount) : 0;

  return (
    <div style={{
      minHeight: "100vh",
      margin: "-16px",
      padding: "32px 24px 48px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--fg)", lineHeight: 1 }}>看板</h1>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>数据监控中心</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C_TEAL, boxShadow: `0 0 8px ${C_TEAL}`, animation: "pulse 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {crawlerStats?.computed_at ? `统计于 ${new Date(crawlerStats.computed_at).toLocaleString("zh-CN")}` : "加载中..."}
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      {statsLoading ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : crawlerStats ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <MetricCard icon="📦" label="总刮削" value={crawlerStats.total} sub={`${siteCount} 个站点`} color={C_ORANGE} delay={0} />
          <MetricCard icon="✅" label="已补全" value={crawlerStats.with_detail} sub={`覆盖率 ${coverage}%`} color={C_TEAL} delay={80} />
          <MetricCard icon="⏳" label="未刮削" value={crawlerStats.total - crawlerStats.with_detail} sub={`占比 ${100 - coverage}%`} color={C_AMBER} delay={160} />
          <MetricCard icon="📊" label="平均单站" value={avgPerSite} sub="平均水平" color={C_BLUE} delay={240} />
        </div>
      ) : null}

      {/* Charts Row 1 */}
      {statsLoading ? (
        <div style={{ marginBottom: 16 }}><SkeletonChart h={280} /></div>
      ) : crawlerStats && sortedBySite.length > 0 ? (
        <div style={{ marginBottom: 16 }}><TrendChart history={crawlerStats.history || []} /></div>
      ) : null}

      {/* Charts Row 2 */}
      {statsLoading ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <SkeletonChart h={340} /><SkeletonChart h={340} />
        </div>
      ) : crawlerStats && sortedBySite.length > 0 ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <DonutChart data={sortedBySite} total={crawlerStats.total} />
          <TreemapChart data={sortedBySite} />
        </div>
      ) : null}

      {/* Detail Table */}
      {statsLoading ? (
        <SkeletonChart h={400} />
      ) : crawlerStats && sortedBySite.length > 0 ? (
        <DetailTable data={sortedBySite} total={crawlerStats.total} />
      ) : null}

      {/* pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
