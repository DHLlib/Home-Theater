import { useEffect, useState } from "react";
import {
  listSites,
  createSite,
  deleteSite,
  updateSite,
  probeSitesBatch,
} from "../api/sites";
import {
  getDownloadRoot,
  setDownloadRoot,
  getMaxConcurrentDownloads,
  setMaxConcurrentDownloads,
  getAdFilterEnabled,
  setAdFilterEnabled,
} from "../api/settings";
import { cleanupExpired, getCrawlerLogs, getCrawlerStats, triggerFullCrawl, triggerIncremental } from "../api/videos";
import { onSseEvent } from "../api/sse";
import { toastSuccess, toastError } from "../utils/toast";
import CategorySettings from "../components/category-settings/CategorySettings";
import SiteHealthDrawer from "../components/SiteHealthDrawer";
import AddSiteDialog from "../components/AddSiteDialog";
import BatchSniffDialog from "../components/BatchSniffDialog";
import ConfirmDialog from "../components/ConfirmDialog";
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
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabKey>("sites");
  const [sites, setSites] = useState<Site[]>([]);
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState<string | null>(null);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [savedMaxConcurrent, setSavedMaxConcurrent] = useState(10);
  const [adFilter, setAdFilter] = useState(false);
  const [savedAdFilter, setSavedAdFilter] = useState(false);
  const [probeResults, setProbeResults] = useState<
    Record<number, ProbeResult>
  >({});
  const [crawlerLogs, setCrawlerLogs] = useState<CrawlerLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [crawlerStats, setCrawlerStats] = useState<CrawlerStatsResponse | null>(null);
  const [triggeringFull, setTriggeringFull] = useState(false);
  const [triggeringIncremental, setTriggeringIncremental] = useState<Record<number, boolean>>({});
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; checked: number } | null>(null);
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

  useEffect(() => {
    listSites().then(setSites);
    getDownloadRoot().then((r) => {
      setSavedRoot(r);
      if (r) setRoot(r);
    });
    getMaxConcurrentDownloads().then((v) => {
      setSavedMaxConcurrent(v);
      setMaxConcurrent(v);
    });
    getAdFilterEnabled().then((v) => {
      setSavedAdFilter(v);
      setAdFilter(v);
    });
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

  const handleCleanupExpired = () => {
    if (!confirm("确定要清除失效资源吗？这会向各资源站验证视频是否存在，每个站点最多检查 2000 条，可能需要一些时间。")) return;
    setCleaningUp(true);
    cleanupExpired()
      .then((res) => {
        setCleanupResult({ deleted: res.deleted, checked: res.checked });
        setTimeout(() => setCleanupResult(null), 5000);
      })
      .catch(() => alert("清除失效资源失败"))
      .finally(() => setCleaningUp(false));
  };

  /* ---- add site (inline) ---- */
  const handleAddSite = (name: string, base_url: string) => {
    createSite({ name, base_url, enabled: true, sort: 0 }).then((s) => {
      setSites((prev) => [...prev, s]);
      setShowAddDialog(false);
    });
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
    updateSite(site.id, { name, base_url }).then(() => {
      listSites().then(setSites);
      cancelEdit();
    });
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

  const saveRoot = () => {
    if (!root.trim()) return;
    setDownloadRoot(root.trim()).then((r) => setSavedRoot(r.value));
  };

  const saveMaxConcurrent = () => {
    const value = Math.max(1, Math.min(50, Math.round(maxConcurrent)));
    setMaxConcurrentDownloads(value)
      .then((r) => {
        setSavedMaxConcurrent(r.value);
        setMaxConcurrent(r.value);
      })
      .catch(() => alert("保存同时下载任务数失败"));
  };

  const saveAdFilter = () => {
    setAdFilterEnabled(adFilter)
      .then((r) => {
        setSavedAdFilter(r.value);
        setAdFilter(r.value);
      })
      .catch(() => alert("保存去广告设置失败"));
  };

  const rowBaseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: 4,
    transition: "background-color 150ms ease, border-color 150ms ease",
  };

  return (
    <div className="col settings-form" style={{ gap: 20 }}>
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
              {t.label}
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
              <span style={{ color: "var(--primary)" }}>
                <ServerIcon size={16} />
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
                采集站管理
              </h3>
            </div>
            <div className="row" style={{ gap: 4, alignItems: "center" }}>
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
                  background: "rgba(255,255,255,0.03)",
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
                      e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
                      e.currentTarget.style.borderColor = "var(--glass-border)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
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
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                    className="row"
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
          <CategorySettings sites={sites} />
        </section>
      )}

      {/* 下载设置 */}
      {activeTab === "download" && (
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
              <FolderIcon size={16} />
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
              下载设置
            </h3>
          </div>
          <div className="col" style={{ gap: 16 }}>
            <div className="col" style={{ gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                下载根目录
              </label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="text"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                  placeholder="例如 D:/Downloads"
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--glass-border)",
                    background: "var(--bg)",
                    color: "var(--text-primary)",
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
                <button className="btn btn-primary" onClick={saveRoot}>
                  保存
                </button>
              </div>
              {savedRoot && (
                <div
                  className="row"
                  style={{
                    gap: 6,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  <CheckIcon size={12} />
                  当前配置：{savedRoot}
                </div>
              )}
            </div>

            <div className="col" style={{ gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                同时下载任务数（1–50）
              </label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                  style={{
                    width: 120,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--glass-border)",
                    background: "var(--bg)",
                    color: "var(--text-primary)",
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
                <button className="btn btn-primary" onClick={saveMaxConcurrent}>
                  保存
                </button>
              </div>
              <div
                className="row"
                style={{
                  gap: 6,
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                <CheckIcon size={12} />
                当前配置：{savedMaxConcurrent}
              </div>
            </div>

            <div className="col" style={{ gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                m3u8 去广告（实验性）
              </label>
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                <label
                  className="row"
                  style={{
                    gap: 8,
                    alignItems: "center",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={adFilter}
                    onChange={(e) => setAdFilter(e.target.checked)}
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                  启用后端 playlist 清洗
                </label>
                <button
                  className="btn btn-primary"
                  onClick={saveAdFilter}
                  style={{ marginLeft: "auto" }}
                >
                  保存
                </button>
              </div>
              <div
                className="row"
                style={{
                  gap: 6,
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                <CheckIcon size={12} />
                当前配置：{savedAdFilter ? "已开启" : "已关闭"}
              </div>
            </div>
          </div>
        </section>
      )}

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
            <button
              className="btn"
              disabled={cleaningUp}
              onClick={handleCleanupExpired}
              style={{ gap: 6, color: "var(--danger)", borderColor: "var(--danger)" }}
            >
              <TrashIcon size={14} />
              {cleaningUp ? "清除中..." : "清除失效资源"}
            </button>
            {cleanupResult && (
              <span style={{ fontSize: 13, color: "var(--success)" }}>
                已检查 {cleanupResult.checked} 条，删除 {cleanupResult.deleted} 条失效资源
              </span>
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
                background: "rgba(255,255,255,0.03)",
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
                        idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.03)",
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
                        color: "var(--success)",
                      }}
                    >
                      {log.new_count}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: "var(--primary)",
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
