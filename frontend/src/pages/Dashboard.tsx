import { useEffect, useMemo, useRef, useState } from "react";
import { getCrawlerStats } from "../api/videos";
import { toast, toastError, toastSuccess } from "../utils/toast";
import {
  findActiveJob,
  isJobActive,
  useMaintenance,
} from "../hooks/useMaintenance";
import type {
  CrawlerStatsResponse,
  FillSiteState,
  FillStatus,
  HistoryPoint,
  MaintenanceJob,
  SiteStat,
} from "../types";
import "./Dashboard.css";

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

/* ---------- 补全任务状态 ---------- */

/** 旧补全快照的无时区 ISO 也是 UTC；新快照显式带 Z。 */
function toDate(v: number | string | null): Date | null {
  if (v == null) return null;
  const isNaiveIso = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v);
  const d = typeof v === "number"
    ? new Date(v > 1e12 ? v : v * 1000)
    : new Date(isNaiveIso ? `${v}Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtTime(v: number | string | null): string {
  return toDate(v)?.toLocaleString("zh-CN") ?? "";
}

/** 把秒数写成「12 分钟 / 1 小时 20 分」（与 Settings 的 formatDuration 一致） */
function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

const FILL_SITE_STATE_LABEL: Record<FillSiteState, string> = {
  pending: "等待",
  running: "进行中",
  done: "完成",
  partial: "部分完成",
  blocked: "受阻",
  failed: "失败",
};

const FILL_SITE_STATE_TONE: Record<FillSiteState, "ok" | "warn" | "bad" | "muted"> = {
  pending: "muted",
  running: "ok",
  done: "ok",
  partial: "warn",
  blocked: "warn",
  failed: "bad",
};

/** 失败原因：顶层 error 为空时（旧状态/异常状态）从第一个带错误的站点兜底 */
export function fillFailureReason(status: FillStatus): string {
  if (status.error) return status.error;
  const site = status.sites.find((s) => s.error);
  return site ? `${site.site_name}：${site.error}` : "未知错误";
}

/* ---------- 补全进度面板（数据来自最新 detail.fill 任务的 details.fill） ---------- */
function FillProgressPanel({ job }: { job: MaintenanceJob }) {
  const status = job.details?.fill as FillStatus | undefined;
  const active = isJobActive(job);

  // details.fill 还没写入时（刚排队），先给通用进度
  if (!status) {
    const percent =
      job.progress_total > 0
        ? Math.min(100, Math.round((job.progress_completed / job.progress_total) * 100))
        : 0;
    return (
      <section className="fill-progress" aria-live="polite">
        <div className="fill-progress-head">
          <span className="fill-progress-title">
            {active ? "正在补全 videolist" : "上次补全结果"}
          </span>
          <span
            className={`fill-progress-chip ${
              active ? "is-ok" : job.state === "cancelled" ? "is-warn" : "is-bad"
            }`}
          >
            {active ? "进行中" : job.state === "cancelled" ? "已取消" : "已结束"}
          </span>
        </div>
        <div className="fill-progress-body">
          <div className="fill-progress-track">
            <i style={{ width: `${percent}%` }} />
          </div>
          <div className="fill-progress-meta">
            <b>{percent}%</b>
            {job.progress_total > 0 && (
              <span>
                站点 {job.progress_completed} / {job.progress_total}
              </span>
            )}
          </div>
        </div>
        {job.error && (
          <div className="fill-progress-summary is-bad">{job.error}</div>
        )}
      </section>
    );
  }

  // 取消/中断是任务级状态：details.fill 里的旧状态不代表终态语义
  const effectiveState = job.state === "cancelled" ? "cancelled" : status.state;
  const running = active && status.state === "running";
  const percent =
    status.total_sites > 0
      ? Math.min(100, Math.round((status.completed_sites / status.total_sites) * 100))
      : 0;
  const startedAt = toDate(status.started_at);
  const elapsedSeconds = startedAt
    ? Math.max(0, (Date.now() - startedAt.getTime()) / 1000)
    : null;

  const summary = (() => {
    switch (effectiveState) {
      case "done":
        return `补全完成：补齐 ${fmt(status.filled)} 条，跳过 ${fmt(status.skipped)} 条`;
      case "partial":
        return `部分完成：补齐 ${fmt(status.filled)} 条，失败 ${fmt(status.failed)} 条——有站点受阻或未跑完，可稍后重试`;
      case "failed":
        return `补全失败：${fillFailureReason(status)}`;
      case "interrupted":
        return `补全任务被中断（后端重启），已补 ${fmt(status.filled)} 条，可重新发起`;
      case "cancelled":
        return `补全任务已取消，已补 ${fmt(status.filled)} 条，可重新发起`;
      default:
        return "";
    }
  })();

  const chipClass = (() => {
    switch (effectiveState) {
      case "done":
        return "is-ok";
      case "partial":
      case "interrupted":
      case "cancelled":
        return "is-warn";
      default:
        return "is-bad";
    }
  })();

  const chipLabel = (() => {
    switch (effectiveState) {
      case "done":
        return "完成";
      case "partial":
        return "部分完成";
      case "interrupted":
        return "已中断";
      case "cancelled":
        return "已取消";
      default:
        return "失败";
    }
  })();

  return (
    <section className="fill-progress" aria-live="polite">
      <div className="fill-progress-head">
        <span className="fill-progress-title">
          {running ? "正在补全 videolist" : "上次补全结果"}
        </span>
        {running && (
          <span className="fill-progress-chip is-ok">进行中</span>
        )}
        {!running && effectiveState !== "idle" && (
          <span className={`fill-progress-chip ${chipClass}`}>{chipLabel}</span>
        )}
      </div>

      <div className="fill-progress-body">
        <div className="fill-progress-track">
          <i style={{ width: `${percent}%` }} />
        </div>
        <div className="fill-progress-meta">
          <b>{percent}%</b>
          <span>
            站点 {status.completed_sites} / {status.total_sites || "…"}
          </span>
          {running && status.current_site_name && (
            <span className="fill-progress-site">
              正在补全 {status.current_site_name}
            </span>
          )}
          <span>已补 {fmt(status.filled)}</span>
          {status.failed > 0 && (
            <span className="is-danger">失败 {fmt(status.failed)}</span>
          )}
          {status.skipped > 0 && <span>跳过 {fmt(status.skipped)}</span>}
          {running && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span>已运行 {fmtDuration(elapsedSeconds)}</span>
          )}
          {!running && status.finished_at != null && (
            <span>结束于 {fmtTime(status.finished_at)}</span>
          )}
        </div>
      </div>

      {summary && (
        <div
          className={`fill-progress-summary ${
            effectiveState === "done"
              ? "is-ok"
              : effectiveState === "partial" ||
                  effectiveState === "interrupted" ||
                  effectiveState === "cancelled"
                ? "is-warn"
                : "is-bad"
          }`}
        >
          {summary}
        </div>
      )}

      {status.sites.length > 0 && (
        <ul className="fill-site-list">
          {status.sites.map((s) => (
            <li key={s.site_id} className="fill-site-row">
              <span className="fill-site-name">{s.site_name}</span>
              <span
                className={`fill-progress-chip is-${FILL_SITE_STATE_TONE[s.state]}`}
              >
                {FILL_SITE_STATE_LABEL[s.state]}
              </span>
              <span className="fill-site-nums">
                缺 {fmt(s.missing)} · 补 {fmt(s.filled)}
                {s.failed > 0 && ` · 失败 ${fmt(s.failed)}`}
                {s.skipped > 0 && ` · 跳过 ${fmt(s.skipped)}`}
              </span>
              {s.error && <span className="fill-site-error">{s.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Skeleton ---------- */
function SkeletonBar({ w, h = 12 }: { w: number | string; h?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: 4 }} />;
}

/* ---------- 统计条（一条，不抢图表与表格的戏） ---------- */
function StatStrip({ stats }: { stats: CrawlerStatsResponse }) {
  const cells = [
    { label: "已收录", value: stats.total },
    { label: "已补全", value: stats.with_detail },
    { label: "未补全", value: stats.without_detail, tone: "danger" as const },
    { label: "已聚合", value: stats.aggregated_count },
  ];

  return (
    <div className="stat-strip">
      {cells.map((c) => (
        <div className="stat-cell" key={c.label}>
          <span className="stat-label">{c.label}</span>
          <span className={`stat-value tnum${c.tone ? " is-danger" : ""}`}>
            {fmt(c.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatStripSkeleton() {
  return (
    <div className="stat-strip">
      {[0, 1, 2, 3].map((i) => (
        <div className="stat-cell" key={i}>
          <SkeletonBar w={48} h={11} />
          <div style={{ marginTop: 8 }}>
            <SkeletonBar w={72} h={24} />
          </div>
        </div>
      ))}
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
function SiteTable({
  data,
  total,
  onFill,
  fillActive,
}: {
  data: SiteStat[];
  total: number;
  onFill?: (siteId: number) => void;
  /** 有补全任务在跑时，全站与单站入口都禁用（后端一次只跑一个任务） */
  fillActive?: boolean;
}) {
  return (
    <div className="site-table-section">
      <div className="site-table-title">站点明细</div>
      <div className="site-table-wrapper">
        <table className="site-table">
          <thead>
            <tr>
              <th>站点</th>
              <th style={{ textAlign: "right" }}>已收录</th>
              <th style={{ textAlign: "right" }}>已补全</th>
              <th style={{ textAlign: "right" }}>未补全</th>
              <th style={{ textAlign: "right" }}>
                <HeaderWithTip label="补全率" tip="已补全 / 已收录 × 100%" />
              </th>
              <th style={{ textAlign: "right" }}>
                <HeaderWithTip label="资源占比" tip="已收录 / 总已收录 × 100%" />
              </th>
              <th style={{ textAlign: "center" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => {
              const completionRate = s.count > 0 ? (s.with_detail / s.count) * 100 : 0;
              const share = total > 0 ? (s.count / total) * 100 : 0;
              const color = completionRate >= 80 ? "var(--primary)" : completionRate >= 50 ? "var(--text-secondary)" : "var(--danger)";
              return (
                <tr key={s.site_id}>
                  <td data-label="站点">{s.site_name}</td>
                  <td data-label="已收录" className="cell-number" style={{ textAlign: "right" }}>{fmt(s.count)}</td>
                  <td data-label="已补全" className="cell-number" style={{ textAlign: "right", color: "var(--primary)" }}>{fmt(s.with_detail)}</td>
                  <td data-label="未补全" className="cell-number" style={{ textAlign: "right", color: "var(--danger)" }}>{fmt(s.without_detail)}</td>
                  <td data-label="补全率" style={{ textAlign: "right" }}>
                    <span className="cell-rate" style={{ color, border: `1px solid ${color}` }}>{fmtPct(completionRate)}</span>
                  </td>
                  <td data-label="资源占比" className="cell-number" style={{ textAlign: "right" }}>{fmtPct(share)}</td>
                  <td data-label="操作" className="cell-action">
                    {s.without_detail > 0 && onFill && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onFill(s.site_id)}
                        disabled={fillActive}
                        style={{
                          minHeight: 28,
                          padding: "0 10px",
                          fontSize: 12,
                          borderRadius: 6,
                        }}
                      >
                        {fillActive ? "补全中…" : "补全"}
                      </button>
                    )}
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
  // 补全任务统一走 maintenance coordinator：状态以 jobs 快照为准，SSE + 低频轮询驱动
  const {
    jobs: maintenanceJobs,
    startJob: startMaintenanceJob,
    startingKind,
  } = useMaintenance();

  const refreshStats = () => {
    getCrawlerStats().then(res => { setStats(res); saveCache(res); }).catch(() => {});
  };

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

  /* ---- 补全任务：活动期禁用入口，进入终态时刷新统计并提示 ---- */

  const latestFillJob = useMemo(
    () => maintenanceJobs?.find((j) => j.kind === "detail.fill"),
    [maintenanceJobs]
  );
  const fillSnapshot = latestFillJob?.details?.fill as FillStatus | undefined;
  const activeFillJob = findActiveJob(maintenanceJobs, "detail.fill");
  const fillActive = Boolean(activeFillJob) || startingKind === "detail.fill";

  // 任务从活动进入终态时刷新统计并提示；不跟踪首次渲染就已是终态的旧任务
  const prevFillRef = useRef<{ id: string; active: boolean } | null>(null);
  useEffect(() => {
    const job = latestFillJob;
    const prev = prevFillRef.current;
    prevFillRef.current = job ? { id: job.id, active: isJobActive(job) } : null;
    if (!job || !prev || prev.id !== job.id || !prev.active || isJobActive(job)) {
      return;
    }
    refreshStats();
    const fill = job.details?.fill as FillStatus | undefined;
    if (job.state === "done") {
      toastSuccess(
        fill
          ? `补全完成：补齐 ${fmt(fill.filled)} 条，跳过 ${fmt(fill.skipped)} 条`
          : "补全完成"
      );
    } else if (job.state === "partial") {
      toast(
        "info",
        fill
          ? `补全部分完成：补齐 ${fmt(fill.filled)} 条，失败 ${fmt(fill.failed)} 条，有站点受阻`
          : "补全部分完成"
      );
    } else if (job.state === "interrupted") {
      toastError(
        `补全任务被中断（后端重启），已补 ${fmt(fill?.filled ?? 0)} 条，可重新发起`
      );
    } else if (job.state === "cancelled") {
      toast("info", `补全任务已取消，已补 ${fmt(fill?.filled ?? 0)} 条`);
    } else if (job.state === "skipped") {
      toast("info", job.error ? `补全未执行：${job.error}` : "补全未执行");
    } else {
      toastError(
        `补全失败：${fill ? fillFailureReason(fill) : (job.error ?? "未知错误")}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestFillJob?.id, latestFillJob?.state]);

  const handleFill = (siteId?: number) => {
    if (fillActive) return;
    startMaintenanceJob("detail.fill", siteId ?? null);
  };

  const sortedBySite = useMemo(() => {
    if (!stats) return [];
    return [...stats.by_site].sort((a, b) => b.count - a.count);
  }, [stats]);

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">数据看板</h1>
          <div className="page-subtitle">
            {stats?.computed_at ? `统计于 ${new Date(stats.computed_at).toLocaleString("zh-CN")}` : "加载中..."}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => handleFill()}
          disabled={fillActive}
        >
          {fillActive ? "批量补全中…" : "批量补全 videolist"}
        </button>
      </div>

      {/* 补全任务进度：活动期 SSE + 低频轮询刷新，终态保留结果摘要 */}
      {latestFillJob &&
        (isJobActive(latestFillJob) ||
          (fillSnapshot && fillSnapshot.state !== "idle")) && (
          <FillProgressPanel job={latestFillJob} />
        )}

      {/* 汇总条 */}
      {loading ? (
        <StatStripSkeleton />
      ) : stats ? (
        <StatStrip stats={stats} />
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
        <div style={{ marginBottom: 16 }}><SiteTable data={sortedBySite} total={stats.total} onFill={handleFill} fillActive={fillActive} /></div>
      ) : null}
    </div>
  );
}
