import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelMaintenanceJob,
  getMaintenanceOverview,
  listMaintenanceJobs,
  startMaintenanceJob,
} from "../api/maintenance";
import type { CleanupSpeed } from "../api/videos";
import { ApiError } from "../api/client";
import { onSseEvent } from "../api/sse";
import { toast, toastError, toastSuccess } from "../utils/toast";
import type {
  MaintenanceJob,
  MaintenanceKind,
  MaintenanceProgressEvent,
  MaintenanceState,
  MaintenanceTrigger,
} from "../types";

export const MAINTENANCE_JOBS_KEY = ["maintenance", "jobs"] as const;
export const MAINTENANCE_OVERVIEW_KEY = ["maintenance", "overview"] as const;

/** 活动任务兜底轮询间隔：SSE 丢事件时 2 秒低频拉快照，不让 UI 永久 loading */
const ACTIVE_POLL_INTERVAL_MS = 2000;

const ACTIVE_STATES: MaintenanceState[] = ["queued", "running"];

export function isJobActive(job: MaintenanceJob): boolean {
  return ACTIVE_STATES.includes(job.state);
}

export function isJobTerminal(job: MaintenanceJob): boolean {
  return !isJobActive(job);
}

/** 按去重规则找同类活动任务：crawl.incremental 按站点去重，其余全局去重 */
export function findActiveJob(
  jobs: MaintenanceJob[] | undefined,
  kind: MaintenanceKind,
  siteId?: number
): MaintenanceJob | undefined {
  return jobs?.find(
    (j) =>
      j.kind === kind &&
      isJobActive(j) &&
      (kind !== "crawl.incremental" || siteId == null || j.site_id === siteId)
  );
}

export const MAINTENANCE_KIND_LABEL: Record<MaintenanceKind, string> = {
  "crawl.full": "全量刮削",
  "crawl.incremental": "增量刮削",
  "detail.fill": "videolist 补全",
  "cache.cleanup": "失效资源清理",
  "site.discover": "站点探测",
};

export const MAINTENANCE_STATE_LABEL: Record<MaintenanceState, string> = {
  queued: "排队中",
  running: "运行中",
  done: "完成",
  partial: "部分完成",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
  interrupted: "已中断",
};

export const MAINTENANCE_TRIGGER_LABEL: Record<MaintenanceTrigger, string> = {
  manual: "手动",
  scheduled: "定时",
  startup: "启动",
  lifecycle: "生命周期",
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface StartMaintenanceOptions {
  dry_run?: boolean;
  speed?: CleanupSpeed;
}

/**
 * 统一运维任务入口：jobs/overview 走同一 queryKey，
 * SSE maintenance_progress 只负责失效缓存，真实数据以 GET 快照为准。
 * start/cancel 是交互操作，失败不自动重试，统一在这里弹提示。
 */
export function useMaintenance() {
  const queryClient = useQueryClient();

  // SSE 事件可能丢失，进度条仍以快照为准：活动任务存在时低频轮询兜底
  useEffect(() => {
    return onSseEvent<MaintenanceProgressEvent>("maintenance_progress", (data) => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_JOBS_KEY });
      if (data && !ACTIVE_STATES.includes(data.state)) {
        queryClient.invalidateQueries({ queryKey: MAINTENANCE_OVERVIEW_KEY });
      }
    });
  }, [queryClient]);

  const jobsQuery = useQuery({
    queryKey: MAINTENANCE_JOBS_KEY,
    queryFn: () => listMaintenanceJobs(30),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.some(isJobActive) ? ACTIVE_POLL_INTERVAL_MS : false,
  });

  const overviewQuery = useQuery({
    queryKey: MAINTENANCE_OVERVIEW_KEY,
    queryFn: getMaintenanceOverview,
    staleTime: 30_000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: MAINTENANCE_JOBS_KEY });
    queryClient.invalidateQueries({ queryKey: MAINTENANCE_OVERVIEW_KEY });
  };

  const startMutation = useMutation({
    mutationFn: (args: {
      kind: MaintenanceKind;
      siteId?: number | null;
      options?: StartMaintenanceOptions;
    }) => startMaintenanceJob(args.kind, args.siteId ?? null, args.options),
    onSuccess: (job) => {
      invalidateAll();
      if (job.state === "skipped") {
        toast("info", job.error || "任务未执行，请查看任务记录");
      } else if (job.deduplicated) {
        toast("info", `${MAINTENANCE_KIND_LABEL[job.kind]}正在运行，已接上当前进度`);
      } else {
        toastSuccess(`${MAINTENANCE_KIND_LABEL[job.kind]}已启动`);
      }
    },
    onError: (err) => toastError(`启动任务失败：${errorMessage(err)}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => cancelMaintenanceJob(jobId),
    onSuccess: () => {
      invalidateAll();
      toast("info", "已请求取消，任务会在当前批次结束后停止");
    },
    onError: (err) => toastError(`取消任务失败：${errorMessage(err)}`),
  });

  return {
    jobs: jobsQuery.data,
    jobsLoading: jobsQuery.isLoading,
    overview: overviewQuery.data,
    overviewLoading: overviewQuery.isLoading,
    startJob: (
      kind: MaintenanceKind,
      siteId?: number | null,
      options?: StartMaintenanceOptions
    ) => startMutation.mutate({ kind, siteId, options }),
    startJobAsync: (
      kind: MaintenanceKind,
      siteId?: number | null,
      options?: StartMaintenanceOptions
    ) => startMutation.mutateAsync({ kind, siteId, options }),
    starting: startMutation.isPending,
    startingKind: startMutation.isPending
      ? startMutation.variables?.kind
      : undefined,
    cancelJob: (jobId: string) => cancelMutation.mutate(jobId),
    cancelling: cancelMutation.isPending,
    cancellingId: cancelMutation.isPending ? cancelMutation.variables : undefined,
  };
}
