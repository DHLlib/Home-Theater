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
      return await post<DetailResponse>("/api/videos/detail", req);
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

export const cleanupExpired = (siteId?: number) =>
  post<{ deleted: number; checked: number; by_site: { site_id: number; site_name: string; checked: number; deleted: number }[] }>(
    `/api/videos/cleanup-expired${siteId != null ? `?site_id=${siteId}` : ""}`
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
