import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  attachCategoryLinks,
  detachCategoryLinks,
  getCategoryOverview,
  getCategoryRemotes,
  refreshRemoteCategories,
  type CategoryNode,
  type CategoryOverview,
  type RemoteCategoryItem,
} from "../../api/category-settings";
import {
  createSystemCategory,
  deleteSystemCategory,
  updateSystemCategory,
} from "../../api/system-categories";
import { toastError, toastSuccess } from "../../utils/toast";
import "./CategorySettings.css";

type Adding = { kind: "big" | "child"; parentId?: number } | null;
type DeleteTarget = { kind: "big" | "child"; id: number } | null;

const fmt = (n: number) => Number(n || 0).toLocaleString("zh-CN");
const remoteKey = (r: RemoteCategoryItem) => `${r.site_id}|${r.remote_id}`;
const parentKey = (siteId: number, parent: string | null) =>
  `${siteId}|${parent || "未分组"}`;

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.2" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.8" cy="8" r="1.1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

function findNode(nodes: CategoryNode[], id: number): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function findParent(nodes: CategoryNode[], id: number): CategoryNode | null {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node;
    const found = findParent(node.children, id);
    if (found) return found;
  }
  return null;
}

function firstLeaf(nodes: CategoryNode[]): CategoryNode | null {
  const leaves: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const node of list) {
      if (node.children.length) walk(node.children);
      else leaves.push(node);
    }
  };
  walk(nodes);
  return leaves.find((node) => node.videos > 0) ?? leaves[0] ?? null;
}

function childNames(node: CategoryNode): string[] {
  return node.children.map((child) => child.name);
}

function renameNode(nodes: CategoryNode[], id: number, name: string): CategoryNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, name };
    if (node.children.length) {
      return { ...node, children: renameNode(node.children, id, name) };
    }
    return node;
  });
}

interface TriCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: TriCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
    />
  );
}

export default function CategorySettings() {
  const [overview, setOverview] = useState<CategoryOverview | null>(null);
  const [remotes, setRemotes] = useState<RemoteCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [siteExpanded, setSiteExpanded] = useState<Set<number>>(new Set());
  const [parentExpanded, setParentExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [attachedChecked, setAttachedChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<Adding>(null);
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [bigRename, setBigRename] = useState<{
    id: number;
    name: string;
    error: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const didInitTree = useRef(false);
  const didInitSites = useRef(false);

  const scrollDetailTop = () => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextOverview, nextRemotes] = await Promise.all([
        getCategoryOverview(),
        getCategoryRemotes(),
      ]);
      setOverview(nextOverview);
      setRemotes(nextRemotes.items);
      setError(false);
      setSelectedId((prev) => {
        if (prev != null && findNode(nextOverview.categories, prev)) {
          return prev;
        }
        return firstLeaf(nextOverview.categories)?.id ?? null;
      });

      if (!didInitTree.current && nextOverview.categories.length) {
        const leaf = firstLeaf(nextOverview.categories);
        const parent = leaf ? findParent(nextOverview.categories, leaf.id) : null;
        setExpanded(new Set(parent ? [parent.id] : [nextOverview.categories[0].id]));
        didInitTree.current = true;
      }
      if (!didInitSites.current) {
        const available = nextRemotes.items.filter(
          (item) => !item.attached_category_id && !item.stale
        );
        const firstSite = available[0]?.site_id;
        if (firstSite != null) {
          setSiteExpanded(new Set([firstSite]));
          setParentExpanded(
            new Set(
              available
                .filter((item) => item.site_id === firstSite)
                .map((item) => parentKey(item.site_id, item.parent_name))
            )
          );
          didInitSites.current = true;
        }
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (adding) {
      addInputRef.current?.focus();
    }
  }, [adding]);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (menuOpen == null) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".cat-big-menu") || target.closest(".cat-row-menu-btn")) {
        return;
      }
      setMenuOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (deleteTarget == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDeleteTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteTarget, busy]);

  const selectedCategory = useMemo(
    () => (overview && selectedId != null ? findNode(overview.categories, selectedId) : null),
    [overview, selectedId]
  );
  const selectedParent = useMemo(
    () =>
      overview && selectedCategory
        ? findParent(overview.categories, selectedCategory.id)
        : null,
    [overview, selectedCategory]
  );

  const attached = useMemo(
    () =>
      selectedCategory
        ? remotes.filter((item) => item.attached_category_id === selectedCategory.id)
        : [],
    [remotes, selectedCategory]
  );

  const available = useMemo(
    () => remotes.filter((item) => !item.attached_category_id && !item.stale),
    [remotes]
  );

  const snapshotSites = useMemo(
    () => new Set(remotes.map((item) => item.site_id)).size,
    [remotes]
  );

  const availableFiltered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return available;
    return available.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.site_name.toLowerCase().includes(keyword) ||
        (item.parent_name || "").toLowerCase().includes(keyword)
    );
  }, [available, query]);

  const checkedRemotes = useMemo(
    () => available.filter((item) => checked.has(remoteKey(item))),
    [available, checked]
  );

  const siteGroups = useMemo(() => {
    const groups = new Map<
      number,
      { siteName: string; items: RemoteCategoryItem[] }
    >();
    for (const item of availableFiltered) {
      const group = groups.get(item.site_id) ?? {
        siteName: item.site_name,
        items: [],
      };
      group.items.push(item);
      groups.set(item.site_id, group);
    }
    return new Map(
      [...groups.entries()].sort((a, b) => a[0] - b[0])
    );
  }, [availableFiltered]);

  const deleteNode = useMemo(
    () => (overview && deleteTarget ? findNode(overview.categories, deleteTarget.id) : null),
    [overview, deleteTarget]
  );
  const deleteSummary = useMemo(() => {
    if (!deleteTarget || !deleteNode) return null;
    if (deleteTarget.kind === "child") {
      return {
        title: deleteNode.name,
        childCount: 0,
        remotes: deleteNode.remotes,
        videos: deleteNode.videos,
        names: attached.map((item) => `${item.site_name} · ${item.name}`),
      };
    }
    return {
      title: deleteNode.name,
      childCount: deleteNode.children.length,
      remotes: deleteNode.children.reduce((sum, child) => sum + child.remotes, 0),
      videos: deleteNode.children.reduce((sum, child) => sum + child.videos, 0),
      names: childNames(deleteNode),
    };
  }, [deleteNode, deleteTarget, attached]);

  const toggleIdSet = (
    setter: (value: Set<number> | ((prev: Set<number>) => Set<number>)) => void,
    id: number
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStringSet = (
    setter: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
    key: string
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectCategory = (id: number) => {
    setSelectedId(id);
    setAttachedChecked(new Set());
    setQuery("");
    setRenaming(false);
    setRenameError("");
    setAdding(null);
    setAddError("");
    setMenuOpen(null);
    setBigRename(null);
    scrollDetailTop();
  };

  const startAdd = (kind: "big" | "child", parentId?: number) => {
    setAdding({ kind, parentId });
    setAddName("");
    setAddError("");
    setMenuOpen(null);
    if (parentId != null) {
      setExpanded((prev) => new Set(prev).add(parentId));
    }
  };

  const cancelAdd = () => {
    setAdding(null);
    setAddError("");
  };

  const submitBigRename = async () => {
    if (!bigRename || busy) return;
    const name = bigRename.name.trim();
    if (!name) {
      setBigRename((prev) => (prev ? { ...prev, error: "请输入分类名" } : prev));
      return;
    }
    setBusy(true);
    try {
      await updateSystemCategory(bigRename.id, { name });
      setBigRename(null);
      await load(true);
      toastSuccess(`已重命名大类为「${name}」`);
    } catch (err) {
      setBigRename((prev) =>
        prev
          ? {
              ...prev,
              error: err instanceof Error ? err.message : "重命名失败",
            }
          : prev
      );
    } finally {
      setBusy(false);
    }
  };

  const submitAdd = async () => {
    if (!adding || busy) return;
    const name = addName.trim();
    if (!name) {
      setAddError("请输入分类名");
      return;
    }
    setBusy(true);
    try {
      const created = await createSystemCategory({
        name,
        parent_id: adding.kind === "child" ? adding.parentId ?? null : null,
        sort: 999,
      });
      setAdding(null);
      setAddError("");
      if (adding.kind === "child" && adding.parentId != null) {
        setExpanded((prev) => new Set(prev).add(adding.parentId as number));
      } else if (adding.kind === "big") {
        setExpanded((prev) => new Set(prev).add(created.id));
      }
      await load(true);
      if (adding.kind === "child") setSelectedId(created.id);
      toastSuccess(
        adding.kind === "child"
          ? `已新增小类「${name}」· 0 内容也会出现在首页分类栏`
          : `已新增大类「${name}」`
      );
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "新增失败");
    } finally {
      setBusy(false);
    }
  };

  const startRename = () => {
    if (!selectedCategory) return;
    setRenaming(true);
    setRenameName(selectedCategory.name);
    setRenameError("");
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameError("");
  };

  const submitRename = async () => {
    if (!selectedCategory || busy) return;
    const name = renameName.trim();
    if (!name) {
      setRenameError("请输入分类名");
      return;
    }
    setBusy(true);
    try {
      const oldName = selectedCategory.name;
      await updateSystemCategory(selectedCategory.id, { name });
      setRenaming(false);
      setRenameError("");
      setOverview((prev) =>
        prev
          ? { ...prev, categories: renameNode(prev.categories, selectedCategory.id, name) }
          : prev
      );
      setRemotes((prev) =>
        prev.map((item) =>
          item.attached_category_id === selectedCategory.id
            ? { ...item, attached_category_name: name }
            : item
        )
      );
      toastSuccess(`已改名「${oldName}」→「${name}」`);
      void load(true);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "改名失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !deleteSummary || busy) return;
    setBusy(true);
    try {
      const result = await deleteSystemCategory(deleteTarget.id);
      setDeleteTarget(null);
      scrollDetailTop();
      toastSuccess(
        `已删除「${deleteSummary.title}」· ${result.links_removed} 个远程分类回到未挂载 · ${fmt(result.videos_reset)} 个视频变为未分类`
      );
      void load(true);
    } catch {
      // client 已统一 toast
    } finally {
      setBusy(false);
    }
  };

  const attachSelected = async () => {
    if (!selectedCategory || checkedRemotes.length === 0 || busy) return;
    const targets = checkedRemotes;
    const targetKeys = new Set(targets.map(remoteKey));
    const targetCount = targets.length;
    // 先本地落位，避免等 3 秒的远程快照刷新；落库失败时再回滚
    setRemotes((prev) =>
      prev.map((item) =>
        targetKeys.has(remoteKey(item))
          ? {
              ...item,
              attached_category_id: selectedCategory.id,
              attached_category_name: selectedCategory.name,
            }
          : item
      )
    );
    setChecked(new Set());
    scrollDetailTop();
    setBusy(true);
    try {
      const result = await attachCategoryLinks(
        targets.map((item) => ({
          site_id: item.site_id,
          remote_id: item.remote_id,
          system_category_id: selectedCategory.id,
        }))
      );
      toastSuccess(
        `已挂载 ${result.linked ?? targetCount} 个远程分类到「${selectedCategory.name}」· 重算 ${fmt(result.affected_videos)} 个视频`
      );
      void load(true);
    } catch {
      // client 已统一 toast
      void load(true);
    } finally {
      setBusy(false);
    }
  };

  const detachOne = async (item: RemoteCategoryItem) => {
    if (busy) return;
    setRemotes((prev) =>
      prev.map((row) =>
        remoteKey(row) === remoteKey(item)
          ? {
              ...row,
              attached_category_id: null,
              attached_category_name: null,
            }
          : row
      )
    );
    scrollDetailTop();
    setBusy(true);
    try {
      const result = await detachCategoryLinks([
        { site_id: item.site_id, remote_id: item.remote_id },
      ]);
      setAttachedChecked(new Set());
      toastSuccess(`已解除「${item.name}」· 重算 ${fmt(result.affected_videos)} 个视频`);
      void load(true);
    } catch {
      // client 已统一 toast
      void load(true);
    } finally {
      setBusy(false);
    }
  };

  const detachSelected = async () => {
    const items = attached.filter((item) => attachedChecked.has(remoteKey(item)));
    if (!items.length || busy) return;
    const keys = new Set(items.map(remoteKey));
    setRemotes((prev) =>
      prev.map((row) =>
        keys.has(remoteKey(row))
          ? {
              ...row,
              attached_category_id: null,
              attached_category_name: null,
            }
          : row
      )
    );
    setAttachedChecked(new Set());
    scrollDetailTop();
    setBusy(true);
    try {
      const result = await detachCategoryLinks(
        items.map((item) => ({ site_id: item.site_id, remote_id: item.remote_id }))
      );
      toastSuccess(`已解除 ${items.length} 个远程分类 · 重算 ${fmt(result.affected_videos)} 个视频`);
      void load(true);
    } catch {
      // client 已统一 toast
      void load(true);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await refreshRemoteCategories();
      await load(true);
      if (result.errors.length) {
        toastError(`已刷新 ${result.sites} 个站点，${result.errors.length} 个失败`);
      } else {
        toastSuccess(`已刷新 ${result.sites} 个站点 · 新增 ${result.added} 个远程分类`);
      }
    } catch {
      // client 已统一 toast
    } finally {
      setRefreshing(false);
    }
  };

  const smallCount = useMemo(
    () =>
      overview
        ? overview.categories.reduce((sum, node) => sum + node.children.length, 0)
        : 0,
    [overview]
  );

  const toggleSite = (siteId: number, next: boolean) => {
    const items = availableFiltered.filter((item) => item.site_id === siteId);
    setChecked((prev) => {
      const result = new Set(prev);
      for (const item of items) {
        if (next) result.add(remoteKey(item));
        else result.delete(remoteKey(item));
      }
      return result;
    });
  };

  const toggleParent = (siteId: number, parent: string | null, next: boolean) => {
    const items = availableFiltered.filter(
      (item) => item.site_id === siteId && (item.parent_name || null) === parent
    );
    setChecked((prev) => {
      const result = new Set(prev);
      for (const item of items) {
        if (next) result.add(remoteKey(item));
        else result.delete(remoteKey(item));
      }
      return result;
    });
  };

  if (loading && !overview) {
    return (
      <div className="cat-map-loading" aria-label="加载分类设置">
        <div className="cat-skeleton cat-skeleton--bar" />
        <div className="cat-skeleton cat-skeleton--panel" />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="cat-map-error">
        <p>分类设置加载失败。</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="cat-map">
      <div className="cat-status" aria-label="分类概览">
        <span>
          <b>{overview?.categories.length ?? 0}</b> 大类 · <b>{smallCount}</b> 小类
        </span>
        <span className="cat-sep" aria-hidden="true" />
        <span>
          <b>{fmt(overview?.summary.unmapped_remotes ?? 0)}</b> 未挂载
        </span>
        <span className="cat-sep" aria-hidden="true" />
        <span>
          <b>{fmt(overview?.summary.uncategorized_videos ?? 0)}</b> 未分类视频
        </span>
        <span className="cat-status-tail">
          {snapshotSites}/{overview?.summary.sites ?? 0} 个站点已同步 ·{" "}
          {fmt(overview?.summary.linked_remotes ?? 0)} 已挂载
        </span>
      </div>

      <section className="cat-workspace" aria-label="分类挂载工作区">
        <aside className="cat-tree-panel">
          <div className="cat-panel-head">
            <span className="cat-panel-title">系统分类</span>
            <span className="cat-panel-hint">仅小类可挂载</span>
          </div>
          <div className="cat-tree-scroll" role="tree" aria-label="系统分类树">
            {overview?.categories.map((big) => {
              const isExpanded = expanded.has(big.id);
              return (
                <div className="cat-tree-group" key={big.id}>
                  <div
                    className="cat-tree-row cat-tree-row--big"
                    role="treeitem"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => toggleIdSet(setExpanded, big.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleIdSet(setExpanded, big.id);
                      }
                    }}
                  >
                    <svg
                      className={`cat-chev${isExpanded ? " is-open" : ""}`}
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 3.5l4.5 4.5L6 12.5" />
                    </svg>
                    <span className="cat-tree-name">{big.name}</span>
                    <span className="cat-tree-meta">{big.children.length} 小类</span>
                    <button
                      type="button"
                      className="cat-row-btn"
                      title="新增小类"
                      aria-label={`在${big.name}下新增小类`}
                      onClick={(event) => {
                        event.stopPropagation();
                        startAdd("child", big.id);
                      }}
                    >
                      <PlusIcon />
                    </button>
                    <button
                      type="button"
                      className="cat-row-btn cat-row-menu-btn"
                      title="更多"
                      aria-label={`${big.name}更多操作`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen((prev) => (prev === big.id ? null : big.id));
                      }}
                    >
                      <MoreIcon />
                    </button>
                    {menuOpen === big.id && (
                      <div className="cat-big-menu" role="menu">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuOpen(null);
                            setBigRename({
                              id: big.id,
                              name: big.name,
                              error: "",
                            });
                          }}
                        >
                          重命名大类
                        </button>
                        <button
                          type="button"
                          className="cat-menu-danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuOpen(null);
                            setDeleteTarget({ kind: "big", id: big.id });
                          }}
                        >
                          删除大类
                        </button>
                      </div>
                    )}
                  </div>
                  {bigRename?.id === big.id && (
                    <form
                      className="cat-add-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitBigRename();
                      }}
                    >
                      <div className="cat-add-label">重命名大类</div>
                      <input
                        autoFocus
                        className="cat-input"
                        value={bigRename.name}
                        onChange={(event) =>
                          setBigRename((prev) =>
                            prev ? { ...prev, name: event.target.value } : prev
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setBigRename(null);
                        }}
                        aria-label="大类名"
                      />
                      {bigRename.error && (
                        <div className="cat-form-error">{bigRename.error}</div>
                      )}
                      <div className="cat-add-actions">
                        <button
                          type="button"
                          className="cat-text-btn"
                          onClick={() => setBigRename(null)}
                        >
                          取消
                        </button>
                        <button type="submit" className="btn cat-btn-sm" disabled={busy}>
                          保存
                        </button>
                      </div>
                    </form>
                  )}
                  {isExpanded && (
                    <div role="group">
                      {big.children.map((child) => {
                        const selected = selectedId === child.id;
                        return (
                          <div
                            key={child.id}
                            className={`cat-tree-row cat-tree-row--small${selected ? " is-selected" : ""}`}
                            role="treeitem"
                            tabIndex={0}
                            aria-selected={selected}
                            onClick={() => selectCategory(child.id)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                selectCategory(child.id);
                              }
                            }}
                          >
                            <span className="cat-tree-dot" aria-hidden="true" />
                            <span className="cat-tree-name">{child.name}</span>
                            <span className="cat-tree-meta">
                              {child.remotes} · {fmt(child.videos)}
                            </span>
                          </div>
                        );
                      })}
                      {adding?.kind === "child" && adding.parentId === big.id && (
                        <AddRow
                          label={`新增小类 · 挂到「${big.name}」`}
                          value={addName}
                          error={addError}
                          busy={busy}
                          inputRef={addInputRef}
                          onChange={setAddName}
                          onSubmit={() => void submitAdd()}
                          onCancel={cancelAdd}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {adding?.kind === "big" && (
              <AddRow
                label="新增大类"
                value={addName}
                error={addError}
                busy={busy}
                inputRef={addInputRef}
                onChange={setAddName}
                onSubmit={() => void submitAdd()}
                onCancel={cancelAdd}
              />
            )}
          </div>
          <div className="cat-tree-footer">
            <button type="button" className="cat-add-root" onClick={() => startAdd("big")}>
              <PlusIcon />
              新增大类
            </button>
          </div>
        </aside>

        <section className="cat-detail-panel">
          {selectedCategory ? (
            <>
              <header className="cat-detail-head">
                <div className="cat-detail-head-main">
                  <div className="cat-detail-crumb">
                    {selectedParent?.name ?? "未分组"}
                    <span className="cat-crumb-sep">/</span>
                    {selectedCategory.name}
                  </div>
                  <div className="cat-detail-title-row">
                    {renaming ? (
                      <form
                        className="cat-rename"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitRename();
                        }}
                      >
                        <input
                          ref={renameInputRef}
                          className="cat-input"
                          value={renameName}
                          onChange={(event) => setRenameName(event.target.value)}
                          aria-label="小类名"
                        />
                        <button type="submit" className="btn btn-primary cat-btn-sm" disabled={busy}>
                          保存
                        </button>
                        <button type="button" className="cat-text-btn" onClick={cancelRename}>
                          取消
                        </button>
                        {renameError && <div className="cat-form-error">{renameError}</div>}
                      </form>
                    ) : (
                      <h2 className="cat-detail-title">{selectedCategory.name}</h2>
                    )}
                  </div>
                  <div className="cat-detail-meta">
                    {attached.length} 个远程分类 · {fmt(selectedCategory.videos)} 个视频
                  </div>
                </div>
                {!renaming && (
                  <div className="cat-detail-actions">
                    <button type="button" className="cat-text-btn" onClick={startRename}>
                      改名
                    </button>
                    <button
                      type="button"
                      className="cat-text-btn cat-text-danger"
                      onClick={() => setDeleteTarget({ kind: "child", id: selectedCategory.id })}
                    >
                      删除
                    </button>
                  </div>
                )}
              </header>

              <div className="cat-detail-scroll" ref={detailScrollRef}>
                <div className="cat-attached">
                  <div className="cat-section-head">
                    <span className="cat-section-title">已挂载</span>
                    <span className="cat-section-count">{attached.length}</span>
                    {attached.length > 0 && (
                      <span className="cat-section-hint">来自不同站点，可分别解除</span>
                    )}
                  </div>
                  {attachedChecked.size > 0 && (
                    <div className="cat-bulk">
                      <span>
                        已选 <b>{attachedChecked.size}</b> 项
                      </span>
                      <button
                        type="button"
                        className="cat-text-btn"
                        onClick={() => void detachSelected()}
                        disabled={busy}
                      >
                        解除挂载
                      </button>
                    </div>
                  )}
                  {attached.length === 0 ? (
                    <div className="cat-empty">
                      <svg
                        className="cat-empty-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M10 13.5l4-4" />
                        <path d="M8.2 15.3l-1.4 1.4a3.4 3.4 0 01-4.8-4.8l3.1-3.1a3.4 3.4 0 014.8 0" />
                        <path d="M15.8 8.7l1.4-1.4a3.4 3.4 0 014.8 4.8l-3.1 3.1a3.4 3.4 0 01-4.8 0" />
                      </svg>
                      <div className="cat-empty-title">还没有挂载远程分类</div>
                      <div className="cat-empty-text">
                        从下方按站点勾选，挂到「{selectedCategory.name}」。即使 0 内容，它也会出现在首页分类栏。
                      </div>
                    </div>
                  ) : (
                    <div className="cat-attached-list">
                      {attached.map((item) => (
                        <div className="cat-attached-row" key={remoteKey(item)}>
                          <input
                            type="checkbox"
                            checked={attachedChecked.has(remoteKey(item))}
                            onChange={() =>
                              toggleStringSet(setAttachedChecked, remoteKey(item))
                            }
                            aria-label={`选择 ${item.site_name} ${item.name}`}
                          />
                          <div className="cat-attached-main">
                            <div className="cat-attached-line">
                              <span className="cat-site-badge">{item.site_name}</span>
                              <span className="cat-remote-name">{item.name}</span>
                              <span className="cat-attached-sample">
                                {item.samples[0] ?? ""}
                              </span>
                              {item.stale && <span className="cat-stale">站点已不返回</span>}
                            </div>
                          </div>
                          <span className="cat-remote-count">{fmt(item.sources)} 条</span>
                          <button
                            type="button"
                            className="cat-text-btn"
                            onClick={() => void detachOne(item)}
                            disabled={busy}
                          >
                            解除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="cat-available">
                  <div className="cat-available-head">
                    <div className="cat-available-title">
                      <span className="cat-section-title">可挂载的远程分类</span>
                      <span className="cat-section-count">{available.length}</span>
                      <span className="cat-available-hint">
                        按站点分组，勾选后挂到「{selectedCategory.name}」
                      </span>
                    </div>
                    <div className="cat-available-tools">
                      {query.trim() && (
                        <span className="cat-match">匹配 {availableFiltered.length} 个</span>
                      )}
                      <label className="cat-search">
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <circle cx="7" cy="7" r="4.6" />
                          <path d="M10.4 10.4L14 14" />
                        </svg>
                        <input
                          type="search"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="搜索远程分类"
                          aria-label="搜索远程分类"
                        />
                      </label>
                      <button
                        type="button"
                        className="cat-icon-btn"
                        title="重新拉取远程分类"
                        aria-label="重新拉取远程分类"
                        onClick={() => void refresh()}
                        disabled={refreshing}
                      >
                        <svg
                          className={refreshing ? "is-spinning" : ""}
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M13.2 7.2A5.3 5.3 0 003.2 4.4L1.8 6" />
                          <path d="M2.8 8.8a5.3 5.3 0 0010 2.8l1.4-1.6" />
                          <path d="M1.8 2.6V6h3.4M14.2 13.4V10h-3.4" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="cat-available-list">
                    {[...siteGroups.entries()].map(([siteId, group]) => {
                      const items = group.items;
                      const checkedCount = items.filter((item) =>
                        checked.has(remoteKey(item))
                      ).length;
                      const siteOpen = siteExpanded.has(siteId);
                      const siteChecked = items.length > 0 && checkedCount === items.length;
                      const siteIndeterminate =
                        checkedCount > 0 && checkedCount < items.length;
                      const parentNames = Array.from(
                        new Set(items.map((item) => item.parent_name || "未分组"))
                      );
                      return (
                        <div className="cat-site-group" key={siteId}>
                          <div
                            className="cat-site-head"
                            role="button"
                            tabIndex={0}
                            aria-expanded={siteOpen}
                            onClick={(event) => {
                              if ((event.target as HTMLElement).closest("input")) return;
                              toggleIdSet(setSiteExpanded, siteId);
                            }}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleIdSet(setSiteExpanded, siteId);
                              }
                            }}
                          >
                            <svg
                              className={`cat-chev${siteOpen ? " is-open" : ""}`}
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              aria-hidden="true"
                            >
                              <path d="M6 3.5l4.5 4.5L6 12.5" />
                            </svg>
                            <TriCheckbox
                              checked={siteChecked}
                              indeterminate={siteIndeterminate}
                              onChange={(next) => toggleSite(siteId, next)}
                              label={`选择 ${group.siteName} 的全部远程分类`}
                            />
                            <span className="cat-site-name">{group.siteName}</span>
                            <span className="cat-site-count">{items.length} 个未挂载</span>
                          </div>
                          {siteOpen &&
                            parentNames.map((parent) => {
                              const parentItems = items.filter(
                                (item) => (item.parent_name || "未分组") === parent
                              );
                              const parentCheckedCount = parentItems.filter((item) =>
                                checked.has(remoteKey(item))
                              ).length;
                              const key = parentKey(siteId, parent === "未分组" ? null : parent);
                              const parentOpen = parentExpanded.has(key);
                              return (
                                <div className="cat-parent-group" key={key}>
                                  <div
                                    className="cat-parent-head"
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={parentOpen}
                                    onClick={(event) => {
                                      if ((event.target as HTMLElement).closest("input")) return;
                                      toggleStringSet(setParentExpanded, key);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.target !== event.currentTarget) return;
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        toggleStringSet(setParentExpanded, key);
                                      }
                                    }}
                                  >
                                    <svg
                                      className={`cat-chev${parentOpen ? " is-open" : ""}`}
                                      viewBox="0 0 16 16"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.7"
                                      strokeLinecap="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M6 3.5l4.5 4.5L6 12.5" />
                                    </svg>
                                    <TriCheckbox
                                      checked={
                                        parentItems.length > 0 &&
                                        parentCheckedCount === parentItems.length
                                      }
                                      indeterminate={
                                        parentCheckedCount > 0 &&
                                        parentCheckedCount < parentItems.length
                                      }
                                      onChange={(next) =>
                                        toggleParent(
                                          siteId,
                                          parent === "未分组" ? null : parent,
                                          next
                                        )
                                      }
                                      label={`选择 ${group.siteName} ${parent} 的全部远程分类`}
                                    />
                                    <span className="cat-parent-name">{parent}</span>
                                    <span className="cat-parent-count">{parentItems.length}</span>
                                  </div>
                                  {parentOpen &&
                                    parentItems.map((item) => {
                                      const itemKey = remoteKey(item);
                                      const isChecked = checked.has(itemKey);
                                      return (
                                        <label
                                          className={`cat-remote-row${isChecked ? " is-checked" : ""}`}
                                          key={itemKey}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() =>
                                              toggleStringSet(setChecked, itemKey)
                                            }
                                          />
                                          <span className="cat-remote-copy">
                                            <span className="cat-remote-title-line">
                                              <span className="cat-remote-name">{item.name}</span>
                                              <span className="cat-remote-row-count">
                                                {fmt(item.sources)} 条
                                              </span>
                                            </span>
                                            <span className="cat-remote-sample">
                                              {item.samples[0] ?? ""}
                                            </span>
                                          </span>
                                        </label>
                                      );
                                    })}
                                </div>
                              );
                            })}
                        </div>
                      );
                    })}
                    {siteGroups.size === 0 && (
                      <div className="cat-available-empty">
                        {query.trim()
                          ? "没有匹配的远程分类"
                          : remotes.length === 0
                            ? "还没有远程分类快照，点右上方刷新从站点拉取"
                            : "所有远程分类都已挂载"}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <footer className="cat-detail-footer">
                <div className="cat-sel-summary">
                  <span className={`cat-sel-title${checkedRemotes.length ? "" : " is-muted"}`}>
                    {checkedRemotes.length
                      ? `已选 ${checkedRemotes.length} 项`
                      : `勾选远程分类后挂到「${selectedCategory.name}」`}
                  </span>
                  {checkedRemotes.length > 0 && (
                    <span className="cat-sel-names">
                      {checkedRemotes
                        .slice(0, 2)
                        .map((item) => `${item.site_name} · ${item.name}`)
                        .join("、")}
                      {checkedRemotes.length > 2
                        ? ` 等 ${checkedRemotes.length} 项`
                        : ""}
                    </span>
                  )}
                </div>
                <div className="cat-footer-actions">
                  {checkedRemotes.length > 0 && (
                    <button type="button" className="cat-text-btn" onClick={() => setChecked(new Set())}>
                      清除
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void attachSelected()}
                    disabled={checkedRemotes.length === 0 || busy}
                  >
                    挂载到「{selectedCategory.name}」
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="cat-detail-placeholder">
              <p>从左侧选择一个小类开始配置。</p>
              <button type="button" className="cat-add-root" onClick={() => startAdd("big")}>
                <PlusIcon />
                新增大类
              </button>
            </div>
          )}
        </section>
      </section>

      {deleteTarget && deleteSummary && (
        <div
          className="cat-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) setDeleteTarget(null);
          }}
        >
          <div
            className="cat-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cat-delete-title"
          >
            <button
              type="button"
              className="cat-dialog-close"
              onClick={() => setDeleteTarget(null)}
              aria-label="关闭"
              disabled={busy}
            >
              <CloseIcon />
            </button>
            <div className="cat-dialog-head">
              <h2 id="cat-delete-title">删除「{deleteSummary.title}」？</h2>
              <p>
                {deleteTarget.kind === "big"
                  ? `这是系统大类，会一并删除 ${deleteSummary.childCount} 个小类。`
                  : "这是系统小类。"}
              </p>
            </div>
            <div className="cat-dialog-body">
              <div className="cat-dialog-summary">
                {deleteTarget.kind === "big" && (
                  <div>
                    <span>小类一并删除</span>
                    <b>{deleteSummary.childCount} 个</b>
                  </div>
                )}
                <div>
                  <span>远程分类回到未挂载</span>
                  <b>{deleteSummary.remotes} 个</b>
                </div>
                <div>
                  <span>视频变为未分类</span>
                  <b>{fmt(deleteSummary.videos)} 个</b>
                </div>
              </div>
              {deleteSummary.names.length > 0 && (
                <div className="cat-dialog-list">
                  {deleteSummary.names.map((name) => (
                    <div key={name}>{name}</div>
                  ))}
                </div>
              )}
              <p className="cat-dialog-warning">
                删除后不会迁移到其他分类；这些远程分类会回到未挂载列表。
              </p>
            </div>
            <div className="cat-dialog-foot">
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
                autoFocus
              >
                取消
              </button>
              <button
                type="button"
                className="btn cat-danger-btn"
                onClick={() => void confirmDelete()}
                disabled={busy}
              >
                {deleteTarget.kind === "big" ? "删除大类及全部小类" : "解除挂载并删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AddRowProps {
  label: string;
  value: string;
  error: string;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function AddRow({
  label,
  value,
  error,
  busy,
  inputRef,
  onChange,
  onSubmit,
  onCancel,
}: AddRowProps) {
  return (
    <form
      className="cat-add-row"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="cat-add-label">{label}</div>
      <input
        ref={inputRef}
        className="cat-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入分类名，回车添加"
        aria-label={label}
      />
      {error && <div className="cat-form-error">{error}</div>}
      <div className="cat-add-actions">
        <button type="button" className="cat-text-btn" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn cat-btn-sm" disabled={busy}>
          添加
        </button>
      </div>
      <div className="cat-add-hint">回车添加，Esc 取消</div>
    </form>
  );
}
