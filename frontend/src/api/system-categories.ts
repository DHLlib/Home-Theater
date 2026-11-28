import { get, post, patch, del } from "./client";
import type { SystemCategory, SystemCategoryTreeItem } from "../types";

export const listSystemCategories = () =>
  get<SystemCategoryTreeItem[]>("/api/system-categories");

export const createSystemCategory = (body: { name: string; parent_id?: number | null; sort?: number }) =>
  post<SystemCategory>("/api/system-categories", body);

export const updateSystemCategory = (id: number, body: { name?: string; parent_id?: number | null; sort?: number; enabled?: boolean }) =>
  patch<SystemCategory>(`/api/system-categories/${id}`, body);

/**
 * 删除分类：服务端不再迁移，相关远程分类回到未挂载，视频直接置为未分类。
 */
export const deleteSystemCategory = (id: number) =>
  del<{ ok: boolean; names: string[]; links_removed: number; videos_reset: number }>(
    `/api/system-categories/${id}`
  );
