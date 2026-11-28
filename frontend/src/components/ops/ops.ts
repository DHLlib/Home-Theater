import type {
  MaintenanceJob,
  MaintenanceKind,
  MaintenanceState,
  MaintenanceTrigger,
  SiteMaintenanceStatus,
} from "../../types";

/* ---------- 文案 ---------- */
export const KIND_LABEL: Record<MaintenanceKind, string> = {
  "crawl.full": "全量刮削",
  "crawl.incremental": "增量刮削",
  "detail.fill": "videolist 补全",
  "cache.cleanup": "失效资源清理",
  "site.discover": "站点探测",
};

export const STATE_LABEL: Record<MaintenanceState, string> = {
  queued: "排队中",
  running: "运行中",
  done: "完成",
  partial: "部分完成",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
  interrupted: "已中断",
};

export const TRIGGER_LABEL: Record<MaintenanceTrigger, string> = {
  manual: "手动",
  scheduled: "定时",
  startup: "启动",
  lifecycle: "生命周期",
};

export const KIND_OPTIONS: MaintenanceKind[] = [
  "crawl.full",
  "crawl.incremental",
  "detail.fill",
  "cache.cleanup",
];

export function kindLabel(kind: MaintenanceKind | string): string {
  return KIND_LABEL[kind as MaintenanceKind] ?? String(kind);
}
export function stateLabel(state: MaintenanceState | string): string {
  return STATE_LABEL[state as MaintenanceState] ?? String(state);
}
export function triggerLabel(trigger: MaintenanceTrigger | string): string {
  return TRIGGER_LABEL[trigger as MaintenanceTrigger] ?? String(trigger);
}

export function stateTone(
  state: MaintenanceState
): "ok" | "active" | "warn" | "bad" {
  if (state === "done") return "ok";
  if (state === "queued" || state === "running") return "active";
  if (state === "failed") return "bad";
  return "warn";
}

/* ---------- 时间 ---------- */
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function toDate(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let s = String(value).trim();
  if (NAIVE_ISO.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
export function formatShortTime(
  value: string | number | null | undefined,
  now: Date = new Date()
): string {
  const d = toDate(value);
  if (!d) return "—";
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return hm;
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`;
}
export function formatFullTime(value: string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function formatLogTime(
  value: string | number | null | undefined,
  now: Date = new Date()
): string {
  const d = toDate(value);
  if (!d) return "—";
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (sameDay(d, now)) return hms;
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${hms}`;
}
export function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("zh-CN");
}

/* ---------- 站点状态 ---------- */
interface HealthRecord {
  last_probe_ok?: boolean | null;
  last_probe_latency_ms?: number | null;
  last_probe_error?: string | null;
  last_probe_at?: string | null;
  failure_count?: number;
  recovery_count?: number;
}
export interface SiteHealthChip {
  tone: "ok" | "bad" | "muted";
  text: string;
  error?: string | null;
}
export function healthOf(site: SiteMaintenanceStatus): SiteHealthChip {
  if (!site.enabled) return { tone: "muted", text: "已禁用" };
  const h = site.health as HealthRecord | null | undefined;
  if (!h) return { tone: "muted", text: "未探测" };
  if (h.last_probe_ok === true) {
    return {
      tone: "ok",
      text:
        h.last_probe_latency_ms != null
          ? `正常 ${h.last_probe_latency_ms}ms`
          : "正常",
    };
  }
  if (h.last_probe_ok === false) {
    return { tone: "bad", text: "异常", error: h.last_probe_error ?? null };
  }
  return { tone: "muted", text: "未探测" };
}

export function activeJobFor(
  siteId: number,
  jobs: MaintenanceJob[] | undefined
): MaintenanceJob | undefined {
  return jobs?.find((job) => isActiveJob(job) && job.site_id === siteId);
}
export function isActiveJob(job: MaintenanceJob): boolean {
  return job.state === "queued" || job.state === "running";
}
export function globalActiveJob(
  kind: MaintenanceKind,
  jobs: MaintenanceJob[] | undefined
): MaintenanceJob | undefined {
  return jobs?.find(
    (job) => isActiveJob(job) && job.kind === kind && job.site_id == null
  );
}

export function nextCheckText(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  const d = toDate(value);
  if (!d) return "下次 —";
  if (d.getTime() < now.getTime()) return "待检查";
  return `下次 ${formatShortTime(value, now)}`;
}

export function cardMeta(
  site: SiteMaintenanceStatus,
  job: MaintenanceJob | undefined,
  now: Date = new Date()
): { text: string; active: boolean } {
  if (job) return { active: true, text: `任务中 · ${kindLabel(job.kind)}` };
  if (!site.last_crawl_at) return { active: false, text: "无刮削记录" };
  if (!site.enabled) {
    return { active: false, text: `上次 ${formatShortTime(site.last_crawl_at, now)}` };
  }
  return {
    active: false,
    text: `最近 ${formatShortTime(site.last_crawl_at, now)} · ${nextCheckText(
      site.next_check_at,
      now
    )}`,
  };
}

export function progressPercent(
  total: number | null | undefined,
  withDetail: number | null | undefined
): number {
  const t = Number(total ?? 0);
  if (t <= 0) return 0;
  return Math.min(100, (Number(withDetail ?? 0) / t) * 100);
}

export function rateText(
  total: number | null | undefined,
  withDetail: number | null | undefined,
  withoutDetail?: number | null
): string {
  const t = Number(total ?? 0);
  if (t <= 0) return "—";
  const pending = Number(withoutDetail ?? t - Number(withDetail ?? 0));
  const r = (Number(withDetail ?? 0) / t) * 100;
  if (pending <= 0) return "100%";
  if (r > 99.9) return `${(Math.floor(r * 100) / 100).toFixed(2)}%`;
  return `${r.toFixed(1)}%`;
}

export type SiteSort = "attention" | "pending" | "total" | "recent" | "name";

export function attentionBucket(
  site: SiteMaintenanceStatus,
  jobs: MaintenanceJob[] | undefined
): number {
  if (activeJobFor(site.site_id, jobs)) return 0;
  if (!site.enabled) return 5;
  if (healthOf(site).tone === "bad") return 1;
  if (!site.last_crawl_at) return 2;
  if ((site.without_detail || 0) > 0) return 3;
  return 4;
}

function byName(a: SiteMaintenanceStatus, b: SiteMaintenanceStatus): number {
  return a.site_name.localeCompare(b.site_name, "zh-CN");
}

export function sortSites(
  sites: SiteMaintenanceStatus[],
  sort: SiteSort,
  jobs: MaintenanceJob[] | undefined
): SiteMaintenanceStatus[] {
  return sites.toSorted((a, b) => {
    if (sort === "name") return byName(a, b);
    if (sort === "pending") {
      return (
        (b.without_detail || 0) - (a.without_detail || 0) ||
        (b.total || 0) - (a.total || 0) ||
        byName(a, b)
      );
    }
    if (sort === "total") {
      return (b.total || 0) - (a.total || 0) || byName(a, b);
    }
    if (sort === "recent") {
      const ta = toDate(a.last_crawl_at)?.getTime() ?? 0;
      const tb = toDate(b.last_crawl_at)?.getTime() ?? 0;
      return tb - ta || byName(a, b);
    }
    const ba = attentionBucket(a, jobs);
    const bb = attentionBucket(b, jobs);
    if (ba !== bb) return ba - bb;
    if (ba === 0) {
      const ja = activeJobFor(a.site_id, jobs);
      const jb = activeJobFor(b.site_id, jobs);
      return (
        (toDate(ja?.created_at)?.getTime() ?? 0) -
        (toDate(jb?.created_at)?.getTime() ?? 0)
      );
    }
    if (ba === 3) {
      return (
        progressPercent(a.total, a.with_detail) -
          progressPercent(b.total, b.with_detail) ||
        (b.without_detail || 0) - (a.without_detail || 0) ||
        byName(a, b)
      );
    }
    return byName(a, b);
  });
}

export function filterSites(
  sites: SiteMaintenanceStatus[],
  filter: "all" | "attention" | "active" | "disabled",
  jobs: MaintenanceJob[] | undefined
): SiteMaintenanceStatus[] {
  if (filter === "attention") {
    return sites.filter((site) => attentionBucket(site, jobs) <= 3);
  }
  if (filter === "active") {
    return sites.filter((site) => Boolean(activeJobFor(site.site_id, jobs)));
  }
  if (filter === "disabled") return sites.filter((site) => !site.enabled);
  return sites;
}

/* ---------- 任务 ---------- */
export interface FillBrief {
  filled?: number;
  failed?: number;
  skipped?: number;
}
export interface CleanupBrief {
  checked?: number;
  deleted?: number;
  pending?: number;
}

export function jobBrief(job: MaintenanceJob): string {
  const details = job.details ?? {};
  if (job.kind === "detail.fill") {
    const fill = details.fill as FillBrief | undefined;
    if (fill && typeof fill === "object") {
      const parts = [`已补 ${formatNumber(fill.filled)}`];
      if ((fill.failed ?? 0) > 0) parts.push(`失败 ${formatNumber(fill.failed)}`);
      if ((fill.skipped ?? 0) > 0) parts.push(`跳过 ${formatNumber(fill.skipped)}`);
      return parts.join(" · ");
    }
  }
  if (job.kind === "cache.cleanup") {
    const cleanup = details.cleanup as CleanupBrief | undefined;
    if (cleanup && typeof cleanup === "object") {
      const parts = [`检查 ${formatNumber(cleanup.checked)}`];
      if ((cleanup.deleted ?? 0) > 0) parts.push(`删除 ${formatNumber(cleanup.deleted)}`);
      if ((cleanup.pending ?? 0) > 0) parts.push(`待确认 ${formatNumber(cleanup.pending)}`);
      return parts.join(" · ");
    }
  }
  if (job.state === "interrupted") return "服务重启，任务中断";
  if (job.kind === "crawl.full" && job.state === "done") return "全部站点完成";
  return "";
}
