import { useEffect, useMemo, useRef, useState } from "react";

export interface CategoryOption {
  name: string;
  /** 可选的视频数，用来判断该不该往这里塞 */
  count?: number;
}

interface Props {
  value: string;
  options: CategoryOption[];
  recent?: string[];
  onChange: (value: string) => void;
  /** 传入时下拉底部出现「＋ 新建分类…」；返回新分类名表示创建成功 */
  onCreate?: (name: string, parentName: string | null) => Promise<string | null>;
  /** 可作为父级的大类名（新建时的归属） */
  parents?: string[];
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * 可搜索的分类选择器：48 个分类用原生 select 太难找，这里支持输入筛选、
 * 最近使用置顶，以及就地新建分类。
 */
export default function CategoryCombobox({
  value,
  options,
  recent = [],
  onChange,
  onCreate,
  parents = [],
  disabled,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [options, query]);

  const recentItems = useMemo(
    () =>
      recent
        .map((name) => options.find((item) => item.name === name))
        .filter((item): item is CategoryOption => Boolean(item))
        .slice(0, 3),
    [recent, options]
  );

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
    setCreating(false);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || !onCreate) return;
    setBusy(true);
    try {
      const created = await onCreate(name, newParent || null);
      if (created) pick(created);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="combo" ref={rootRef}>
      <button
        type="button"
        className={`combo-trigger${value ? "" : " is-empty"}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span>{value || "选择系统分类"}</span>
        <span className="combo-caret">▼</span>
      </button>

      {open && (
        <div className="combo-pop" role="listbox">
          {!creating ? (
            <>
              <input
                className="combo-search"
                type="search"
                autoFocus
                placeholder="搜索分类…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                  if (event.key === "Enter" && filtered[0]) pick(filtered[0].name);
                }}
              />
              {recentItems.length > 0 && !query && (
                <>
                  <div className="combo-label">最近使用</div>
                  {recentItems.map((item) => (
                    <button
                      type="button"
                      className="combo-opt"
                      key={`recent-${item.name}`}
                      onClick={() => pick(item.name)}
                    >
                      <span>{item.name}</span>
                      {typeof item.count === "number" && (
                        <span className="combo-count">{item.count.toLocaleString()}</span>
                      )}
                    </button>
                  ))}
                </>
              )}
              <div className="combo-label">全部分类</div>
              <div className="combo-list">
                {filtered.map((item) => (
                  <button
                    type="button"
                    className={`combo-opt${item.name === value ? " is-active" : ""}`}
                    key={item.name}
                    onClick={() => pick(item.name)}
                  >
                    <span>{item.name}</span>
                    {typeof item.count === "number" && (
                      <span className="combo-count">{item.count.toLocaleString()}</span>
                    )}
                  </button>
                ))}
                {filtered.length === 0 && <div className="combo-empty">没有匹配的分类</div>}
              </div>
              {onCreate && (
                <button
                  type="button"
                  className="combo-new"
                  onClick={() => {
                    setCreating(true);
                    setNewName(query.trim());
                  }}
                >
                  ＋ 新建分类…
                </button>
              )}
            </>
          ) : (
            <div className="combo-create">
              <div className="combo-label">新建分类</div>
              <input
                className="combo-search"
                autoFocus
                placeholder="分类名"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitCreate();
                }}
              />
              <select
                className="combo-parent"
                value={newParent}
                onChange={(event) => setNewParent(event.target.value)}
                aria-label="新建分类挂到哪个大类下"
              >
                <option value="">作为大类</option>
                {parents.map((name) => (
                  <option key={name} value={name}>
                    挂到「{name}」下
                  </option>
                ))}
              </select>
              <div className="combo-actions">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={busy || !newName.trim()}
                  onClick={submitCreate}
                >
                  创建并选用
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
