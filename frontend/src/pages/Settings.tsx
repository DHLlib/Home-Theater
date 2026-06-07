import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listSites,
  createSite,
  deleteSite,
  probeSite,
  updateSite,
  batchProbe,
} from "../api/sites";
import { getDownloadRoot, setDownloadRoot } from "../api/settings";
import { clearVideoCache, getCrawlerLogs, getCrawlerStats, triggerFullCrawl, triggerIncremental } from "../api/videos";
import CategorySettings from "../components/CategorySettings";
import type { CrawlerLog, CrawlerStatsResponse, ProbeResult, Site, BatchProbeResult } from "../types";

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

type TabKey = "sites" | "categories" | "download" | "cache" | "logs";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "sites", label: "采集站管理", icon: <ServerIcon size={14} /> },
  { key: "categories", label: "分类设置", icon: <TagIcon size={14} /> },
  { key: "download", label: "下载根目录", icon: <FolderIcon size={14} /> },
  { key: "cache", label: "缓存管理", icon: <TrashIcon size={14} /> },
  { key: "logs", label: "刮削日志", icon: <ActivityIcon size={14} /> },
];

function SunIcon({ size = 14 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ size = 14 }: { size?: number }) {
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
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function PlayIcon({ size = 14 }: { size?: number }) {
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
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function DownloadIcon({ size = 14 }: { size?: number }) {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>("sites");
  const [sites, setSites] = useState<Site[]>([]);
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<number, ProbeResult>
  >({});
  const [clearing, setClearing] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const [crawlerLogs, setCrawlerLogs] = useState<CrawlerLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [crawlerStats, setCrawlerStats] = useState<CrawlerStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [triggeringFull, setTriggeringFull] = useState(false);
  const [triggeringIncremental, setTriggeringIncremental] = useState<Record<number, boolean>>({});
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") || "light"
  );

  /* ---- inline edit states ---- */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");

  /* ---- batch probe states ---- */
  const [batchJson, setBatchJson] = useState("");
  const [batchResults, setBatchResults] = useState<BatchProbeResult[] | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [showBatchPanel, setShowBatchPanel] = useState(false);

  useEffect(() => {
    listSites().then(setSites);
    getDownloadRoot().then((r) => {
      setSavedRoot(r);
      if (r) setRoot(r);
    });
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      setLogsLoading(true);
      getCrawlerLogs()
        .then((res) => setCrawlerLogs(res.logs))
        .catch(() => setCrawlerLogs([]))
        .finally(() => setLogsLoading(false));

      setStatsLoading(true);
      getCrawlerStats()
        .then((res) => setCrawlerStats(res))
        .catch(() => setCrawlerStats(null))
        .finally(() => setStatsLoading(false));
    }
  }, [activeTab]);

  const handleClearCache = () => {
    if (!confirm("确定要清除所有视频缓存吗？此操作不可恢复。")) return;
    setClearing(true);
    clearVideoCache()
      .then((res) => {
        setClearedCount(res.deleted);
        setTimeout(() => setClearedCount(null), 3000);
      })
      .catch(() => alert("清除缓存失败"))
      .finally(() => setClearing(false));
  };

  /* ---- add site (inline) ---- */
  const startAdd = () => {
    setIsAdding(true);
    setAddName("");
    setAddUrl("");
  };
  const cancelAdd = () => {
    setIsAdding(false);
    setAddName("");
    setAddUrl("");
  };
  const confirmAdd = () => {
    const name = addName.trim();
    const base_url = addUrl.trim();
    if (!name || !base_url) return;
    createSite({ name, base_url, enabled: true, sort: 0 }).then((s) => {
      setSites((prev) => [...prev, s]);
      cancelAdd();
    });
  };

  /* ---- batch probe ---- */
  const handleBatchProbe = () => {
    let items: { name: string; url: string }[];
    try {
      items = JSON.parse(batchJson.trim());
      if (!Array.isArray(items)) throw new Error("必须是数组");
      if (items.length === 0) throw new Error("数组不能为空");
      if (items.length > 20) throw new Error("一次最多 20 个站点");
    } catch (e: any) {
      alert("JSON 格式错误: " + (e?.message || "未知错误"));
      return;
    }
    setBatchLoading(true);
    setBatchResults(null);
    batchProbe(items)
      .then((r) => {
        setBatchResults(r.results);
        // 刷新站点列表（新站点已自动添加）
        listSites().then(setSites);
      })
      .catch((err) => {
        alert("探测失败: " + (err?.message || "未知错误"));
      })
      .finally(() => setBatchLoading(false));
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

  const doProbe = (id: number) => {
    probeSite(id).then((r) =>
      setProbeResults((prev) => ({ ...prev, [id]: r }))
    );
  };

  const saveRoot = () => {
    if (!root.trim()) return;
    setDownloadRoot(root.trim()).then((r) => setSavedRoot(r.value));
  };

  const rowBaseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: "var(--muted)",
    borderRadius: 8,
    transition: "background-color 150ms ease, border-color 150ms ease",
  };

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  };

  return (
    <div className="col settings-form" style={{ gap: 20 }}>
      {/* Tab 菜单 */}
      <div
        className="row settings-tab-bar"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
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
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            <span style={{ color: "var(--primary)" }}>
              <ServerIcon size={16} />
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                textShadow: "0 0 12px rgba(52,211,153,0.35)",
                letterSpacing: 0.3,
              }}
            >
              采集站管理
            </h3>
          </div>

          <div className="col" style={{ gap: 10 }}>
            {sites.length === 0 && !isAdding && (
              <div
                className="empty"
                style={{
                  padding: 32,
                  background: "var(--muted)",
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
                      : "1px solid var(--border)",
                    opacity: s.enabled ? 1 : 0.55,
                  }}
                  onMouseEnter={(e) => {
                    if (s.enabled && !isEditing) {
                      e.currentTarget.style.backgroundColor = "var(--card-hover)";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--muted)";
                    e.currentTarget.style.borderColor = s.enabled
                      ? "transparent"
                      : "var(--border)";
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
                                background: "var(--border)",
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
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
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
                        <button
                          className="btn"
                          onClick={() => doProbe(s.id)}
                          title="检测连通性"
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                          }}
                        >
                          <ActivityIcon size={12} />
                          检测
                        </button>
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
                          onClick={() =>
                            updateSite(s.id, { enabled: !s.enabled }).then(() =>
                              listSites().then(setSites)
                            )
                          }
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                          }}
                        >
                          {s.enabled ? "禁用" : "启用"}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            deleteSite(s.id).then(() =>
                              setSites((prev) => prev.filter((x) => x.id !== s.id))
                            )
                          }
                          title="删除"
                          style={{
                            padding: "8px 14px",
                            minHeight: 40,
                            fontSize: 12,
                            color: "var(--danger)",
                          }}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 添加站点内联表单 */}
            {isAdding && (
              <div
                style={{
                  ...rowBaseStyle,
                  border: "1px solid var(--primary)",
                  background: "var(--card)",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--primary)",
                    flexShrink: 0,
                  }}
                />
                <div className="col" style={{ flex: 1, minWidth: 0, gap: 8 }}>
                  <input
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="站点名称"
                    style={{ ...inputStyle, width: "100%" }}
                    autoFocus
                  />
                  <input
                    type="text"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    placeholder="站点地址（如 http://xxx.php）"
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <button
                    className="btn btn-primary"
                    onClick={confirmAdd}
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
                    onClick={cancelAdd}
                    style={{
                      padding: "8px 14px",
                      minHeight: 40,
                      fontSize: 12,
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {!isAdding && (
              <div className="row" style={{ gap: 10 }}>
                <button
                  className="btn btn-primary"
                  onClick={startAdd}
                  style={{ gap: 6 }}
                >
                  <PlusIcon size={16} />
                  添加站点
                </button>
                <button
                  className="btn"
                  onClick={() => setShowBatchPanel((v) => !v)}
                  style={{ gap: 6 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  批量嗅探
                </button>
              </div>
            )}

            {/* 批量嗅探面板 */}
            {showBatchPanel && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 16,
                  background: "var(--card)",
                  marginTop: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                  批量嗅探站点
                </div>
                <textarea
                  value={batchJson}
                  onChange={(e) => setBatchJson(e.target.value)}
                  placeholder={`[\n  {"name": "站点名称", "url": "http://xxx/api.php/provide/vod"}\n]`}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    minHeight: 120,
                    fontSize: 12,
                    fontFamily: "monospace",
                    resize: "vertical",
                  }}
                />
                <div className="row" style={{ marginTop: 10, gap: 8, justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {`格式: [{"name": "...", "url": "..."}]，最多 20 条`}
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn" onClick={() => { setShowBatchPanel(false); setBatchJson(""); setBatchResults(null); }}>
                      取消
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleBatchProbe}
                      disabled={batchLoading}
                    >
                      {batchLoading ? "嗅探中..." : "嗅探并添加"}
                    </button>
                  </div>
                </div>

                {/* 嗅探结果 */}
                {batchResults && (
                  <div style={{ marginTop: 12 }}>
                    {batchResults.map((r, i) => (
                      <div
                        key={i}
                        className="row"
                        style={{
                          gap: 8,
                          padding: "6px 0",
                          borderBottom: i < batchResults.length - 1 ? "1px solid var(--border)" : "none",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>
                          {r.ok ? (
                            <span style={{ color: "var(--success)" }}>✓</span>
                          ) : (
                            <span style={{ color: "var(--danger)" }}>✗</span>
                          )}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.name}
                        </span>
                        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                          {r.ok
                            ? r.added
                              ? `已添加 ${r.latency_ms}ms`
                              : `已存在 ${r.latency_ms}ms`
                            : r.error}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 分类设置 */}
      {activeTab === "categories" && (
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
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
                textShadow: "0 0 12px rgba(52,211,153,0.35)",
                letterSpacing: 0.3,
              }}
            >
              分类设置
            </h3>
          </div>
          <CategorySettings sites={sites} />
        </section>
      )}

      {/* 下载根目录 */}
      {activeTab === "download" && (
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
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
                textShadow: "0 0 12px rgba(52,211,153,0.35)",
                letterSpacing: 0.3,
              }}
            >
              下载根目录
            </h3>
          </div>
          <div className="col" style={{ gap: 8 }}>
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
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--fg)",
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
        </section>
      )}

      {/* 缓存管理 */}
      {activeTab === "cache" && (
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            <span style={{ color: "var(--primary)" }}>
              <TrashIcon size={16} />
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                textShadow: "0 0 12px rgba(52,211,153,0.35)",
                letterSpacing: 0.3,
              }}
            >
              缓存管理
            </h3>
          </div>
          <div className="col" style={{ gap: 12 }}>
            <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.6 }}>
              当采集站更换域名或大量资源失效时，可清除本地视频元数据缓存。
              <br />
              清除后访问详情页会重新从源站拉取最新数据。
            </div>
            <button
              className="btn"
              disabled={clearing}
              onClick={handleClearCache}
              style={{
                alignSelf: "flex-start",
                gap: 6,
                color: "var(--danger)",
                borderColor: "var(--danger)",
              }}
            >
              <TrashIcon size={14} />
              {clearing ? "清除中..." : "清除失效资源"}
            </button>
            {clearedCount !== null && (
              <div
                className="row"
                style={{
                  gap: 6,
                  fontSize: 13,
                  color: "var(--success)",
                }}
              >
                <CheckIcon size={12} />
                已删除 {clearedCount} 条缓存数据
              </div>
            )}
          </div>
        </section>
      )}

      {/* 刮削日志 */}
      {activeTab === "logs" && (
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            <span style={{ color: "var(--primary)" }}>
              <ActivityIcon size={16} />
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                textShadow: "0 0 12px rgba(52,211,153,0.35)",
                letterSpacing: 0.3,
              }}
            >
              刮削日志
            </h3>
          </div>

          {/* 刮削看板 */}
          {statsLoading ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              加载统计中...
            </div>
          ) : crawlerStats ? (
            <div
              className="row"
              style={{
                gap: 12,
                marginBottom: 20,
                flexWrap: "wrap",
              }}
            >
              {/* 总数量 */}
              <div
                style={{
                  flex: 1,
                  minWidth: 140,
                  background: "var(--muted)",
                  borderRadius: 10,
                  padding: "16px 20px",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--primary)",
                    lineHeight: 1.2,
                  }}
                >
                  {crawlerStats.total.toLocaleString("zh-CN")}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                  }}
                >
                  总刮削数量
                </div>
              </div>

              {/* 有详情 */}
              <div
                style={{
                  flex: 1,
                  minWidth: 140,
                  background: "var(--muted)",
                  borderRadius: 10,
                  padding: "16px 20px",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--success)",
                    lineHeight: 1.2,
                  }}
                >
                  {crawlerStats.with_detail.toLocaleString("zh-CN")}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                  }}
                >
                  已补全详情
                </div>
              </div>

              {/* 各站点数量 */}
              {crawlerStats.by_site.map((s) => (
                <div
                  key={s.site_id}
                  style={{
                    flex: 1,
                    minWidth: 140,
                    background: "var(--muted)",
                    borderRadius: 10,
                    padding: "16px 20px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "var(--warning)",
                      lineHeight: 1.2,
                    }}
                  >
                    {s.count.toLocaleString("zh-CN")}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      marginTop: 4,
                    }}
                  >
                    {s.site_name}
                  </div>
                </div>
              ))}

              {/* 最近更新 */}
              <div
                style={{
                  flex: 1,
                  minWidth: 140,
                  background: "var(--muted)",
                  borderRadius: 10,
                  padding: "16px 20px",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--fg)",
                    lineHeight: 1.4,
                    wordBreak: "break-all",
                  }}
                >
                  {crawlerStats.last_updated_at
                    ? new Date(crawlerStats.last_updated_at).toLocaleString("zh-CN")
                    : "—"}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                  }}
                >
                  最近更新
                </div>
              </div>
            </div>
          ) : null}

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

            {sites
              .filter((s) => s.enabled)
              .map((s) => (
                <button
                  key={s.id}
                  className="btn"
                  disabled={triggeringIncremental[s.id]}
                  onClick={() => {
                    setTriggeringIncremental((prev) => ({ ...prev, [s.id]: true }));
                    triggerIncremental(s.id)
                      .then(() => alert(`站点 ${s.name} 增量更新已启动`))
                      .catch(() => alert("启动失败"))
                      .finally(() =>
                        setTriggeringIncremental((prev) => ({ ...prev, [s.id]: false }))
                      );
                  }}
                  style={{ gap: 6, fontSize: 12 }}
                >
                  <ActivityIcon size={12} />
                  {triggeringIncremental[s.id] ? "启动中..." : `${s.name} 增量`}
                </button>
              ))}
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
                background: "var(--muted)",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <ActivityIcon size={32} />
              <p style={{ marginTop: 8 }}>暂无刮削记录</p>
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {/* 表头 */}
              <div
                className="row"
                style={{
                  gap: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ width: 150, flexShrink: 0 }}>时间</span>
                <span style={{ width: 80, flexShrink: 0 }}>站点</span>
                <span style={{ width: 80, flexShrink: 0 }}>分类</span>
                <span style={{ width: 50, flexShrink: 0 }}>页码</span>
                <span style={{ width: 60, flexShrink: 0 }}>类型</span>
                <span style={{ width: 50, flexShrink: 0, textAlign: "right" }}>处理</span>
                <span style={{ width: 50, flexShrink: 0, textAlign: "right" }}>新增</span>
                <span style={{ width: 50, flexShrink: 0, textAlign: "right" }}>更新</span>
                <span style={{ width: 60, flexShrink: 0, textAlign: "right" }}>耗时</span>
              </div>
              {/* 日志行 */}
              {crawlerLogs.map((log, idx) => (
                <div
                  key={idx}
                  className="row"
                  style={{
                    gap: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    background:
                      idx % 2 === 0 ? "transparent" : "var(--muted)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    style={{
                      width: 150,
                      flexShrink: 0,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {new Date(log.timestamp).toLocaleString("zh-CN")}
                  </span>
                  <span
                    style={{
                      width: 80,
                      flexShrink: 0,
                      fontWeight: 500,
                    }}
                  >
                    {log.site_name}
                  </span>
                  <span
                    style={{
                      width: 80,
                      flexShrink: 0,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {log.category}
                  </span>
                  <span style={{ width: 50, flexShrink: 0 }}>
                    {log.page}
                  </span>
                  <span style={{ width: 60, flexShrink: 0 }}>
                    {log.crawl_type === "full" ? "全量" : "增量"}
                  </span>
                  <span
                    style={{
                      width: 50,
                      flexShrink: 0,
                      textAlign: "right",
                    }}
                  >
                    {log.items_count}
                  </span>
                  <span
                    style={{
                      width: 50,
                      flexShrink: 0,
                      textAlign: "right",
                      color: "var(--success)",
                    }}
                  >
                    {log.new_count}
                  </span>
                  <span
                    style={{
                      width: 50,
                      flexShrink: 0,
                      textAlign: "right",
                      color: "var(--primary)",
                    }}
                  >
                    {log.update_count}
                  </span>
                  <span
                    style={{
                      width: 60,
                      flexShrink: 0,
                      textAlign: "right",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {log.duration_ms}ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ===== 快捷入口：我的下载 / 播放记录 / 主题切换 ===== */}
      <section
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 20,
        }}
      >
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 0.3,
            }}
          >
            快捷入口
          </h3>
        </div>
        <div className="col" style={{ gap: 10 }}>
          <button
            className="btn"
            onClick={() => navigate("/downloads")}
            style={{
              justifyContent: "flex-start",
              gap: 10,
              width: "100%",
            }}
          >
            <DownloadIcon size={16} />
            我的下载
          </button>
          <button
            className="btn"
            onClick={() => navigate("/progress")}
            style={{
              justifyContent: "flex-start",
              gap: 10,
              width: "100%",
            }}
          >
            <PlayIcon size={16} />
            播放记录
          </button>
          <button
            className="btn"
            onClick={toggleTheme}
            style={{
              justifyContent: "flex-start",
              gap: 10,
              width: "100%",
            }}
            aria-label={
              theme === "light" ? "切换深色模式" : "切换浅色模式"
            }
          >
            {theme === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
            {theme === "light" ? "切换深色模式" : "切换浅色模式"}
          </button>
        </div>
      </section>
    </div>
  );
}
