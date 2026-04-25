import { get, post, del } from "./client";
import type { DownloadTask, DownloadTaskCreate } from "../types";

export const createDownload = (body: DownloadTaskCreate) =>
  post<DownloadTask>("/api/downloads", body);
export const listDownloads = () => get<DownloadTask[]>("/api/downloads");
export const pauseDownload = (id: number) =>
  post<DownloadTask>(`/api/downloads/${id}/pause`);
export const resumeDownload = (id: number) =>
  post<DownloadTask>(`/api/downloads/${id}/resume`);
export const deleteDownload = (id: number) =>
  del<{ ok: boolean }>(`/api/downloads/${id}`);
