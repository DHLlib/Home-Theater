import { get, post, patch, del } from "./client";
import type { SystemCategory, SystemCategoryTreeItem } from "../types";

export const listSystemCategories = () =>
  get<SystemCategoryTreeItem[]>("/api/system-categories");

export const createSystemCategory = (body: { name: string; parent_id?: number | null; sort?: number }) =>
  post<SystemCategory>("/api/system-categories", body);

export const updateSystemCategory = (id: number, body: { name?: string; parent_id?: number | null; sort?: number; enabled?: boolean }) =>
  patch<SystemCategory>(`/api/system-categories/${id}`, body);

/**
 * 删除分类。分类仍被别名/视频引用时后端返回 409，
 * 需要传 remapTo 先把引用迁到目标分类再删。
 */
export const deleteSystemCategory = (id: number, remapTo?: string) =>
  del<{ ok: boolean; remapped_to?: string | null; names?: string[] }>(
    `/api/system-categories/${id}${
      remapTo ? `?remap_to=${encodeURIComponent(remapTo)}` : ""
    }`
  );
