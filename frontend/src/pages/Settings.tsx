import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listSites,
  createSite,
  deleteSite,
  updateSite,
  probeSitesBatch,
  exportSites,
  importSites,
} from "../api/sites";
import {
  cancelCleanupExpired,
  getCleanupStatus,
  startCleanupExpired,
  getCrawlerLogs,
  getCrawlerStats,
  triggerFullCrawl,
  triggerIncremental,
  type CleanupSpeed,
  type CleanupStatus,
} from "../api/videos";
import { onSseEvent } from "../api/sse";
import { toastSuccess, toastError } from "../utils/toast";
import AliasSettings from "../components/category-settings/AliasSettings";
import CategoryStructure from "../components/category-settings/CategoryStructure";
import CategoryWorkbench from "../components/category-settings/CategoryWorkbench";
import SiteHealthDrawer from "../components/SiteHealthDrawer";
import AddSiteDialog from "../components/AddSiteDialog";
import BatchSniffDialog from "../components/BatchSniffDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import DownloadSettings from "../components/DownloadSettings";
import type { CrawlerLog, CrawlerStatsResponse, ProbeResult, Site, SiteProbeResult } from "../types";

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ActivityIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function ServerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

/** 把秒数写成「12 分钟 / 1 小时 20 分」 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TagIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

type TabKey = "sites" | "categories" | "download" | "logs";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "sites", label: "采集站管理", icon: <ServerIcon size={14} /> },
  { key: "categories", label: "分类设置", icon: <TagIcon size={14} /> },
  { key: "download", label: "下载设置", icon: <FolderIcon size={14} /> },
  { key: "logs", label: "刮削日志", icon: <ActivityIcon size={14} /> },
];

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 4,
  border: "1px solid var(--glass-border)",
  background: "var(--tint-soft)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

export default function Settings() {
  // 当前 tab 由 URL 决定（?tab=categories），便于分享链接与深链
  const [searchParams, setSearchParams] = useSearchParams();
  // 分类映射只在桌面端配置：移动端复用了这个页面，需要按视口收口
  const isMobileView =
    typeof window !== "undefined" &&
    (window.innerWidth < 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent));
  const [categoryView, setCategoryView] = useState<
    "workbench" | "structure" | "advanced"
  >("workbench");
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = TABS.some((t) => t.key === tabParam)
    ? (tabParam as TabKey)
    : "sites";
  const setActiveTab = (key: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };
  const [sites, setSites] = useState<Site[]>([]);
  const [probeResults, setProbeResults] = useState<
    Record<number, ProbeResult>
  >({});
  const [crawlerLogs, setCrawlerLogs] = useState<CrawlerLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [crawlerStats, setCrawlerStats] = useState<CrawlerStatsResponse | null>(null);
  const [triggeringFull, setTriggeringFull] = useState(false);
  const [triggeringIncremental, setTriggeringIncremental] = useState<Record<number, boolean>>({});
  const [cleanupStatus, setCleanupStatus] = useState<CleanupStatus | null>(null);
  const [cleanupSpeed, setCleanupSpeed] = useState<CleanupSpeed>(() => {
    const saved = localStorage.getItem("ht-cleanup-speed");
    return saved === "normal" || saved === "fast" ? saved : "eco";
  });
  const [cleanupStarting, setCleanupStarting] = useState(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupWasRunning = useRef(false);

  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current) clearInterval(cleanupTimerRef.current);
    };
  }, []);
  const [drawerSite, setDrawerSite] = useState<Site | null>(null);

  /* ---- inline edit states ---- */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [deletingSiteIds, setDeletingSiteIds] = useState<Set<number>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBatchSniffDialog, setShowBatchSniffDialog] = useState(false);

  /* ---- batch detect existing sites state ---- */
  const [batchDetectLoading, setBatchDetectLoading] = useState(false);
  const [showBatchDetectDialog, setShowBatchDetectDialog] = useState(false);

  /* ---- import / export state ---- */
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listSites().then(setSites).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      setLogsLoading(true);
      getCrawlerLogs()
        .then((res) => setCrawlerLogs(res.logs))
        .catch(() => setCrawlerLogs([]))
        .finally(() => setLogsLoading(false));

      getCrawlerStats()
        .then((res) => setCrawlerStats(res))
        .catch(() => setCrawlerStats(null));
    }
  }, [activeTab]);

  useEffect(() => {
    const unsubscribe = onSseEvent<{
      site_id: number;
      status: string;
      progress: number;
      message: string;
    }>("site_delete_progress", (data) => {
      if (!data || typeof data.site_id !== "number") return;
      if (data.status === "completed") {
        setDeletingSiteIds((prev) => {
          const next = new Set(prev);
          next.delete(data.site_id);
          return next;
        });
        setSites((prev) => prev.filter((s) => s.id !== data.site_id));
        toastSuccess(data.message || "站点删除完成");
      } else if (data.status === "failed") {
        setDeletingSiteIds((prev) => {
          const next = new Set(prev);
          next.delete(data.site_id);
          return next;
        });
        toastError(data.message || "站点删除失败");
        listSites().then(setSites).catch(() => {});
      }
    });
    return () => unsubscribe();
  }, []);

  /* ---- 清除失效资源：后台任务 + 进度轮询 ---- */
  const stopCleanupPolling = () => {
    if (cleanupTimerRef.current) {
      clearInterval(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
  };

  const applyCleanupStatus = (status: CleanupStatus) => {
    setCleanupStatus(status);
    const wasRunning = cleanupWasRunning.current;
    cleanupWasRunning.current = status.running;
    if (status.running) return;
    stopCleanupPolling();
    if (!wasRunning) return;
    if (status.error) {
      toastError(`清理失败：${status.error}`);
    } else if (status.dry_run) {
      toastSuccess(
        `演练完成：检查 ${status.checked} 条，待删除 ${status.deleted} 条（未真正删除）`
      );
    } else {
      toastSuccess(
        `清理完成：检查 ${status.checked} 条，删除 ${status.deleted} 条，待确认 ${status.pending} 条`
      );
    }
  };

  const startCleanupPolling = () => {
    stopCleanupPolling();
    cleanupTimerRef.current = setInterval(() => {
      getCleanupStatus()
        .then(applyCleanupStatus)
        .catch(() => {
          // 单次失败忽略，下一轮继续；后端重启后任务会变成 idle
        });
    }, 2000);
  };

  // 进入页面时如果任务还在跑，直接接管进度条
  useEffect(() => {
    getCleanupStatus()
      .then((status) => {
        applyCleanupStatus(status);
        if (status.running) startCleanupPolling();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCleanupExpired = () => {
    if (!confirm("确定要清除失效资源吗？会后台扫完全部站点的缓存，连续两轮都没被资源站返回的条目才会删除，整个过程可能需要约 1 小时。")) return;
    if (cleanupStarting) return;
    setCleanupStarting(true);

    // ?cleanup_dry_run=1 时不真正删除，用于验证任务链路
    const dryRun =
      new URLSearchParams(window.location.search).get("cleanup_dry_run") === "1";
    startCleanupExpired(undefined, dryRun, cleanupSpeed)
      .then((status) => {
        cleanupWasRunning.current = true;
        applyCleanupStatus({ ...status, running: true });
        startCleanupPolling();
      })
      .catch(() => toastError("启动清理任务失败"))
      .finally(() => setCleanupStarting(false));
  };

  const handleCancelCleanup = () => {
    cancelCleanupExpired()
      .then(applyCleanupStatus)
      .catch(() => toastError("停止清理失败"));
  };

  /* ---- add site (inline) ---- */
  const handleAddSite = (name: string, base_url: string) => {
    createSite({ name, base_url, enabled: true, sort: 0 })
      .then((s) => {
        setSites((prev) => [...prev, s]);
        setShowAddDialog(false);
      })
      .catch(() => toastError("添加站点失败"));
  };

  /* ---- edit site (inline) ---- */
  const startEdit = (site: Site) => {
    setEditingId(site.id);
    setEditName(site.name);
    setEditUrl(site.base_url);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditUrl("");
  };
  const confirmEdit = (site: Site) => {
    const name = editName.trim();
    const base_url = editUrl.trim();
    if (!name || !base_url) return;
    if (name === site.name && base_url === site.base_url) {
      cancelEdit();
      return;
    }
    updateSite(site.id, { name, base_url })
      .then(() => {
        listSites().then(setSites).catch(() => {});
        cancelEdit();
      })
      .catch(() => toastError("更新站点失败"));
  };

  const handleBatchDetect = () => {
    if (sites.length === 0) return;
    setShowBatchDetectDialog(true);
  };

  const confirmBatchDetect = () => {
    setShowBatchDetectDialog(false);
    setBatchDetectLoading(true);
    probeSitesBatch()
      .then((results) => {
        const next: Record<number, ProbeResult> = {};
        results.forEach((r: SiteProbeResult) => {
          next[r.site_id] = { ok: r.ok, latency_ms: r.latency_ms, error: r.error };
        });
        setProbeResults((prev) => ({ ...prev, ...next }));
      })
      .catch(() => alert("批量检测失败"))
      .finally(() => setBatchDetectLoading(false));
  };

  const handleExportSites = () => {
    setExporting(true);
    exportSites()
      .then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `sites-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toastSuccess("站点配置已导出");
      })
      .catch(() => toastError("导出站点失败"))
      .finally(() => setExporting(false));
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm("确定要导入所选文件吗？同名或同地址的站点将被跳过。")) {
      e.target.value = "";
      return;
    }

    setImporting(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.sites)) {
          throw new Error("文件格式错误：缺少 sites 数组");
        }
        importSites(parsed.sites)
          .then((res) => {
            const parts: string[] = [];
            if (res.created) parts.push(`新建 ${res.created} 个`);
            if (res.updated) parts.push(`更新 ${res.updated} 个`);
            if (res.skipped) parts.push(`跳过 ${res.skipped} 个`);
            if (res.errors.length) parts.push(`失败 ${res.errors.length} 个`);
            toastSuccess(parts.length ? parts.join("，") : "导入完成");
            listSites().then(setSites).catch(() => {});
          })
          .catch(() => toastError("导入站点失败"))
          .finally(() => setImporting(false));
      } catch (err) {
        toastError(err instanceof Error ? err.message : "文件解析失败");
        setImporting(false);
      }
    };
    reader.onerror = () => {
      toastError("读取文件失败");
      setImporting(false);
    };
    reader.readAsText(file);
    e.target.value = "";
  };


  const rowBaseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: "var(--tint-soft)",
    borderRadius: 4,
    transition: "background-color 150ms ease, border-color 150ms ease",
  };

  return (
    <div className="col settings-form" style={{ gap: 20 }}>
      <style>{`
        @media (max-width: 767px) {
          .settings-tab-bar .tab-label {
            display: none;
          }
          .site-row {
            flex-wrap: wrap;
            align-items: flex-start;
          }
          .site-row .site-info {
            flex: 1;
            min-width: 0;
          }
          .site-row .site-actions {
            width: 100%;
            justify-content: flex-end;
            margin-top: 10px;
          }
        }
      `}</style>

      {/* Tab 菜单 */}
      <div
        className="row settings-tab-bar"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--glass-border)",
          borderRadius: 10,
          padding: 6,
          gap: 4,
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              data-tab={t.key}
              className={active ? "btn btn-primary" : "btn"}
              onClick={() => setActiveTab(t.key)}
              style={{
                flex: 1,
                justifyContent: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                minHeight: 40,
              }}
            >
              {t.icon}
              <span className="tab-label">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* 采集站管理 */}
      {activeTab === "sites" && (
        <section
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--glass-border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div
            className="row"
            style={{
              gap: 8,
              marginBottom: 16,
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)" }}>
                <ServerIcon size={16} />
              </span>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                }}
              >
                采集站管理
              </h3>
            </div>
            <div className="row" style={{ gap: 4, alignItems: "center" }}>
              <button
                className="btn"
                onClick={handleExportSites}
                disabled={exporting || sites.length === 0}
                style={{ fontSize: 12, gap: 4, minHeight: 34, padding: "0 12px" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exporting ? "导出中..." : "导出站点"}
              </button>
              <button
                className="btn"
                onClick={handleImportClick}
                disabled={importing}
                style={{ fontSize: 12, gap: 4, minHeight: 34, padding: "0 12px" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {importing ? "导入中..." : "导入站点"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                style={{ display: "none" }}
              />
              {sites.length > 0 && (
                <button
                  className="btn"
                  onClick={handleBatchDetect}
                  disabled={batchDetectLoading}
                  style={{ fontSize: 12, gap: 4, minHeight: 34, padding: "0 12px" }}
                >
                  {batchDetectLoading ? (
                    <span style={{ color: "var(--text-muted)" }}>检测中...</span>
                  ) : (
                    <>
                      <ActivityIcon size={14} />
                      批量检测
                    </>
                  )}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => setShowAddDialog(true)}
                style={{ gap: 4, fontSize: 12, minHeight: 34, padding: "0 12px" }}
              >
                <PlusIcon size={14} />
                添加站点
              </button>
              <button
                className="btn"
                onClick={() => setShowBatchSniffDialog(true)}
                style={{ gap: 4, fontSize: 12, minHeight: 34, padding: "0 12px" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                批量嗅探
              </button>
            </div>
          </div>

          <div className="col" style={{ gap: 10 }}>
            {sites.length === 0 && (
              <div
                className="empty"
                style={{
                  padding: 32,
                  background: "var(--tint-soft)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <ServerIcon size={32} />
                <p style={{ marginTop: 8 }}>暂无采集站，请添加资源站点</p>
              </div>
            )}

            {sites.map((s) => {
              const isEditing = editingId === s.id;
              return (
                <div
                  key={s.id}
                  className="site-row"
                  style={{
                    ...rowBaseStyle,
                    border: s.enabled
                      ? "1px solid transparent"
                      : "1px solid var(--glass-border)",
                    opacity: s.enabled ? 1 : 0.55,
                    cursor: isEditing ? "default" : "pointer",
                  }}
                  onClick={() => {
                    if (!isEditing) setDrawerSite(s);
                  }}
                  onMouseEnter={(e) => {
                    if (s.enabled && !isEditing) {
                      e.currentTarget.style.backgroundColor = "var(--tint-soft)";
                      e.currentTarget.style.borderColor = "var(--glass-border)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--tint-soft)";
                    e.currentTarget.style.borderColor = s.enabled
                      ? "transparent"
                      : "var(--glass-border)";
                  }}
                >
                  {/* 状态指示 */}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: s.enabled
                        ? "var(--success)"
                        : "var(--text-secondary)",
                      flexShrink: 0,
                    }}
                    title={s.enabled ? "已启用" : "已禁用"}
                  />

                  {/* 信息 / 编辑表单 */}
                  <div className="site-info" style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <div className="col" style={{ gap: 8 }}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="站点名称"
                          style={{ ...inputStyle, width: "100%" }}
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          placeholder="站点地址（如 http://xxx.php）"
                          style={{ ...inputStyle, width: "100%" }}
                        />
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {s.name}
                          {!s.enabled && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: "var(--glass-border)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              已禁用
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.55,
                            marginTop: 2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={s.base_url}
                        >
                          {s.base_url}
                        </div>
                        {probeResults[s.id] && (
                          <div
                            className="row"
                            style={{
                              gap: 4,
                              fontSize: 12,
                              marginTop: 4,
                              color: probeResults[s.id].ok
                                ? "var(--success)"
                                : "var(--danger)",
                            }}
                          >
                            {probeResults[s.id].ok ? (
                              <>
                                <CheckIcon size={12} />
                                <span>{probeResults[s.id].latency_ms}ms</span>
                              </>
                            ) : (
                              <>
                                <XIcon size={12} />
                                <span>{probeResults[s.id].error}</span>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div
                    className="row site-actions"
                    style={{ gap: 6, flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isEditing ? (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() => confirmEdit(s)}
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                          }}
                        >
                          保存
                        </button>
                        <button
                          className="btn"
                          onClick={cancelEdit}
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        {s.enabled && (
                          <button
                            className="btn"
                            disabled={triggeringIncremental[s.id]}
                            onClick={() => {
                              setTriggeringIncremental((prev) => ({
                                ...prev,
                                [s.id]: true,
                              }));
                              triggerIncremental(s.id)
                                .then(() =>
                                  alert(`站点 ${s.name} 增量更新已启动`)
                                )
                                .catch(() => alert("启动失败"))
                                .finally(() =>
                                  setTriggeringIncremental((prev) => ({
                                    ...prev,
                                    [s.id]: false,
                                  }))
                                );
                            }}
                            title="增量刮削"
                            style={{
                              padding: "8px 14px",
                              minHeight: 40,
                              fontSize: 12,
                            }}
                          >
                            <ActivityIcon size={12} />
                            {triggeringIncremental[s.id]
                              ? "启动中..."
                              : "增量"}
                          </button>
                        )}
                        <button
                          className="btn"
                          onClick={() => startEdit(s)}
                          title="编辑"
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            if (deletingSiteIds.has(s.id)) return;
                            setDeletingSiteIds((prev) => new Set(prev).add(s.id));
                            deleteSite(s.id).catch(() => {
                              setDeletingSiteIds((prev) => {
                                const next = new Set(prev);
                                next.delete(s.id);
                                return next;
                              });
                            });
                          }}
                          title="删除"
                          disabled={deletingSiteIds.has(s.id)}
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                            color: "var(--danger)",
                            opacity: deletingSiteIds.has(s.id) ? 0.6 : 1,
                          }}
                        >
                          {deletingSiteIds.has(s.id) ? "删除中..." : "删除"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 分类设置 */}
      {activeTab === "categories" && (
        <section
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--glass-border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            <span style={{ color: "var(--primary)" }}>
              <TagIcon size={16} />
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                textShadow: "0 0 12px var(--primary-glow)",
                letterSpacing: 0.3,
              }}
            >
              分类设置
            </h3>
          </div>

          {isMobileView ? (
            <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-secondary)" }}>
              分类映射只在桌面端配置。移动端会直接使用已配置好的分类，不需要在这里操作。
            </div>
          ) : (
            <>
              <div className="row settings-tab-bar" style={{ gap: 6, marginBottom: 14 }}>
                {(
                  [
                    { key: "workbench", label: "映射工作台" },
                    { key: "structure", label: "分类结构" },
                    { key: "advanced", label: "别名与例外（高级）" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`btn${categoryView === item.key ? " btn-primary" : ""}`}
                    onClick={() => setCategoryView(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {categoryView === "workbench" && <CategoryWorkbench />}
              {categoryView === "structure" && <CategoryStructure />}
              {categoryView === "advanced" && <AliasSettings />}
            </>
          )}
        </section>
      )}

      {/* 下载设置 */}
      {activeTab === "download" && <DownloadSettings />}

      {/* 刮削日志 */}
      {activeTab === "logs" && (
        <section
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--glass-border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div
            className="row"
            style={{
              gap: 8,
              marginBottom: 16,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--primary)" }}>
                <ActivityIcon size={16} />
              </span>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  textShadow: "0 0 12px var(--primary-glow)",
                  letterSpacing: 0.3,
                }}
              >
                刮削日志
              </h3>
            </div>
            {crawlerStats?.last_updated_at && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                最近更新{" "}
                {new Date(crawlerStats.last_updated_at).toLocaleString("zh-CN")}
              </span>
            )}
          </div>

          {/* 手动触发刮削 */}
          <div
            className="row"
            style={{
              gap: 12,
              marginBottom: 20,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              className="btn btn-primary"
              disabled={triggeringFull}
              onClick={() => {
                if (!confirm("确定要重新全量刮削吗？这会遍历所有站点的所有分类，预计耗时 20-40 分钟。")) return;
                setTriggeringFull(true);
                triggerFullCrawl()
                  .then(() => alert("全量刮削已启动"))
                  .catch(() => alert("启动失败"))
                  .finally(() => setTriggeringFull(false));
              }}
              style={{ gap: 6 }}
            >
              <ActivityIcon size={14} />
              {triggeringFull ? "启动中..." : "重新全量刮削"}
            </button>
            <select
              className="cleanup-speed"
              value={cleanupSpeed}
              disabled={Boolean(cleanupStatus?.running)}
              onChange={(event) => {
                const next = event.target.value as CleanupSpeed;
                setCleanupSpeed(next);
                try {
                  localStorage.setItem("ht-cleanup-speed", next);
                } catch {
                  // 隐私模式下写入失败可忽略
                }
              }}
              title="速度越慢，对资源站和自家带宽的压力越小"
              aria-label="清理速度"
            >
              <option value="eco">省流</option>
              <option value="normal">标准</option>
              <option value="fast">快速</option>
            </select>
            {cleanupStatus?.running ? (
              <div className="cleanup-progress">
                <div className="cleanup-progress-track">
                  <i style={{ width: `${Math.min(cleanupStatus.percent ?? 0, 100)}%` }} />
                </div>
                <div className="cleanup-progress-meta">
                  <b>
                    {(cleanupStatus.percent ?? 0) < 10
                      ? (cleanupStatus.percent ?? 0).toFixed(1)
                      : Math.round(cleanupStatus.percent ?? 0)}
                    %
                  </b>
                  <span>
                    {(cleanupStatus.total ?? 0) > 0
                      ? `${cleanupStatus.checked.toLocaleString()} / ${(cleanupStatus.total ?? 0).toLocaleString()}`
                      : "正在统计总量…"}
                  </span>
                  {cleanupStatus.speed && (
                    <span>
                      {cleanupStatus.speed === "eco"
                        ? "省流"
                        : cleanupStatus.speed === "normal"
                        ? "标准"
                        : "快速"}
                      模式
                    </span>
                  )}
                  {cleanupStatus.current_site && (
                    <span className="cleanup-progress-site">
                      正在检查 {cleanupStatus.current_site.name}
                    </span>
                  )}
                  {cleanupStatus.deleted > 0 && (
                    <span>已删 {cleanupStatus.deleted.toLocaleString()}</span>
                  )}
                  {cleanupStatus.pending > 0 && (
                    <span>待确认 {cleanupStatus.pending.toLocaleString()}</span>
                  )}
                  {cleanupStatus.eta_seconds != null && cleanupStatus.eta_seconds > 0 && (
                    <span>剩余约 {formatDuration(cleanupStatus.eta_seconds)}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="cleanup-progress-stop"
                  onClick={handleCancelCleanup}
                >
                  停止
                </button>
              </div>
            ) : (
              <button
                className="btn"
                disabled={cleanupStarting}
                onClick={handleCleanupExpired}
                style={{ gap: 6, color: "var(--danger)", borderColor: "var(--danger)" }}
              >
                <TrashIcon size={14} />
                {cleanupStarting ? "启动中..." : "清除失效资源"}
              </button>
            )}
          </div>

          {logsLoading ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              加载中...
            </div>
          ) : crawlerLogs.length === 0 ? (
            <div
              className="empty"
              style={{
                padding: 32,
                background: "var(--tint-soft)",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <ActivityIcon size={32} />
              <p style={{ marginTop: 8 }}>暂无刮削记录</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <div
                className="col"
                style={{
                  gap: 8,
                  minWidth: 720,
                }}
              >
                {/* 表头 */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(140px, 1.6fr) minmax(70px, 0.9fr) minmax(70px, 0.9fr) minmax(50px, 0.6fr) minmax(60px, 0.7fr) minmax(55px, 0.6fr) minmax(55px, 0.6fr) minmax(55px, 0.6fr) minmax(65px, 0.7fr)",
                    gap: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    borderBottom: "1px solid var(--glass-border)",
                    alignItems: "center",
                  }}
                >
                  <span>时间</span>
                  <span>站点</span>
                  <span>分类</span>
                  <span>页码</span>
                  <span>类型</span>
                  <span style={{ textAlign: "right" }}>处理</span>
                  <span style={{ textAlign: "right" }}>新增</span>
                  <span style={{ textAlign: "right" }}>更新</span>
                  <span style={{ textAlign: "right" }}>耗时</span>
                </div>
                {/* 日志行 */}
                {crawlerLogs.map((log, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(140px, 1.6fr) minmax(70px, 0.9fr) minmax(70px, 0.9fr) minmax(50px, 0.6fr) minmax(60px, 0.7fr) minmax(55px, 0.6fr) minmax(55px, 0.6fr) minmax(55px, 0.6fr) minmax(65px, 0.7fr)",
                      gap: 8,
                      padding: "8px 12px",
                      fontSize: 12,
                      background:
                        idx % 2 === 0 ? "transparent" : "var(--tint-soft)",
                      borderRadius: 4,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {new Date(log.timestamp).toLocaleString("zh-CN")}
                    </span>
                    <span
                      style={{
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {log.site_name}
                    </span>
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {log.category}
                    </span>
                    <span>{log.page}</span>
                    <span>
                      {log.crawl_type === "full" ? "全量" : "增量"}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                      }}
                    >
                      {log.items_count}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color:
                          log.new_count > 0
                            ? "var(--primary)"
                            : "var(--text-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {log.new_count}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color:
                          log.update_count > 0
                            ? "var(--text-primary)"
                            : "var(--text-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {log.update_count}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {log.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <SiteHealthDrawer
        site={drawerSite}
        open={drawerSite !== null}
        onClose={() => setDrawerSite(null)}
        onSiteChange={(changed) =>
          setSites((prev) =>
            prev.map((s) => (s.id === changed.id ? changed : s))
          )
        }
      />

      <AddSiteDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConfirm={handleAddSite}
      />

      <BatchSniffDialog
        open={showBatchSniffDialog}
        onClose={() => setShowBatchSniffDialog(false)}
        onAdded={() => listSites().then(setSites)}
      />

      <ConfirmDialog
        open={showBatchDetectDialog}
        title="批量检测资源站"
        message={`确定要批量检测全部 ${sites.length} 个资源站吗？`}
        confirmText="开始检测"
        cancelText="取消"
        onConfirm={confirmBatchDetect}
        onCancel={() => setShowBatchDetectDialog(false)}
      />
    </div>
  );
}
