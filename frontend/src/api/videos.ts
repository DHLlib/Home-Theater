import { del, get, post } from "./client";
import type {
  AggregatedListResponse,
  CrawlerLogsResponse,
  CrawlerStatsResponse,
  DetailRequest,
  DetailResponse,
  FillVideolistResponse,
} from "../types";

/* ===== AC-023: 移动端检测，自动追加 device 参数 ===== */

function isMobile(): boolean {
  if (window.innerWidth < 768) return true;
  if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) return true;
  return false;
}

function appendDeviceParam(qs: URLSearchParams): void {
  if (isMobile()) {
    qs.set("device", "mobile");
  }
}

export const listVideos = (params?: {
  t?: number | string;
  pg?: number;
  by?: string;
  category?: string;
  mode?: string;
  sort?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.t != null) qs.set("t", String(params.t));
  if (params?.pg != null) qs.set("pg", String(params.pg));
  if (params?.by) qs.set("by", params.by);
  if (params?.category) qs.set("category", params.category);
  if (params?.mode) qs.set("mode", params.mode);
  if (params?.sort) qs.set("sort", params.sort);
  appendDeviceParam(qs);
  return get<AggregatedListResponse>(`/api/videos?${qs}`, 15000);
};

export const searchVideos = (params: { wd: string; pg?: number; category?: string; mode?: string; sort?: string }) => {
  const qs = new URLSearchParams();
  qs.set("wd", params.wd);
  if (params.pg != null) qs.set("pg", String(params.pg));
  if (params.category) qs.set("category", params.category);
  if (params.mode) qs.set("mode", params.mode);
  if (params.sort) qs.set("sort", params.sort);
  appendDeviceParam(qs);
  return get<AggregatedListResponse>(`/api/videos/search?${qs}`, 15000);
};

export const getRecommendedVideos = () =>
  get<AggregatedListResponse>("/api/videos/recommended", 15000);

/* ===== 未分类归因 ===== */

export interface UncategorizedSource {
  site_id: number;
  site_name: string | null;
  type_name: string | null;
  reason: "no_type_name" | "no_alias" | "adult_blocked" | "alias_disabled" | "alias_mismatch";
  reason_text: string;
  alias_system: string | null;
}

export interface UncategorizedItem {
  title: string;
  year: number | null;
  poster_url: string | null;
  sources: UncategorizedSource[];
  candidate_name: string | null;
  candidate_system: string | null;
}

export const listUncategorizedVideos = (limit = 100) =>
  get<{ total: number; items: UncategorizedItem[] }>(
    `/api/videos/uncategorized?limit=${limit}`
  );

const pendingDetails = new Map<string, Promise<DetailResponse>>();

const MAX_CONCURRENT_DETAILS = 6;
let activeDetailCount = 0;
const detailQueue: Array<() => void> = [];

function acquireDetailSlot(): Promise<void> {
  if (activeDetailCount < MAX_CONCURRENT_DETAILS) {
    activeDetailCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    detailQueue.push(resolve);
  });
}

function releaseDetailSlot() {
  activeDetailCount--;
  const next = detailQueue.shift();
  if (next) {
    activeDetailCount++;
    next();
  }
}

export function getDetail(req: DetailRequest): Promise<DetailResponse> {
  const key = `${req.title}::${req.year ?? "null"}`;
  const existing = pendingDetails.get(key);
  if (existing) return existing;

  const promise = (async () => {
    await acquireDetailSlot();
    try {
      // 后端已把详情限制在 ~12 秒内（每来源 6 秒硬超时），客户端 15 秒兜底，
      // 避免默认 30 秒把交互拖成「一直在转圈」
      return await post<DetailResponse>("/api/videos/detail", req, 15000);
    } finally {
      releaseDetailSlot();
    }
  })().finally(() => {
    pendingDetails.delete(key);
  });
  pendingDetails.set(key, promise);
  return promise;
}

export const clearVideoCache = () => del<{ deleted: number }>("/api/videos/cache");

export type CleanupSpeed = "eco" | "normal" | "fast";

export interface CleanupStatus {
  running: boolean;
  /** 演练模式：只统计不删除（?cleanup_dry_run=1 或 ?dry_run=true） */
  dry_run?: boolean;
  /** 速度档位：eco 省流 / normal 标准 / fast 快速 */
  speed?: CleanupSpeed;
  cancel_requested?: boolean;
  phase?: "idle" | "scanning" | "done";
  started_at: number | null;
  finished_at: number | null;
  checked: number;
  total: number;
  percent: number;
  eta_seconds: number | null;
  deleted: number;
  pending: number;
  sites_total: number;
  sites_done: number;
  current_site: { id: number; name: string } | null;
  by_site: {
    site_id: number;
    site_name: string;
    checked: number;
    deleted: number;
    pending?: number;
  }[];
  error: string | null;
}

/** 启动后台清理任务（立即返回，进度用 getCleanupStatus 轮询） */
export const startCleanupExpired = (
  siteId?: number,
  dryRun = false,
  speed: CleanupSpeed = "eco"
) => {
  const params = new URLSearchParams();
  if (siteId != null) params.set("site_id", String(siteId));
  if (dryRun) params.set("dry_run", "true");
  params.set("speed", speed);
  const qs = params.toString();
  return post<{ started: boolean } & CleanupStatus>(
    `/api/videos/cleanup-expired${qs ? `?${qs}` : ""}`,
    undefined,
    15000
  );
};

export const getCleanupStatus = () =>
  get<CleanupStatus>("/api/videos/cleanup-expired/status", 15000);

export const cancelCleanupExpired = () =>
  post<{ cancelled: boolean } & CleanupStatus>(
    "/api/videos/cleanup-expired/cancel",
    undefined,
    15000
  );

export const getCrawlerStatus = () => get<{ running: boolean; site_status: Record<string, string> }>("/api/videos/crawler/status");

export const triggerIncremental = (siteId: number) =>
  post<{ message: string }>(`/api/videos/crawler/incremental/${siteId}`);

export const getCrawlerLogs = () =>
  get<CrawlerLogsResponse>("/api/videos/crawler/logs");

export const getCrawlerStats = () =>
  get<CrawlerStatsResponse>("/api/videos/crawler/stats");

export const triggerFullCrawl = () =>
  post<{ message: string }>("/api/videos/crawler/full");

export const fillMissingVideolist = (siteId?: number) =>
  post<FillVideolistResponse>("/api/videos/crawler/fill-videolist", { site_id: siteId ?? null });
