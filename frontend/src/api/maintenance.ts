import { get, post } from "./client";
import type { CleanupSpeed } from "./videos";
import type {
  MaintenanceJob,
  MaintenanceKind,
  MaintenanceOverview,
} from "../types";

/** 统一运维任务：GET 快照是恢复依据，SSE maintenance_progress 只作失效信号 */

export const listMaintenanceJobs = (limit = 30, activeOnly = false) => {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (activeOnly) qs.set("active_only", "true");
  return get<MaintenanceJob[]>(`/api/maintenance/jobs?${qs}`, 15000);
};

export const getMaintenanceJob = (jobId: string) =>
  get<MaintenanceJob>(`/api/maintenance/jobs/${jobId}`, 15000);

export const getMaintenanceOverview = () =>
  get<MaintenanceOverview>("/api/maintenance/overview", 15000);

/** 启动长任务；同类任务已在运行时后端返回原任务且 deduplicated=true */
export const startMaintenanceJob = (
  kind: MaintenanceKind,
  siteId?: number | null,
  options?: { dry_run?: boolean; speed?: CleanupSpeed }
) =>
  post<MaintenanceJob>(
    `/api/maintenance/jobs/${kind}`,
    {
      site_id: siteId ?? null,
      dry_run: options?.dry_run ?? false,
      speed: options?.speed ?? "eco",
    },
    15000
  );

export const cancelMaintenanceJob = (jobId: string) =>
  post<MaintenanceJob>(
    `/api/maintenance/jobs/${jobId}/cancel`,
    undefined,
    15000
  );
