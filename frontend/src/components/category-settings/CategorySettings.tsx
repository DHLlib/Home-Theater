import { useEffect, useState, useCallback, useMemo } from "react";
import {
  updateSiteCategories,
  fetchRemoteCategories,
  getSiteCategories,
  smartMatchCategories,
} from "../../api/sites";
import {
  listSystemCategories,
  createSystemCategory,
  updateSystemCategory,
  deleteSystemCategory,
} from "../../api/system-categories";
import type {
  CategoryGroup,
  CategoryMapping,
  Site,
  SystemCategoryTreeItem,
} from "../../types";
import SiteTabs from "./SiteTabs";

interface CategorySettingsProps {
  sites: Site[];
}

interface SiteCategoryState {
  groups: CategoryGroup[];
  mappings: CategoryMapping[];
  loading: boolean;
  loaded: boolean;
}

/* ===== 系统分类树组件 ===== */

function SystemCategoryTree({
  tree,
  onRefresh,
}: {
  tree: SystemCategoryTreeItem[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState(0);
  const [addingParent, setAddingParent] = useState(false);
  const [newParentName, setNewParentName] = useState("");
  const [addingChild, setAddingChild] = useState<number | null>(null);
  const [newChildName, setNewChildName] = useState("");

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEdit = (item: SystemCategoryTreeItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditSort(item.sort);
  };

  const handleSaveEdit = async (id: number) => {
    const name = editName.trim();
    if (!name) return;
    await updateSystemCategory(id, { name, sort: editSort });
    setEditingId(null);
    onRefresh();
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除分类「${name}」？子分类将一并删除。`)) return;
    await deleteSystemCategory(id);
    onRefresh();
  };

  const handleAddParent = async () => {
    const name = newParentName.trim();
    if (!name) return;
    await createSystemCategory({ name, sort: 0 });
    setAddingParent(false);
    setNewParentName("");
    onRefresh();
  };

  const handleAddChild = async (parentId: number) => {
    const name = newChildName.trim();
    if (!name) return;
    await createSystemCategory({ name, parent_id: parentId, sort: 0 });
    setAddingChild(null);
    setNewChildName("");
    onRefresh();
  };

  const handleToggleEnabled = async (item: SystemCategoryTreeItem) => {
    const next = !(item.enabled !== false);
    await updateSystemCategory(item.id, { enabled: next });
    onRefresh();
  };

  const disabledStyle = {
    color: "var(--text-secondary)",
    textDecoration: "line-through",
    opacity: 0.6,
  } as const;

  return (
    <div className="col" style={{ gap: 4 }}>
      {tree.map((parent) => {
        const isExpanded = expanded.has(parent.id);
        return (
          <div key={parent.id} className="col" style={{ gap: 2 }}>
            {/* 父分类行 */}
            <div
              className="row"
              style={{
                gap: 8,
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.03)",
                alignItems: "center",
              }}
            >
              <button
                className="btn"
                onClick={() => toggleExpand(parent.id)}
                style={{ padding: "2px 6px", minHeight: 24, fontSize: 12 }}
              >
                {isExpanded ? "▼" : "▶"}
              </button>
              {editingId === parent.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      fontSize: 13,
                      borderRadius: 4,
                      border: "1px solid var(--glass-border)",
                      background: "var(--bg)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <input
                    type="number"
                    value={editSort}
                    onChange={(e) => setEditSort(Number(e.target.value))}
                    style={{
                      width: 60,
                      padding: "4px 8px",
                      fontSize: 13,
                      borderRadius: 4,
                      border: "1px solid var(--glass-border)",
                      background: "var(--bg)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={() => handleSaveEdit(parent.id)}
                    style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                  >
                    保存
                  </button>
                  <button
                    className="btn"
                    onClick={() => setEditingId(null)}
                    style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, ...(parent.enabled === false ? disabledStyle : {}) }}>
                    {parent.name}
                  </span>
                  <button
                    className="btn"
                    onClick={() => handleEdit(parent)}
                    style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                  >
                    编辑
                  </button>
                  <button
                    className="btn"
                    onClick={() => handleToggleEnabled(parent)}
                    style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                  >
                    {parent.enabled === false ? "启用" : "禁用"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => setAddingChild(parent.id)}
                    style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                  >
                    +子类
                  </button>
                  <button
                    className="btn"
                    onClick={() => handleDelete(parent.id, parent.name)}
                    style={{
                      padding: "4px 10px",
                      minHeight: 28,
                      fontSize: 12,
                      color: "var(--danger)",
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </div>

            {/* 子分类列表 */}
            {isExpanded && (
              <div className="col" style={{ gap: 2, paddingLeft: 24 }}>
                {parent.children.map((child) => (
                  <div
                    key={child.id}
                    className="row"
                    style={{
                      gap: 8,
                      padding: "4px 8px",
                      borderRadius: 4,
                      alignItems: "center",
                    }}
                  >
                    {editingId === child.id ? (
                      <>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{
                            flex: 1,
                            padding: "4px 8px",
                            fontSize: 13,
                            borderRadius: 4,
                            border: "1px solid var(--glass-border)",
                            background: "var(--bg)",
                            color: "var(--text-primary)",
                          }}
                        />
                        <input
                          type="number"
                          value={editSort}
                          onChange={(e) =>
                            setEditSort(Number(e.target.value))
                          }
                          style={{
                            width: 60,
                            padding: "4px 8px",
                            fontSize: 13,
                            borderRadius: 4,
                            border: "1px solid var(--glass-border)",
                            background: "var(--bg)",
                            color: "var(--text-primary)",
                          }}
                        />
                        <button
                          className="btn btn-primary"
                          onClick={() => handleSaveEdit(child.id)}
                          style={{
                            padding: "4px 10px",
                            minHeight: 28,
                            fontSize: 12,
                          }}
                        >
                          保存
                        </button>
                        <button
                          className="btn"
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: "4px 10px",
                            minHeight: 28,
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          style={{
                            flex: 1,
                            fontSize: 13,
                            ...(child.enabled === false ? disabledStyle : { color: "var(--text-primary)" }),
                          }}
                        >
                          {child.name}
                        </span>
                        <button
                          className="btn"
                          onClick={() => handleEdit(child)}
                          style={{
                            padding: "4px 10px",
                            minHeight: 28,
                            fontSize: 12,
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="btn"
                          onClick={() => handleToggleEnabled(child)}
                          style={{
                            padding: "4px 10px",
                            minHeight: 28,
                            fontSize: 12,
                          }}
                        >
                          {child.enabled === false ? "启用" : "禁用"}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            handleDelete(child.id, child.name)
                          }
                          style={{
                            padding: "4px 10px",
                            minHeight: 28,
                            fontSize: 12,
                            color: "var(--danger)",
                          }}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {/* 添加子分类输入框 */}
                {addingChild === parent.id && (
                  <div
                    className="row"
                    style={{
                      gap: 8,
                      padding: "4px 8px",
                      alignItems: "center",
                    }}
                  >
                    <input
                      value={newChildName}
                      onChange={(e) => setNewChildName(e.target.value)}
                      placeholder="新子分类名称"
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        fontSize: 13,
                        borderRadius: 4,
                        border: "1px solid var(--glass-border)",
                        background: "var(--bg)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={() => handleAddChild(parent.id)}
                      style={{
                        padding: "4px 10px",
                        minHeight: 28,
                        fontSize: 12,
                      }}
                    >
                      添加
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setAddingChild(null);
                        setNewChildName("");
                      }}
                      style={{
                        padding: "4px 10px",
                        minHeight: 28,
                        fontSize: 12,
                      }}
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 添加父分类 */}
      {addingParent ? (
        <div
          className="row"
          style={{
            gap: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
            alignItems: "center",
          }}
        >
          <input
            value={newParentName}
            onChange={(e) => setNewParentName(e.target.value)}
            placeholder="新大类名称"
            style={{
              flex: 1,
              padding: "4px 8px",
              fontSize: 13,
              borderRadius: 4,
              border: "1px solid var(--glass-border)",
              background: "var(--bg)",
              color: "var(--text-primary)",
            }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAddParent}
            style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
          >
            添加
          </button>
          <button
            className="btn"
            onClick={() => {
              setAddingParent(false);
              setNewParentName("");
            }}
            style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
          >
            取消
          </button>
        </div>
      ) : (
        <button
          className="btn"
          onClick={() => setAddingParent(true)}
          style={{
            padding: "6px 12px",
            minHeight: 32,
            fontSize: 13,
            alignSelf: "flex-start",
          }}
        >
          + 新增大类
        </button>
      )}
    </div>
  );
}

/* ===== 站点分类映射组件 ===== */

function SiteCategoryMappings({
  siteName,
  groups,
  mappings,
  allSystemCategories,
  onMappingChange,
  onToggleMappingEnabled,
  showAll,
}: {
  siteName: string;
  groups: CategoryGroup[];
  mappings: CategoryMapping[];
  allSystemCategories: string[];
  onMappingChange: (remoteId: string, systemName: string | null) => void;
  onToggleMappingEnabled: (remoteId: string) => void;
  showAll: boolean;
}) {
  const mappedIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of mappings) set.add(m.remote_id);
    return set;
  }, [mappings]);

  const displayGroups = useMemo(() => {
    if (showAll) return groups;
    return groups
      .map((g) => ({
        ...g,
        categories: g.categories.filter((c) => !mappedIds.has(c.remote_id)),
      }))
      .filter((g) => g.categories.length > 0);
  }, [groups, mappedIds, showAll]);

  const localMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mappings) if (m.enabled !== false) map[m.remote_id] = m.name;
    return map;
  }, [mappings]);

  const enabledMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const m of mappings) map[m.remote_id] = m.enabled !== false;
    return map;
  }, [mappings]);

  if (groups.length === 0) {
    return (
      <div className="empty" style={{ padding: 32 }}>
        <p>暂无分类数据</p>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
          站点首次使用时会自动拉取分类
        </p>
      </div>
    );
  }

  if (!showAll && displayGroups.length === 0) {
    return (
      <div className="empty" style={{ padding: 32 }}>
        <p style={{ color: "var(--success)" }}>
          {siteName} 的所有分类均已识别
        </p>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
          切换「显示全部」可查看和修改已有映射
        </p>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      {displayGroups.map((group) => (
        <div key={group.parent_id || "ungrouped"} className="col" style={{ gap: 4 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-secondary)",
              padding: "4px 0",
            }}
          >
            {group.parent_name || "未分组"}
          </div>
          {group.categories.map((cat) => {
            const isMapped = cat.remote_id in localMap || mappings.some((m) => m.remote_id === cat.remote_id);
            const isEnabled = enabledMap[cat.remote_id] !== false;
            return (
              <div
                key={cat.remote_id}
                className="row"
                style={{
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 4,
                  alignItems: "center",
                  background: isMapped && isEnabled
                    ? "var(--primary-dim)"
                    : isMapped && !isEnabled
                    ? "rgba(239, 68, 68, 0.04)"
                    : "transparent",
                  border: isMapped && isEnabled
                    ? "1px solid rgba(52, 211, 153, 0.2)"
                    : isMapped && !isEnabled
                    ? "1px solid rgba(239, 68, 68, 0.2)"
                    : "1px solid transparent",
                  opacity: isMapped && !isEnabled ? 0.7 : 1,
                }}
              >
                <span
                  style={{
                    flex: "0 0 120px",
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: isMapped && !isEnabled ? "line-through" : "none",
                    color: isMapped && !isEnabled ? "var(--text-secondary)" : "var(--text-primary)",
                  }}
                  title={cat.name}
                >
                  {cat.name}
                  {isMapped && isEnabled && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--success)",
                        marginLeft: 4,
                      }}
                    >
                      ✓
                    </span>
                  )}
                  {isMapped && !isEnabled && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--danger)",
                        marginLeft: 4,
                      }}
                    >
                      已禁用
                    </span>
                  )}
                </span>
                <select
                  value={localMap[cat.remote_id] || ""}
                  onChange={(e) =>
                    onMappingChange(
                      cat.remote_id,
                      e.target.value || null
                    )
                  }
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    fontSize: 13,
                    borderRadius: 4,
                    border: "1px solid var(--glass-border)",
                    background: "var(--bg)",
                    color: "var(--text-primary)",
                    fontFamily: "inherit",
                  }}
                >
                  <option value="">-- 选择系统分类 --</option>
                  {allSystemCategories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {isMapped && (
                  <button
                    className="btn"
                    onClick={() => onToggleMappingEnabled(cat.remote_id)}
                    style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                    title={isEnabled ? "禁用此映射" : "启用此映射"}
                  >
                    {isEnabled ? "禁用" : "启用"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ===== 主组件 ===== */

export default function CategorySettings({ sites }: CategorySettingsProps) {
  const [systemTree, setSystemTree] = useState<SystemCategoryTreeItem[]>([]);
  const [activeSiteId, setActiveSiteId] = useState<number | null>(null);
  const [siteStates, setSiteStates] = useState<
    Record<number, SiteCategoryState>
  >({});
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // 加载系统分类树
  const loadSystemTree = useCallback(async () => {
    try {
      const tree = await listSystemCategories();
      setSystemTree(tree);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSystemTree();
  }, [loadSystemTree]);

  // 初始化 activeSiteId
  useEffect(() => {
    if (sites.length > 0 && activeSiteId === null) {
      setActiveSiteId(sites[0].id);
    }
  }, [sites, activeSiteId]);

  // 加载站点分类数据（只加载当前激活站点，避免卡死）
  useEffect(() => {
    if (activeSiteId === null) return;

    // 如果已加载过，跳过
    if (siteStates[activeSiteId]?.loaded) return;

    setSiteStates((prev) => ({
      ...prev,
      [activeSiteId]: {
        groups: prev[activeSiteId]?.groups || [],
        mappings: prev[activeSiteId]?.mappings || [],
        loading: true,
        loaded: false,
      },
    }));

    Promise.all([
      fetchRemoteCategories(activeSiteId),
      getSiteCategories(activeSiteId),
    ])
      .then(([remoteRes, savedRes]) => {
        setSiteStates((prev) => ({
          ...prev,
          [activeSiteId]: {
            groups: remoteRes.groups || [],
            mappings: savedRes.categories || [],
            loading: false,
            loaded: true,
          },
        }));
      })
      .catch(() => {
        setSiteStates((prev) => ({
          ...prev,
          [activeSiteId]: {
            ...prev[activeSiteId],
            loading: false,
            loaded: true,
          },
        }));
      });
  }, [activeSiteId]);

  // 提取所有系统分类叶子节点名称
  const allSystemCategories = useMemo(() => {
    const names: string[] = [];
    for (const parent of systemTree) {
      for (const child of parent.children) {
        names.push(child.name);
      }
    }
    return names;
  }, [systemTree]);

  const handleMappingChange = useCallback(
    (siteId: number, remoteId: string, systemName: string | null) => {
      setSiteStates((prev) => {
        const state = prev[siteId];
        if (!state) return prev;

        let nextMappings: CategoryMapping[];
        if (systemName === null) {
          nextMappings = state.mappings.filter(
            (m) => m.remote_id !== remoteId
          );
        } else {
          const existingIdx = state.mappings.findIndex(
            (m) => m.remote_id === remoteId
          );
          if (existingIdx >= 0) {
            nextMappings = state.mappings.map((m, idx) =>
              idx === existingIdx ? { ...m, name: systemName } : m
            );
          } else {
            nextMappings = [
              ...state.mappings,
              { remote_id: remoteId, name: systemName, enabled: true },
            ];
          }
        }
        return { ...prev, [siteId]: { ...state, mappings: nextMappings } };
      });
    },
    []
  );

  const handleToggleMappingEnabled = useCallback(
    (siteId: number, remoteId: string) => {
      setSiteStates((prev) => {
        const state = prev[siteId];
        if (!state) return prev;
        const nextMappings = state.mappings.map((m) =>
          m.remote_id === remoteId ? { ...m, enabled: m.enabled === false } : m
        );
        return { ...prev, [siteId]: { ...state, mappings: nextMappings } };
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      for (const site of sites) {
        const state = siteStates[site.id];
        if (!state) continue;
        await updateSiteCategories(site.id, state.mappings);
      }
      alert("保存成功");
    } catch {
      alert("保存失败");
    } finally {
      setSaving(false);
    }
  }, [sites, siteStates]);

  const handleSmartMatch = useCallback(async () => {
    if (activeSiteId === null) return;
    setMatching(true);
    try {
      const result = await smartMatchCategories(activeSiteId);
      // 只应用 auto_mapped 的结果
      const autoMappings = result.matches.filter(
        (m) => m.status === "auto_mapped" && m.suggested_system_name
      );
      if (autoMappings.length === 0) {
        alert("暂无可自动识别的分类");
        return;
      }
      setSiteStates((prev) => {
        const state = prev[activeSiteId];
        if (!state) return prev;
        const existingMap = new Map(
          state.mappings.map((m) => [m.remote_id, m])
        );
        for (const m of autoMappings) {
          if (m.suggested_system_name) {
            const existing = existingMap.get(m.remote_id);
            existingMap.set(m.remote_id, {
              remote_id: m.remote_id,
              name: m.suggested_system_name,
              enabled: existing ? existing.enabled : true,
            });
          }
        }
        const nextMappings: CategoryMapping[] = Array.from(
          existingMap.values()
        );
        return {
          ...prev,
          [activeSiteId]: { ...state, mappings: nextMappings },
        };
      });
      alert(
        `自动匹配完成：${autoMappings.length} 个分类已自动识别，${result.summary.suggested} 个建议手动确认，${result.summary.unrecognized} 个无法识别`
      );
    } catch (e: any) {
      alert("自动匹配失败: " + (e?.message || "未知错误"));
    } finally {
      setMatching(false);
    }
  }, [activeSiteId]);

  const activeState =
    activeSiteId !== null ? siteStates[activeSiteId] : null;

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* 两栏布局 */}
      <div
        className="row"
        style={{ gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}
      >
        {/* 左栏：系统分类管理 */}
        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          <div
            className="row"
            style={{
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              系统分类
            </h4>
            <span
              style={{ fontSize: 12, color: "var(--text-secondary)" }}
            >
              {systemTree.reduce(
                (acc, p) => acc + p.children.length,
                0
              )}{" "}
              个子分类
            </span>
          </div>
          <SystemCategoryTree
            tree={systemTree}
            onRefresh={loadSystemTree}
          />
        </div>

        {/* 右栏：分类映射 */}
        <div style={{ flex: "2 1 400px", minWidth: 320 }}>
          <div
            className="row"
            style={{
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              分类映射
            </h4>
            <div className="row" style={{ gap: 8 }}>
              <label
                className="row"
                style={{
                  gap: 6,
                  alignItems: "center",
                  fontSize: 13,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                显示全部
              </label>
              <button
                className="btn"
                onClick={handleSmartMatch}
                disabled={matching || activeSiteId === null}
                style={{ fontSize: 13 }}
              >
                {matching ? "匹配中..." : "自动匹配"}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize: 13 }}
              >
                {saving ? "保存中..." : "保存映射"}
              </button>
            </div>
          </div>

          <SiteTabs
            sites={sites}
            activeSiteId={activeSiteId}
            onChange={setActiveSiteId}
          />

          <div style={{ marginTop: 12 }}>
            {activeState?.loading ? (
              <div
                className="empty"
                style={{ padding: 32, fontSize: 13 }}
              >
                加载中...
              </div>
            ) : activeState ? (
              <SiteCategoryMappings
                siteName={
                  sites.find((s) => s.id === activeSiteId)?.name || ""
                }
                groups={activeState.groups}
                mappings={activeState.mappings}
                allSystemCategories={allSystemCategories}
                onMappingChange={(rid, sys) =>
                  handleMappingChange(activeSiteId!, rid, sys)
                }
                onToggleMappingEnabled={(rid) =>
                  handleToggleMappingEnabled(activeSiteId!, rid)
                }
                showAll={showAll}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
