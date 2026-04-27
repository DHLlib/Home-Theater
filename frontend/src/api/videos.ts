import { get, post } from "./client";
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

export const getDetail = (req: DetailRequest) =>
  post<DetailResponse>("/api/videos/detail", req);
