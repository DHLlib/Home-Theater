import { get, post, del } from "./client";
import type {
  DownloadBatchCreate,
  DownloadBatchResult,
  DownloadTask,
  DownloadTaskCreate,
} from "../types";

export const createDownload = (body: DownloadTaskCreate) =>
  post<DownloadTask>("/api/downloads", body);
export const createDownloadBatch = (body: DownloadBatchCreate) =>
  post<DownloadBatchResult>("/api/downloads/batch", body);
export const listDownloads = () => get<DownloadTask[]>("/api/downloads");
export const pauseDownload = (id: number) =>
  post<DownloadTask>(`/api/downloads/${id}/pause`);
export const resumeDownload = (id: number) =>
  post<DownloadTask>(`/api/downloads/${id}/resume`);
export const deleteDownload = (id: number, deleteFile?: boolean) =>
  del<{ ok: boolean; file_deleted?: boolean; file_error?: string | null }>(
    `/api/downloads/${id}${deleteFile ? "?delete_file=true" : ""}`
  );
