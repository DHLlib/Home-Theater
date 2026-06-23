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
import { toastSuccess, toastError } from "../../utils/toast";
import type {
  CategoryGroup,
  CategoryMapping,
  Site,
  SystemCategoryTreeItem,
} from "../../types";
import "./CategorySettings.css";

interface CategorySettingsProps {
  sites: Site[];
}

interface SiteCategoryState {
  groups: CategoryGroup[];
  mappings: CategoryMapping[];
  initialMappings: CategoryMapping[];
  loading: boolean;
  loaded: boolean;
}

/* ===== 图标 ===== */

function IconChevronRight({ size = 14 }: { size?: number }) {
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
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconEdit({ size = 14 }: { size?: number }) {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash({ size = 14 }: { size?: number }) {
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

function IconPlus({ size = 14 }: { size?: number }) {
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

function IconX({ size = 14 }: { size?: number }) {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconCheck({ size = 14 }: { size?: number }) {
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

/* ===== 开关 ===== */

function ToggleSwitch({
  checked,
  onChange,
  children,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  children?: React.ReactNode;
  title?: string;
}) {
  return (
    <label className="cs-toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="cs-toggle-track">
        <span className="cs-toggle-thumb" />
      </span>
      {children}
    </label>
  );
}

/* ===== 系统分类树 ===== */

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

  const startEdit = (item: SystemCategoryTreeItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditSort(item.sort);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditSort(0);
  };

  const handleSaveEdit = async (id: number) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await updateSystemCategory(id, { name, sort: editSort });
      setEditingId(null);
      onRefresh();
    } catch {
      toastError("保存分类失败");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除分类「${name}」？子分类将一并删除。`)) return;
    try {
      await deleteSystemCategory(id);
      onRefresh();
      toastSuccess("已删除");
    } catch {
      toastError("删除分类失败");
    }
  };

  const handleAddParent = async () => {
    const name = newParentName.trim();
    if (!name) return;
    try {
      await createSystemCategory({ name, sort: 0 });
      setAddingParent(false);
      setNewParentName("");
      onRefresh();
      toastSuccess("大类已添加");
    } catch {
      toastError("添加大类失败");
    }
  };

  const handleAddChild = async (parentId: number) => {
    const name = newChildName.trim();
    if (!name) return;
    try {
      await createSystemCategory({ name, parent_id: parentId, sort: 0 });
      setAddingChild(null);
      setNewChildName("");
      setExpanded((prev) => new Set(prev).add(parentId));
      onRefresh();
      toastSuccess("子分类已添加");
    } catch {
      toastError("添加子分类失败");
    }
  };

  const handleToggleEnabled = async (item: SystemCategoryTreeItem) => {
    const next = !(item.enabled !== false);
    try {
      await updateSystemCategory(item.id, { enabled: next });
      onRefresh();
    } catch {
      toastError("切换状态失败");
    }
  };

  const inputProps = {
    style: {
      flex: 1,
      minWidth: 0,
      padding: "4px 8px",
      fontSize: 13,
    } as React.CSSProperties,
  };

  const sortInputProps = {
    type: "number" as const,
    style: {
      width: 64,
      padding: "4px 8px",
      fontSize: 13,
    } as React.CSSProperties,
  };

  return (
    <div className="cs-tree">
      {tree.map((parent) => {
        const isExpanded = expanded.has(parent.id);
        const isDisabled = parent.enabled === false;
        return (
          <div key={parent.id} className="cs-tree-parent">
            <div
              className={[
                "cs-tree-row",
                isDisabled ? "cs-tree-row--disabled" : "",
              ].join(" ")}
            >
              <button
                type="button"
                className="btn cs-tree-expand"
                onClick={() => toggleExpand(parent.id)}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "收起" : "展开"}
              >
                <IconChevronRight />
              </button>

              {editingId === parent.id ? (
                <>
                  <input
                    {...inputProps}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(parent.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    autoFocus
                  />
                  <input
                    {...sortInputProps}
                    value={editSort}
                    onChange={(e) => setEditSort(Number(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(parent.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleSaveEdit(parent.id)}
                    title="保存"
                  >
                    <IconCheck size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={cancelEdit}
                    title="取消"
                  >
                    <IconX size={12} />
                  </button>
                </>
              ) : (
                <>
                  <span
                    className={[
                      "cs-tree-name",
                      isDisabled ? "cs-tree-name--disabled" : "",
                    ].join(" ")}
                    title={parent.name}
                  >
                    {parent.name}
                  </span>
                  <div className="cs-tree-actions">
                    <ToggleSwitch
                      checked={!isDisabled}
                      onChange={() => handleToggleEnabled(parent)}
                      title={isDisabled ? "启用" : "禁用"}
                    />
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => startEdit(parent)}
                      title="编辑"
                      aria-label="编辑"
                    >
                      <IconEdit size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => setAddingChild(parent.id)}
                      title="添加子分类"
                      aria-label="添加子分类"
                    >
                      <IconPlus size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => handleDelete(parent.id, parent.name)}
                      title="删除"
                      aria-label="删除"
                      style={{ color: "var(--danger)" }}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>

            {isExpanded && (
              <div className="cs-tree-children">
                {parent.children.map((child) => {
                  const childDisabled = child.enabled === false;
                  return (
                    <div
                      key={child.id}
                      className={[
                        "cs-tree-child",
                        childDisabled ? "cs-tree-row--disabled" : "",
                      ].join(" ")}
                    >
                      {editingId === child.id ? (
                        <>
                          <input
                            {...inputProps}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(child.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                          <input
                            {...sortInputProps}
                            value={editSort}
                            onChange={(e) =>
                              setEditSort(Number(e.target.value))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(child.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleSaveEdit(child.id)}
                            title="保存"
                          >
                            <IconCheck size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={cancelEdit}
                            title="取消"
                          >
                            <IconX size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            className={[
                              "cs-tree-child-name",
                              childDisabled
                                ? "cs-tree-child-name--disabled"
                                : "",
                            ].join(" ")}
                            title={child.name}
                          >
                            {child.name}
                          </span>
                          <div className="cs-tree-actions">
                            <ToggleSwitch
                              checked={!childDisabled}
                              onChange={() => handleToggleEnabled(child)}
                              title={childDisabled ? "启用" : "禁用"}
                            />
                            <button
                              type="button"
                              className="btn btn-icon"
                              onClick={() => startEdit(child)}
                              title="编辑"
                              aria-label="编辑"
                            >
                              <IconEdit size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-icon"
                              onClick={() =>
                                handleDelete(child.id, child.name)
                              }
                              title="删除"
                              aria-label="删除"
                              style={{ color: "var(--danger)" }}
                            >
                              <IconTrash size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {addingChild === parent.id ? (
                  <div className="cs-tree-add-row">
                    <input
                      type="text"
                      value={newChildName}
                      onChange={(e) => setNewChildName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddChild(parent.id);
                        if (e.key === "Escape") {
                          setAddingChild(null);
                          setNewChildName("");
                        }
                      }}
                      placeholder="新子分类名称"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleAddChild(parent.id)}
                      title="添加"
                    >
                      <IconCheck size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setAddingChild(null);
                        setNewChildName("");
                      }}
                      title="取消"
                    >
                      <IconX size={12} />
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      {addingParent ? (
        <div className="cs-tree-row">
          <input
            type="text"
            value={newParentName}
            onChange={(e) => setNewParentName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddParent();
              if (e.key === "Escape") {
                setAddingParent(false);
                setNewParentName("");
              }
            }}
            placeholder="新大类名称"
            autoFocus
            style={{ flex: 1, minWidth: 0, fontSize: 13 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAddParent}
            title="添加"
          >
            <IconCheck size={12} />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAddingParent(false);
              setNewParentName("");
            }}
            title="取消"
          >
            <IconX size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => setAddingParent(true)}
          style={{ alignSelf: "flex-start", gap: 4 }}
        >
          <IconPlus size={12} />
          新增大类
        </button>
      )}
    </div>
  );
}

/* ===== 站点标签页 ===== */

function SiteTabs({
  sites,
  activeSiteId,
  onChange,
}: {
  sites: Site[];
  activeSiteId: number | null;
  onChange: (siteId: number) => void;
}) {
  return (
    <div
      className="cs-tabs"
      role="tablist"
      onWheel={(e) => {
        const el = e.currentTarget;
        if (el.scrollWidth <= el.clientWidth) return;

        const atLeft = el.scrollLeft <= 0;
        const atRight =
          el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;

        // 垂直滚轮映射为水平滚动；到达边界时把事件还给页面
        if ((e.deltaY > 0 && !atRight) || (e.deltaY < 0 && !atLeft)) {
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }}
    >
      {sites.map((site) => {
        const active = site.id === activeSiteId;
        return (
          <button
            key={site.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={["cs-tab", active ? "cs-tab--active" : ""].join(" ")}
            onClick={() => onChange(site.id)}
          >
            {site.name}
          </button>
        );
      })}
    </div>
  );
}

/* ===== 站点分类映射 ===== */

function SiteCategoryMappings({
  groups,
  mappings,
  allSystemCategories,
  onMappingChange,
  onToggleMappingEnabled,
}: {
  groups: CategoryGroup[];
  mappings: CategoryMapping[];
  allSystemCategories: string[];
  onMappingChange: (remoteId: string, systemName: string | null) => void;
  onToggleMappingEnabled: (remoteId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="cs-mapping-empty">
        <span className="cs-mapping-empty-title">暂无分类数据</span>
        <span>站点首次使用时会自动拉取分类</span>
      </div>
    );
  }

  const getMapping = (remoteId: string) =>
    mappings.find((m) => m.remote_id === remoteId);

  return (
    <div className="cs-mapping-list">
      {groups.map((group) => (
        <div key={group.parent_id || "ungrouped"} className="cs-mapping-group">
          <div className="cs-mapping-group-title">
            {group.parent_name || "未分组"}
          </div>
          {group.categories.map((cat) => {
            const mapping = getMapping(cat.remote_id);
            const isMapped = !!mapping;
            const isEnabled = mapping ? mapping.enabled !== false : false;
            const rowClass = [
              "cs-mapping-row",
              isMapped && isEnabled ? "cs-mapping-row--mapped" : "",
              isMapped && !isEnabled ? "cs-mapping-row--disabled" : "",
            ].join(" ");

            return (
              <div key={cat.remote_id} className={rowClass}>
                <span
                  className={[
                    "cs-mapping-name",
                    isMapped && !isEnabled ? "cs-mapping-name--disabled" : "",
                  ].join(" ")}
                  title={cat.name}
                >
                  {cat.name}
                </span>

                <span
                  className={[
                    "cs-mapping-status",
                    isMapped && isEnabled
                      ? "cs-mapping-status--mapped"
                      : isMapped && !isEnabled
                      ? "cs-mapping-status--disabled"
                      : "cs-mapping-status--unmapped",
                  ].join(" ")}
                >
                  {isMapped && isEnabled
                    ? "已映射"
                    : isMapped && !isEnabled
                    ? "已禁用"
                    : "未映射"}
                </span>

                <select
                  className="cs-mapping-select"
                  value={mapping?.name || ""}
                  onChange={(e) =>
                    onMappingChange(cat.remote_id, e.target.value || null)
                  }
                  aria-label={`将 ${cat.name} 映射到系统分类`}
                >
                  <option value="">-- 选择系统分类 --</option>
                  {allSystemCategories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>

                <div className="cs-mapping-actions">
                  {isMapped && (
                    <>
                      <ToggleSwitch
                        checked={isEnabled}
                        onChange={() => onToggleMappingEnabled(cat.remote_id)}
                        title={isEnabled ? "禁用映射" : "启用映射"}
                      />
                      <button
                        type="button"
                        className="btn btn-icon"
                        onClick={() => onMappingChange(cat.remote_id, null)}
                        title="清除映射"
                        aria-label="清除映射"
                      >
                        <IconX size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ===== 主组件 ===== */

function compareMappings(a: CategoryMapping[], b: CategoryMapping[]) {
  if (a.length !== b.length) return false;
  const byRemote = (x: CategoryMapping) => x.remote_id;
  const sortedA = [...a].sort((x, y) => byRemote(x).localeCompare(byRemote(y)));
  const sortedB = [...b].sort((x, y) => byRemote(x).localeCompare(byRemote(y)));
  return sortedA.every((m, i) => {
    const n = sortedB[i];
    return (
      m.remote_id === n.remote_id &&
      m.name === n.name &&
      (m.enabled ?? true) === (n.enabled ?? true)
    );
  });
}

export default function CategorySettings({ sites }: CategorySettingsProps) {
  const [systemTree, setSystemTree] = useState<SystemCategoryTreeItem[]>([]);
  const [activeSiteId, setActiveSiteId] = useState<number | null>(null);
  const [siteStates, setSiteStates] = useState<
    Record<number, SiteCategoryState>
  >({});
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const loadSystemTree = useCallback(async () => {
    try {
      const tree = await listSystemCategories();
      setSystemTree(tree);
    } catch {
      toastError("加载系统分类失败");
    }
  }, []);

  useEffect(() => {
    loadSystemTree();
  }, [loadSystemTree]);

  useEffect(() => {
    if (sites.length > 0 && activeSiteId === null) {
      setActiveSiteId(sites[0].id);
    }
  }, [sites, activeSiteId]);

  useEffect(() => {
    if (activeSiteId === null) return;
    if (siteStates[activeSiteId]?.loaded) return;

    setSiteStates((prev) => ({
      ...prev,
      [activeSiteId]: {
        groups: prev[activeSiteId]?.groups || [],
        mappings: prev[activeSiteId]?.mappings || [],
        initialMappings: prev[activeSiteId]?.initialMappings || [],
        loading: true,
        loaded: false,
      },
    }));

    Promise.all([
      fetchRemoteCategories(activeSiteId),
      getSiteCategories(activeSiteId),
    ])
      .then(([remoteRes, savedRes]) => {
        const mappings = savedRes.categories || [];
        setSiteStates((prev) => ({
          ...prev,
          [activeSiteId]: {
            groups: remoteRes.groups || [],
            mappings,
            initialMappings: mappings,
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
        toastError("加载站点分类失败");
      });
  }, [activeSiteId]);

  const allSystemCategories = useMemo(() => {
    const names: string[] = [];
    for (const parent of systemTree) {
      for (const child of parent.children) {
        names.push(child.name);
      }
    }
    return names;
  }, [systemTree]);

  const dirtySiteIds = useMemo(() => {
    const ids: number[] = [];
    for (const site of sites) {
      const state = siteStates[site.id];
      if (!state) continue;
      if (!compareMappings(state.mappings, state.initialMappings)) {
        ids.push(site.id);
      }
    }
    return ids;
  }, [sites, siteStates]);

  const isDirty = dirtySiteIds.length > 0;

  const handleMappingChange = useCallback(
    (siteId: number, remoteId: string, systemName: string | null) => {
      setSiteStates((prev) => {
        const state = prev[siteId];
        if (!state) return prev;

        let nextMappings: CategoryMapping[];
        if (systemName === null) {
          nextMappings = state.mappings.filter((m) => m.remote_id !== remoteId);
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
      // 保存成功后刷新 initialMappings，熄灭未保存提示
      setSiteStates((prev) => {
        const next: Record<number, SiteCategoryState> = {};
        for (const [id, state] of Object.entries(prev)) {
          next[Number(id)] = { ...state, initialMappings: state.mappings };
        }
        return next;
      });
      toastSuccess("分类映射已保存");
    } catch {
      toastError("保存映射失败");
    } finally {
      setSaving(false);
    }
  }, [sites, siteStates]);

  const handleSmartMatch = useCallback(async () => {
    if (activeSiteId === null) return;
    setMatching(true);
    try {
      const result = await smartMatchCategories(activeSiteId);
      const autoMappings = result.matches.filter(
        (m) => m.status === "auto_mapped" && m.suggested_system_name
      );
      if (autoMappings.length === 0) {
        toastSuccess(
          `暂无可自动识别的分类（建议 ${result.summary.suggested} 个，无法识别 ${result.summary.unrecognized} 个）`
        );
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
      toastSuccess(
        `自动匹配完成：${autoMappings.length} 个已自动识别，${result.summary.suggested} 个建议手动确认，${result.summary.unrecognized} 个无法识别`
      );
    } catch (e: any) {
      toastError("自动匹配失败: " + (e?.message || "未知错误"));
    } finally {
      setMatching(false);
    }
  }, [activeSiteId]);

  const activeState =
    activeSiteId !== null ? siteStates[activeSiteId] : null;

  const displayState = useMemo<SiteCategoryState | null>(() => {
    if (!activeState) return null;
    if (showAll) return activeState;
    const mappedIds = new Set(
      activeState.mappings.map((m) => m.remote_id)
    );
    return {
      ...activeState,
      groups: activeState.groups
        .map((g) => ({
          ...g,
          categories: g.categories.filter((c) => !mappedIds.has(c.remote_id)),
        }))
        .filter((g) => g.categories.length > 0),
    };
  }, [activeState, showAll]);

  const leafCount = systemTree.reduce((acc, p) => acc + p.children.length, 0);

  return (
    <div className="cs-grid">
      {/* 左栏：系统分类管理 */}
      <div className="cs-column">
        <div className="cs-section-header">
          <h4 className="cs-section-title">系统分类</h4>
          <span className="cs-section-meta">{leafCount} 个子分类</span>
        </div>
        <SystemCategoryTree tree={systemTree} onRefresh={loadSystemTree} />
      </div>

      {/* 右栏：分类映射 */}
      <div className="cs-column">
        <div className="cs-mapping-toolbar">
          <ToggleSwitch
            checked={showAll}
            onChange={() => setShowAll((v) => !v)}
          >
            显示全部
          </ToggleSwitch>
          <div className="cs-mapping-toolbar-actions">
            <button
              type="button"
              className="btn"
              onClick={handleSmartMatch}
              disabled={matching || activeSiteId === null}
              style={{ fontSize: 13 }}
            >
              {matching ? "匹配中..." : "自动匹配"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !isDirty}
              style={{ fontSize: 13, gap: 4 }}
            >
              {saving ? "保存中..." : "保存映射"}
              {isDirty && !saving && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--danger)",
                    display: "inline-block",
                  }}
                />
              )}
            </button>
          </div>
        </div>

        <SiteTabs
          sites={sites}
          activeSiteId={activeSiteId}
          onChange={setActiveSiteId}
        />

        <div>
          {activeState?.loading ? (
            <div className="cs-mapping-skeleton">
              <div className="cs-skeleton-line" />
              <div className="cs-skeleton-line cs-skeleton-line--short" />
              <div className="cs-skeleton-line" />
              <div className="cs-skeleton-line cs-skeleton-line--short" />
            </div>
          ) : displayState && displayState.groups.length > 0 ? (
            <SiteCategoryMappings
              groups={displayState.groups}
              mappings={activeState?.mappings || []}
              allSystemCategories={allSystemCategories}
              onMappingChange={(rid, sys) =>
                activeSiteId !== null &&
                handleMappingChange(activeSiteId, rid, sys)
              }
              onToggleMappingEnabled={(rid) =>
                activeSiteId !== null &&
                handleToggleMappingEnabled(activeSiteId, rid)
              }
            />
          ) : displayState ? (
            <div className="cs-mapping-empty">
              <span className="cs-mapping-empty-title">
                {showAll ? "暂无分类数据" : "当前站点所有分类均已识别"}
              </span>
              {!showAll && (
                <span>切换「显示全部」可查看和修改已有映射</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
