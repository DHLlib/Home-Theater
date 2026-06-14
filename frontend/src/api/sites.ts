import { get, post, put, patch, del } from "./client";
import type { Site, ProbeResult, SiteProbeResult, CategoryMapping, FetchCategoriesResponse, BatchProbeItem, BatchProbeResponse, SmartMatchResponse, TemplatePreviewResponse, TemplateApplyResponse, SiteHealth } from "../types";

export const listSites = () => get<Site[]>("/api/sites");
export const createSite = (body: Omit<Site, "id" | "created_at">) =>
  post<Site>("/api/sites", body);
export const updateSite = (id: number, body: Partial<Site>) =>
  patch<Site>(`/api/sites/${id}`, body);
export const deleteSite = (id: number) =>
  del<{ ok: boolean; site_id: number; status: string }>(`/api/sites/${id}`);
export const probeSite = (id: number) =>
  post<ProbeResult>(`/api/sites/${id}/probe`);

export const getSiteHealth = (id: number) =>
  get<SiteHealth>(`/api/sites/${id}/health`);

export const getSiteCategories = (id: number) =>
  get<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/categories`);

export const updateSiteCategories = (id: number, categories: CategoryMapping[]) =>
  put<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/categories`, { categories });

export const fetchRemoteCategories = (id: number) =>
  post<FetchCategoriesResponse>(`/api/sites/${id}/fetch-categories`);

export const batchProbe = (items: BatchProbeItem[]) =>
  post<BatchProbeResponse>("/api/sites/batch-probe", items);

export const probeSitesBatch = (site_ids?: number[]) =>
  post<SiteProbeResult[]>("/api/sites/probe-batch", { site_ids });

export const smartMatchCategories = (id: number) =>
  post<SmartMatchResponse>(`/api/sites/${id}/smart-match`);

export const previewTemplate = (id: number) =>
  get<TemplatePreviewResponse>(`/api/sites/${id}/template-preview`);

export const applyTemplate = (id: number) =>
  post<TemplateApplyResponse>(`/api/sites/${id}/apply-template`);
