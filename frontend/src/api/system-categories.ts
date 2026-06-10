import { get, post, patch, del } from "./client";
import type { SystemCategory, SystemCategoryTreeItem } from "../types";

export const listSystemCategories = () =>
  get<SystemCategoryTreeItem[]>("/api/system-categories");

export const createSystemCategory = (body: { name: string; parent_id?: number | null; sort?: number }) =>
  post<SystemCategory>("/api/system-categories", body);

export const updateSystemCategory = (id: number, body: { name?: string; parent_id?: number | null; sort?: number; enabled?: boolean }) =>
  patch<SystemCategory>(`/api/system-categories/${id}`, body);

export const deleteSystemCategory = (id: number) =>
  del<{ ok: boolean }>(`/api/system-categories/${id}`);
