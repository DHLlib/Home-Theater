import { useEffect, useState } from "react";
import {
  listSites,
  createSite,
  deleteSite,
  probeSite,
  updateSite,
} from "../api/sites";
import { getDownloadRoot, setDownloadRoot } from "../api/settings";
import { clearVideoCache } from "../api/videos";
import CategorySettings from "../components/CategorySettings";
import type { ProbeResult, Site } from "../types";

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

type TabKey = "sites" | "categories" | "download" | "cache";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "sites", label: "采集站管理", icon: <ServerIcon size={14} /> },
  { key: "categories", label: "分类设置", icon: <TagIcon size={14} /> },
  { key: "download", label: "下载根目录", icon: <FolderIcon size={14} /> },
  { key: "cache", label: "缓存管理", icon: <TrashIcon size={14} /> },
];

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
  const [activeTab, setActiveTab] = useState<TabKey>("sites");
  const [sites, setSites] = useState<Site[]>([]);
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<number, ProbeResult>
  >({});
  const [clearing, setClearing] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  /* ---- inline edit states ---- */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");

  useEffect(() => {
    listSites().then(setSites);
    getDownloadRoot().then((r) => {
      setSavedRoot(r);
      if (r) setRoot(r);
    });
  }, []);

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

  return (
    <div className="col" style={{ gap: 20 }}>
      {/* Tab 菜单 */}
      <div
        className="row"
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
              <button
                className="btn btn-primary"
                onClick={startAdd}
                style={{ alignSelf: "flex-start", gap: 6 }}
              >
                <PlusIcon size={16} />
                添加站点
              </button>
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
    </div>
  );
}
