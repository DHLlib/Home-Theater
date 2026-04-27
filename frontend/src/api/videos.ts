import { del, get, post } from "./client";
import type {
  AggregatedListResponse,
  DetailRequest,
  DetailResponse,
} from "../types";

export const listVideos = (params?: {
  t?: number | string;
  pg?: number;
  h?: number;
  by?: string;
  category?: string;
  mode?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.t != null) qs.set("t", String(params.t));
  if (params?.pg != null) qs.set("pg", String(params.pg));
  if (params?.h != null) qs.set("h", String(params.h));
  if (params?.by) qs.set("by", params.by);
  if (params?.category) qs.set("category", params.category);
  if (params?.mode) qs.set("mode", params.mode);
  return get<AggregatedListResponse>(`/api/videos?${qs}`);
};

export const searchVideos = (params: { wd: string; pg?: number; category?: string; mode?: string }) => {
  const qs = new URLSearchParams();
  qs.set("wd", params.wd);
  if (params.pg != null) qs.set("pg", String(params.pg));
  if (params.category) qs.set("category", params.category);
  if (params.mode) qs.set("mode", params.mode);
  return get<AggregatedListResponse>(`/api/videos/search?${qs}`);
};

const pendingDetails = new Map<string, Promise<DetailResponse>>();

const MAX_CONCURRENT_DETAILS = 3;
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
