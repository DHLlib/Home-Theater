import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AddSiteDialog from "../components/AddSiteDialog";
import BatchSniffDialog from "../components/BatchSniffDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import ActionSheet, {
  type ActionSheetAction,
} from "../components/ActionSheet";
import CrawlLogs from "../components/ops/CrawlLogs";
import SiteCard from "../components/ops/SiteCard";
import SiteOpsSheet from "../components/ops/SiteOpsSheet";
import StatBar from "../components/ops/StatBar";
import TaskRecords from "../components/ops/TaskRecords";
import TrendPanel from "../components/ops/TrendPanel";
import {
  ActivityIcon,
  DownloadIcon,
  MoreIcon,
  PlusIcon,
  RadarIcon,
  RefreshIcon,
  ServerIcon,
  UploadIcon,
} from "../components/ops/icons";
import {
  activeJobFor,
  filterSites,
  formatNumber,
  formatShortTime,
  globalActiveJob,
  isActiveJob,
  kindLabel,
  sortSites,
  type SiteSort,
} from "../components/ops/ops";
import "../components/ops/ops.css";
import { ApiError } from "../api/client";
import { onSseEvent } from "../api/sse";
import {
  createSite,
  deleteSite,
  exportSites,
  importSites,
  listSites,
  probeSitesBatch,
} from "../api/sites";
import { getCrawlerStats } from "../api/videos";
import {
  MAINTENANCE_JOBS_KEY,
  MAINTENANCE_OVERVIEW_KEY,
  useMaintenance,
} from "../hooks/useMaintenance";
import { toastError, toastSuccess } from "../utils/toast";
import type {
  MaintenanceJob,
  Site,
  SiteExportOut,
  SiteMaintenanceStatus,
} from "../types";

type Speed = "eco" | "normal" | "fast";
type SiteFilter = "all" | "attention" | "active" | "disabled";

const SORT_OPTIONS: { value: SiteSort; label: string }[] = [
  { value: "attention", label: "需关注优先" },
  { value: "pending", label: "待补全" },
  { value: "total", label: "收录量" },
  { value: "recent", label: "最近刮削" },
  { value: "name", label: "名称" },
];

function readSort(): SiteSort {
  try {
    const value = localStorage.getItem("ht-ops-sort");
    if (SORT_OPTIONS.some((option) => option.value === value)) {
      return value as SiteSort;
    }
  } catch {
    /* ignore */
  }
  return "attention";
}
function readSpeed(): Speed {
  try {
    const value = localStorage.getItem("ht-cleanup-speed");
    if (value === "eco" || value === "normal" || value === "fast") return value;
  } catch {
    /* ignore */
  }
  return "eco";
}
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return fallback;
}

interface ConfirmState {
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
}
interface SiteDeleteProgress {
  site_id: number;
  status: string;
  message?: string;
}

function SiteCardsSkeleton() {
  return (
    <div className="ops-grid" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="ops-skeleton-card" key={index}>
          <div className="ops-skeleton ops-skeleton-line" style={{ width: "58%" }} />
          <div
            className="ops-skeleton ops-skeleton-line"
            style={{ width: "82%", marginTop: 6 }}
          />
          <div
            className="ops-skeleton"
            style={{ height: 4, marginTop: "auto" }}
          />
          <div
            className="ops-skeleton ops-skeleton-line"
            style={{ width: "42%", marginTop: 6 }}
          />
        </div>
      ))}
    </div>
  );
}

export default function Ops() {
  const queryClient = useQueryClient();
  const {
    jobs,
    jobsLoading,
    overview,
    overviewLoading,
    startJob,
    startingKind,
    cancelJob,
    cancellingId,
  } = useMaintenance();

  const sitesQuery = useQuery({
    queryKey: ["sites"],
    queryFn: listSites,
    staleTime: 60_000,
  });
  const statsQuery = useQuery({
    queryKey: ["crawler-stats"],
    queryFn: getCrawlerStats,
    staleTime: 60_000,
  });

  const sites = sitesQuery.data ?? [];
  const statuses = overview?.sites ?? [];
  const jobsList = jobs ?? [];
  const jobsError = !jobsLoading && jobs === undefined;
  const sitesLoading = overviewLoading;
  const sitesError = !overviewLoading && overview === undefined;

  const [filter, setFilter] = useState<SiteFilter>("all");
  const [sort, setSort] = useState<SiteSort>(readSort);
  const [speed, setSpeed] = useState<Speed>(readSpeed);
  const [sheetSiteId, setSheetSiteId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSniff, setShowSniff] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set());
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeProgress, setProbeProgress] = useState({ done: 0, total: 0 });
  const probeAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanupDryRun = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("cleanup_dry_run") ===
      "1",
    []
  );

  useEffect(() => {
    try {
      localStorage.setItem("ht-ops-sort", sort);
    } catch {
      /* ignore */
    }
  }, [sort]);

  useEffect(() => {
    return () => probeAbortRef.current?.abort();
  }, []);

  const refreshSites = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sites"] });
    void queryClient.invalidateQueries({ queryKey: ["crawler-stats"] });
    void queryClient.invalidateQueries({ queryKey: MAINTENANCE_JOBS_KEY });
    void queryClient.invalidateQueries({ queryKey: MAINTENANCE_OVERVIEW_KEY });
  }, [queryClient]);

  const refreshAll = useCallback(() => {
    refreshSites();
    void queryClient.invalidateQueries({ queryKey: ["crawler-logs"] });
    toastSuccess("已刷新");
  }, [queryClient, refreshSites]);

  const markDeleting = useCallback((siteId: number, deleting: boolean) => {
    setDeletingIds((previous) => {
      const next = new Set(previous);
      if (deleting) next.add(siteId);
      else next.delete(siteId);
      return next;
    });
  }, []);

  useEffect(() => {
    return onSseEvent<SiteDeleteProgress>("site_delete_progress", (data) => {
      if (!data || typeof data.site_id !== "number") return;
      if (data.status === "completed") {
        markDeleting(data.site_id, false);
        setSheetSiteId((current) =>
          current === data.site_id ? null : current
        );
        toastSuccess(data.message || "站点删除完成");
        refreshSites();
      } else if (data.status === "failed") {
        markDeleting(data.site_id, false);
        toastError(data.message || "站点删除失败");
        refreshSites();
      }
    });
  }, [markDeleting, refreshSites]);

  const statusById = useMemo(() => {
    const map = new Map<number, SiteMaintenanceStatus>();
    statuses.forEach((status) => map.set(status.site_id, status));
    return map;
  }, [statuses]);
  const siteById = useMemo(() => {
    const map = new Map<number, Site>();
    sites.forEach((site) => map.set(site.id, site));
    return map;
  }, [sites]);

  const filteredSites = useMemo(
    () => sortSites(filterSites(statuses, filter, jobs), sort, jobs),
    [filter, jobs, sort, statuses]
  );
  const counts = useMemo(
    () => ({
      all: statuses.length,
      attention: filterSites(statuses, "attention", jobs).length,
      active: statuses.filter((site) => activeJobFor(site.site_id, jobs)).length,
      disabled: statuses.filter((site) => !site.enabled).length,
    }),
    [jobs, statuses]
  );
  const activeJobs = useMemo(
    () =>
      jobsList
        .filter(isActiveJob)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    [jobsList]
  );

  const sheetStatus =
    sheetSiteId != null ? statusById.get(sheetSiteId) : undefined;
  const sheetSite =
    sheetSiteId != null
      ? siteById.get(sheetSiteId) ??
        (sheetStatus
          ? {
              id: sheetStatus.site_id,
              name: sheetStatus.site_name,
              base_url: "",
              enabled: sheetStatus.enabled,
              sort: 0,
            }
          : null)
      : null;

  const sitesUnavailable = sitesLoading || sitesError || statuses.length === 0;
  const fullActive = globalActiveJob("crawl.full", jobs);
  const fillActive = globalActiveJob("detail.fill", jobs);
  const cleanupActive = globalActiveJob("cache.cleanup", jobs);

  const askConfirm = (next: ConfirmState) => setConfirm(next);

  const askFullCrawl = () => {
    askConfirm({
      title: "全量刮削",
      message:
        "确定要重新全量刮削吗？这会遍历所有站点的所有分类，预计耗时 20–40 分钟。",
      confirmText: "开始刮削",
      onConfirm: () => startJob("crawl.full"),
    });
  };
  const askCleanup = () => {
    askConfirm({
      title: "清除失效资源",
      message:
        "确定要清除失效资源吗？会后台扫完全部站点的缓存，连续两轮都没被资源站返回的条目才会删除，整个过程可能需要约 1 小时。",
      confirmText: "开始清理",
      danger: true,
      onConfirm: () =>
        startJob("cache.cleanup", null, {
          dry_run: cleanupDryRun,
          speed,
        }),
    });
  };
  const askCancel = (job: MaintenanceJob) => {
    askConfirm({
      title: "取消任务",
      message: `确定要取消「${kindLabel(job.kind)}」吗？任务会在当前批次结束后停止。`,
      confirmText: "取消任务",
      onConfirm: () => cancelJob(job.id),
    });
  };
  const beginDelete = (site: Site) => {
    askConfirm({
      title: "删除站点",
      message: `确定要删除「${site.name}」吗？该站点的缓存数据将一并清理。`,
      confirmText: "删除站点",
      danger: true,
      onConfirm: () => {
        setSheetSiteId((current) => (current === site.id ? null : current));
        markDeleting(site.id, true);
        deleteSite(site.id).catch((error) => {
          markDeleting(site.id, false);
          toastError(`删除站点失败：${errorMessage(error, "请稍后重试")}`);
        });
      },
    });
  };

  const startBatchProbe = () => {
    const total = statuses.length || sites.length;
    if (!total) return;
    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;
    setProbeProgress({ done: 0, total });
    setProbeBusy(true);
    probeSitesBatch(
      null,
      () =>
        setProbeProgress((previous) => ({
          ...previous,
          done: Math.min(previous.total, previous.done + 1),
        })),
      controller.signal
    )
      .then(() => {
        if (!controller.signal.aborted) toastSuccess("批量检测完成");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toastError(
          error instanceof ApiError
            ? `批量检测失败：${error.detail}`
            : "批量检测中断，已保留完成的结果，可重新检测"
        );
      })
      .finally(() => {
        if (probeAbortRef.current === controller) {
          setProbeBusy(false);
          probeAbortRef.current = null;
        }
        void queryClient.invalidateQueries({
          queryKey: MAINTENANCE_OVERVIEW_KEY,
        });
      });
  };
  const askBatchProbe = () => {
    if (probeBusy) return;
    const total = statuses.length || sites.length;
    if (!total) return;
    askConfirm({
      title: "批量检测资源站",
      message: `确定要批量检测全部 ${total} 个资源站吗？`,
      confirmText: "开始检测",
      onConfirm: startBatchProbe,
    });
  };

  const handleAddSite = (name: string, baseUrl: string) => {
    createSite({ name, base_url: baseUrl, enabled: true, sort: 0 })
      .then(() => {
        setShowAdd(false);
        refreshSites();
        toastSuccess("站点已添加");
      })
      .catch((error) => {
        toastError(`添加站点失败：${errorMessage(error, "请稍后重试")}`);
      });
  };

  const handleExport = () => {
    exportSites()
      .then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `sites-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        toastSuccess("站点配置已导出");
      })
      .catch((error) => {
        toastError(`导出站点失败：${errorMessage(error, "请稍后重试")}`);
      });
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<SiteExportOut>;
        if (!Array.isArray(parsed.sites)) {
          throw new Error("文件格式错误：缺少 sites 数组");
        }
        const payload = parsed.sites;
        askConfirm({
          title: "导入站点",
          message: "同名或同地址的站点将被跳过，确定导入吗？",
          confirmText: "导入",
          onConfirm: () => {
            importSites(payload)
              .then((result) => {
                const parts: string[] = [];
                if (result.created) parts.push(`新建 ${result.created} 个`);
                if (result.updated) parts.push(`更新 ${result.updated} 个`);
                if (result.skipped) parts.push(`跳过 ${result.skipped} 个`);
                if (result.errors.length) parts.push(`失败 ${result.errors.length} 个`);
                toastSuccess(parts.length ? parts.join("，") : "导入完成");
                refreshSites();
              })
              .catch((error) => {
                toastError(`导入站点失败：${errorMessage(error, "请稍后重试")}`);
              });
          },
        });
      } catch (error) {
        toastError(error instanceof Error ? error.message : "文件解析失败");
      }
    };
    reader.onerror = () => toastError("读取文件失败");
    reader.readAsText(file);
  };

  const handleSpeedChange = (value: Speed) => {
    setSpeed(value);
    try {
      localStorage.setItem("ht-cleanup-speed", value);
    } catch {
      /* ignore */
    }
  };

  const mobileActions: ActionSheetAction[] = [
    {
      key: "probe",
      label: probeBusy
        ? `批量检测（${probeProgress.done}/${probeProgress.total}）`
        : "批量检测",
      onClick: () => {
        setShowMobileMore(false);
        askBatchProbe();
      },
    },
    {
      key: "sniff",
      label: "批量嗅探",
      onClick: () => {
        setShowMobileMore(false);
        setShowSniff(true);
      },
    },
    {
      key: "import",
      label: "导入站点",
      onClick: () => {
        setShowMobileMore(false);
        fileInputRef.current?.click();
      },
    },
    {
      key: "export",
      label: "导出站点",
      onClick: () => {
        setShowMobileMore(false);
        handleExport();
      },
    },
  ];

  const filterDefinitions: { key: SiteFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "attention", label: "需关注" },
    { key: "active", label: "任务中" },
    { key: "disabled", label: "已禁用" },
  ];

  return (
    <>
      <div className="ops-page">
        <div className="ops-header">
          <div>
            <h1 className="ops-title">运维</h1>
            <div className="ops-sub">
              {statsQuery.isLoading
                ? "正在加载统计…"
                : statsQuery.isError
                  ? "数据暂不可用"
                  : `统计于 ${formatShortTime(statsQuery.data?.computed_at)}`}
            </div>
          </div>
          <div className="ops-header-actions">
            <button
              type="button"
              className="ops-refresh"
              aria-label="刷新统计"
              title="刷新统计"
              onClick={refreshAll}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        <StatBar
          stats={statsQuery.data}
          loading={statsQuery.isLoading}
          error={statsQuery.isError}
          onRetry={() => void statsQuery.refetch()}
        />

        {!statsQuery.isError && (
          <TrendPanel
            history={statsQuery.data?.history}
            loading={statsQuery.isLoading}
          />
        )}

        <div className="ops-actions">
          <button
            type="button"
            className="btn btn-primary ops-action-primary"
            disabled={
              sitesUnavailable || Boolean(fillActive) || startingKind === "detail.fill"
            }
            title={sitesUnavailable ? "请先添加采集站" : undefined}
            onClick={() => startJob("detail.fill")}
          >
            {fillActive || startingKind === "detail.fill"
              ? "全站补全中…"
              : "全站补全 videolist"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              sitesUnavailable ||
              Boolean(fullActive) ||
              startingKind === "crawl.full"
            }
            title={sitesUnavailable ? "请先添加采集站" : undefined}
            onClick={askFullCrawl}
          >
            {fullActive || startingKind === "crawl.full"
              ? "全量刮削中…"
              : "全量刮削"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={
              sitesUnavailable ||
              Boolean(cleanupActive) ||
              startingKind === "cache.cleanup"
            }
            title={sitesUnavailable ? "请先添加采集站" : undefined}
            onClick={askCleanup}
          >
            {cleanupActive || startingKind === "cache.cleanup"
              ? "清理进行中…"
              : "清除失效资源"}
          </button>
          <div className="ops-speed">
            <span>清理速度</span>
            <select
              className="ops-select"
              aria-label="清理速度"
              value={speed}
              disabled={sitesUnavailable || Boolean(cleanupActive)}
              onChange={(event) =>
                handleSpeedChange(event.target.value as Speed)
              }
            >
              <option value="eco">省流</option>
              <option value="normal">标准</option>
              <option value="fast">快速</option>
            </select>
          </div>
        </div>

        {activeJobs.length > 0 && (
          <div aria-live="polite">
            {activeJobs.slice(0, 2).map((job) => {
              const site =
                job.site_id != null ? statusById.get(job.site_id) : undefined;
              const label = site?.site_name ?? (job.site_id != null ? `站点${job.site_id}` : "全部站点");
              const total = job.progress_total || 0;
              const done = job.progress_completed || 0;
              const known = total > 0;
              return (
                <div className="ops-active" key={job.id}>
                  <span className="ops-active-dot" />
                  <div className="ops-active-main">
                    <span className="ops-active-title">
                      {kindLabel(job.kind)} · {label}
                    </span>
                    <span className="ops-active-meta">
                      {job.trigger === "scheduled" ? "定时" : job.trigger === "manual" ? "手动" : job.trigger} ·{" "}
                      {formatShortTime(job.created_at)} 开始
                      {known ? ` · ${done} / ${total}` : " · 扫描中"}
                    </span>
                  </div>
                  {known && (
                    <span className="ops-active-num">
                      {done} / {total}
                    </span>
                  )}
                  <div
                    className={`ops-active-bar${known ? "" : " is-indeterminate"}`}
                  >
                    <i
                      style={
                        known
                          ? { width: `${Math.min(100, (done / total) * 100)}%` }
                          : undefined
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={cancellingId === job.id}
                    onClick={() => askCancel(job)}
                  >
                    {cancellingId === job.id ? "取消中…" : "取消"}
                  </button>
                </div>
              );
            })}
            {activeJobs.length > 2 && (
              <div className="ops-active-meta" style={{ padding: "0 2px 12px" }}>
                +{activeJobs.length - 2} 个任务
              </div>
            )}
          </div>
        )}

        <div className="ops-toolbar">
          <div className="ops-toolbar-left">
            <span className="ops-toolbar-title">采集站</span>
            <span className="ops-toolbar-count">
              {sitesLoading ? "—" : formatNumber(counts.all)}
            </span>
            <div className="ops-filters" role="group" aria-label="筛选站点">
              {filterDefinitions.map((definition) => (
                <button
                  key={definition.key}
                  type="button"
                  className="ops-chip"
                  aria-pressed={filter === definition.key}
                  disabled={sitesUnavailable}
                  onClick={() => setFilter(definition.key)}
                >
                  {definition.label}
                  <span className="ops-chip-n">{counts[definition.key]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ops-toolbar-right">
            <label className="ops-sort">
              <span className="ops-sort-label">排序</span>
              <select
                className="ops-select"
                aria-label="站点排序"
                value={sort}
                disabled={sitesUnavailable}
                onChange={(event) => setSort(event.target.value as SiteSort)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ops-tool-btn"
              disabled={sitesUnavailable || probeBusy}
              onClick={askBatchProbe}
            >
              <ActivityIcon />
              {probeBusy
                ? `检测中 ${probeProgress.done}/${probeProgress.total}`
                : "批量检测"}
            </button>
            <button
              type="button"
              className="ops-tool-btn"
              disabled={sitesUnavailable}
              onClick={() => setShowSniff(true)}
            >
              <RadarIcon />
              批量嗅探
            </button>
            <button
              type="button"
              className="ops-tool-btn"
              disabled={sitesUnavailable}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon />
              导入
            </button>
            <button
              type="button"
              className="ops-tool-btn"
              disabled={sitesUnavailable}
              onClick={handleExport}
            >
              <DownloadIcon />
              导出
            </button>
            <button
              type="button"
              className="btn ops-add-site"
              disabled={sitesLoading || sitesError}
              onClick={() => setShowAdd(true)}
            >
              <PlusIcon />
              <span className="ops-add-label">添加站点</span>
            </button>
            <button
              type="button"
              className="ops-icon-btn ops-more"
              aria-label="更多站点操作"
              title="更多站点操作"
              onClick={() => setShowMobileMore(true)}
            >
              <MoreIcon />
            </button>
          </div>
        </div>

        {sitesError ? (
          <div className="ops-error" role="alert">
            <strong>站点状态加载失败</strong>
            <span>总览接口没有返回数据</span>
            <button
              type="button"
              className="ops-text-btn"
              onClick={() => {
                void sitesQuery.refetch();
                void queryClient.invalidateQueries({
                  queryKey: MAINTENANCE_OVERVIEW_KEY,
                });
              }}
            >
              重试
            </button>
          </div>
        ) : sitesLoading ? (
          <SiteCardsSkeleton />
        ) : statuses.length === 0 ? (
          <div className="ops-empty">
            <span className="ops-empty-icon">
              <ServerIcon />
            </span>
            <div className="ops-empty-title">还没有采集站</div>
            <div className="ops-empty-copy">
              添加一个 AppleCMS 资源站后，这里会显示它的健康、补全进度与最近刮削。
            </div>
            <div className="ops-empty-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowAdd(true)}
              >
                添加站点
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowSniff(true)}
              >
                批量嗅探
              </button>
            </div>
          </div>
        ) : filteredSites.length === 0 ? (
          <div className="ops-filter-empty">
            没有符合筛选的站点{" "}
            <button
              type="button"
              className="ops-text-btn"
              onClick={() => setFilter("all")}
            >
              查看全部
            </button>
          </div>
        ) : (
          <div className="ops-grid">
            {filteredSites.map((site) => (
              <SiteCard
                key={site.site_id}
                site={site}
                job={activeJobFor(site.site_id, jobs)}
                deleting={deletingIds.has(site.site_id)}
                onOpen={() => setSheetSiteId(site.site_id)}
              />
            ))}
          </div>
        )}

        <TaskRecords
          jobs={jobsList}
          sites={statuses}
          loading={jobsLoading}
          error={jobsError}
          onCancel={askCancel}
        />
        <CrawlLogs />
      </div>

      <SiteOpsSheet
        site={sheetSite}
        status={sheetStatus}
        jobs={jobsList}
        startingKind={startingKind}
        onClose={() => setSheetSiteId(null)}
        onStart={(kind) => {
          if (sheetSiteId != null) startJob(kind, sheetSiteId);
        }}
        onCancelJob={askCancel}
        onRequestDelete={beginDelete}
        onRefresh={refreshSites}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmText={confirm?.confirmText}
        danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const next = confirm;
          setConfirm(null);
          next?.onConfirm();
        }}
      />

      <AddSiteDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onConfirm={handleAddSite}
      />
      <BatchSniffDialog
        open={showSniff}
        onClose={() => setShowSniff(false)}
        onAdded={refreshSites}
      />
      <ActionSheet
        open={showMobileMore}
        title="更多站点操作"
        actions={mobileActions}
        onClose={() => setShowMobileMore(false)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFile}
        style={{ display: "none" }}
      />
    </>
  );
}
