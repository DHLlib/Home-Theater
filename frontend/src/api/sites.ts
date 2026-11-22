import { get, post, put, patch, del, ApiError } from "./client";
import type { Site, ProbeResult, SiteProbeResult, CategoryMapping, FetchCategoriesResponse, BatchProbeItem, BatchProbeResponse, SmartMatchResponse, TemplatePreviewResponse, TemplateApplyResponse, SiteHealth, SiteExportOut, SiteImportResult } from "../types";

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

function isSiteProbeResult(value: unknown): value is SiteProbeResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.site_id === "number" &&
    typeof r.site_name === "string" &&
    typeof r.url === "string" &&
    typeof r.ok === "boolean" &&
    (r.latency_ms == null || typeof r.latency_ms === "number") &&
    (r.error == null || typeof r.error === "string")
  );
}

/**
 * 流式批量检测：后端逐站输出 NDJSON（每行一个 SiteProbeResult），
 * 每解析出一行立刻回调 onResult；正常读到流结束返回。
 * 取消通过传入的 signal；AbortError 原样抛出，由调用方区分主动取消。
 */
export const probeSitesBatch = async (
  site_ids: number[] | null | undefined,
  onResult: (result: SiteProbeResult) => void,
  signal?: AbortSignal
): Promise<void> => {
  const resp = await fetch("/api/sites/probe-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site_ids: site_ids ?? null }),
    signal,
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : typeof data.message === "string"
          ? data.message
          : `${resp.status} error`;
    throw new ApiError(resp.status, detail);
  }
  if (!resp.body) {
    throw new Error("当前浏览器不支持流式读取，无法批量检测");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("批量检测返回了无法解析的结果");
    }
    if (!isSiteProbeResult(parsed)) {
      throw new Error("批量检测返回了不完整的结果");
    }
    onResult(parsed);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    }
    buffer += decoder.decode();
    handleLine(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
};

export const smartMatchCategories = (id: number) =>
  post<SmartMatchResponse>(`/api/sites/${id}/smart-match`);

export const previewTemplate = (id: number) =>
  get<TemplatePreviewResponse>(`/api/sites/${id}/template-preview`);

export const applyTemplate = (id: number) =>
  post<TemplateApplyResponse>(`/api/sites/${id}/apply-template`);

export const exportSites = () =>
  get<SiteExportOut>("/api/sites/export");

export const importSites = (sites: SiteExportOut["sites"], mode: "skip" | "overwrite" = "skip") =>
  post<SiteImportResult>("/api/sites/import", { sites, mode });
