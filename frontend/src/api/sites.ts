import { get, post, put, patch, del } from "./client";
import type { Site, ProbeResult, CategoryMapping } from "../types";

export const listSites = () => get<Site[]>("/api/sites");
export const createSite = (body: Omit<Site, "id" | "created_at">) =>
  post<Site>("/api/sites", body);
export const updateSite = (id: number, body: Partial<Site>) =>
  patch<Site>(`/api/sites/${id}`, body);
export const deleteSite = (id: number) =>
  del<{ ok: boolean }>(`/api/sites/${id}`);
export const probeSite = (id: number) =>
  post<ProbeResult>(`/api/sites/${id}/probe`);

export const getSiteCategories = (id: number) =>
  get<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/categories`);

export const updateSiteCategories = (id: number, categories: CategoryMapping[]) =>
  put<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/categories`, { categories });

export const fetchRemoteCategories = (id: number) =>
  post<{ site_id: number; categories: CategoryMapping[] }>(`/api/sites/${id}/fetch-categories`);
