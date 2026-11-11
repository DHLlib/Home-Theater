import { useEffect, useMemo, useRef, useState } from "react";
import { listSystemCategories } from "../api/system-categories";
import { getCategoryStats, type CategoryStats } from "../api/category-aliases";
import type { SystemCategoryTreeItem } from "../types";

/** 未分类伪分类：后端把 system_category 为空视为未分类 */
export const UNCATEGORIZED = "未分类";

interface CategoryBarProps {
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
  variant?: "default" | "inline";
}

export default function CategoryBar({
  activeCategory,
  onSelect,
  variant = "default",
}: CategoryBarProps) {
  const isInline = variant === "inline";
  const [systemTree, setSystemTree] = useState<SystemCategoryTreeItem[]>([]);
  const [stats, setStats] = useState<CategoryStats | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ht-recent-categories") || "[]");
    } catch {
      return [];
    }
  });
  const searchRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = () => {
      listSystemCategories()
        .then(setSystemTree)
        .catch(() => {});
      getCategoryStats()
        .then(setStats)
        .catch(() => {});
    };
    load();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
  }, []);

  // 只展示有内容的分类：计数来自视频级分类（aggregated_videos.system_category）
  const groups = useMemo(() => {
    if (!stats) return [];
    const counts = stats.counts;
    const result: { label: string; items: string[] }[] = [];
    for (const parent of systemTree) {
      if (parent.enabled === false) continue;
      const visibleChildren = parent.children
        .filter((c) => c.enabled !== false && (counts[c.name] || 0) > 0)
        .map((c) => c.name);
      const parentCount = counts[parent.name] || 0;
      if (visibleChildren.length > 0 || parentCount > 0) {
        result.push({ label: parent.name, items: visibleChildren });
      }
    }
    return result;
  }, [systemTree, stats]);

  const uncategorizedCount = stats?.uncategorized ?? 0;

  // 扁平收集所有分类（父 + 子），供搜索用
  const flatCategories = useMemo(() => {
    const list: { name: string; parent: string | null }[] = [];
    for (const group of groups) {
      list.push({ name: group.label, parent: null });
      for (const item of group.items) list.push({ name: item, parent: group.label });
    }
    return list;
  }, [groups]);

  const searchResults = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return recent
        .map((name) => flatCategories.find((item) => item.name === name))
        .filter((item): item is { name: string; parent: string | null } => Boolean(item))
        .slice(0, 6);
    }
    return flatCategories
      .filter((item) => item.name.toLowerCase().includes(keyword))
      .slice(0, 12);
  }, [query, recent, flatCategories]);

  // 点搜索框外部关闭
  useEffect(() => {
    if (!searchOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [searchOpen]);

  const pickCategory = (name: string) => {
    onSelect(name);
    setMenuOpen(null);
    setSearchOpen(false);
    setQuery("");
    setRecent((prev) => {
      const next = [name, ...prev.filter((item) => item !== name)].slice(0, 6);
      try {
        localStorage.setItem("ht-recent-categories", JSON.stringify(next));
      } catch {
        // 隐私模式下写入失败可忽略
      }
      return next;
    });
  };

  // 当前选中的分类属于哪个父类（支持一级分类直接选中）
  const activeParent = useMemo(() => {
    if (!activeCategory) return null;
    for (const g of groups) {
      if (g.label === activeCategory) return g.label;
    }
    for (const g of groups) {
      if (g.items.includes(activeCategory)) return g.label;
    }
    return null;
  }, [activeCategory, groups]);

  const handleEnter = (label: string) => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setMenuOpen(label);
  };

  const handleLeave = () => {
    hideTimer.current = setTimeout(() => {
      setMenuOpen(null);
    }, 150);
  };

  if (groups.length === 0 && uncategorizedCount === 0) return null;

  return (
    <div
      className={isInline ? "category-bar category-bar--inline" : "category-bar"}
      style={{ marginBottom: isInline ? 0 : 16 }}
    >
      {/* 父类导航栏 */}
      <div
        className="row category-bar-parents"
        style={{
          alignItems: "center",
          borderBottom: isInline
            ? "none"
            : "1px solid var(--border)",
          paddingBottom: isInline ? 0 : 1,
        }}
      >
        {/* 全部 */}
        <button
          className="nav-link"
          onClick={() => onSelect(null)}
          style={{
            color:
              activeCategory === null
                ? "var(--text-primary)"
                : undefined,
            borderBottom:
              activeCategory === null
                ? "2px solid var(--primary)"
                : "2px solid transparent",
            marginBottom: -1,
          }}
        >
          全部
        </button>

        {groups.map((group) => {
          const isActive = activeParent === group.label;
          const isOpen = menuOpen === group.label;
          return (
            <div
              key={group.label}
              style={{ position: "relative" }}
              onMouseEnter={() => handleEnter(group.label)}
              onMouseLeave={handleLeave}
            >
              <button
                className="nav-link"
                aria-haspopup="true"
                aria-expanded={isOpen}
                onClick={() => {
                  // 点击/回车：先按父类筛选，同时展开子类（hover 只是增强，
                  // 触屏与键盘用户也能到达二级分类）
                  onSelect(group.label);
                  setMenuOpen(isOpen ? null : group.label);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMenuOpen(null);
                }}
                style={{
                  color: isActive ? "var(--text-primary)" : undefined,
                  borderBottom: isActive
                    ? "2px solid var(--primary)"
                    : isOpen
                    ? "2px solid var(--border-hover)"
                    : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {group.label}
              </button>

              {/* 下拉子类框 */}
              {isOpen && (
                <div
                  className="category-dropdown"
                  onMouseEnter={() => handleEnter(group.label)}
                  onMouseLeave={handleLeave}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      padding: "2px",
                    }}
                  >
                    {group.items.map((name) => (
                      <button
                        key={name}
                        className={`category-pill${
                          activeCategory === name ? " active" : ""
                        }`}
                        onClick={() => {
                          onSelect(name);
                          setMenuOpen(null);
                        }}
                        title={`${(stats?.counts[name] ?? 0).toLocaleString()} 条`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 「未分类」不再作为大类出现在分类栏：它是内容没归类的结果，不是分类。
            未分类内容在「设置 → 分类 → 映射工作台 / 高级」里处理，首页与「全部」仍能看到。 */}

        {/* 分类搜索：48 个小类靠 hover 逐个找太慢 */}
        <div className="category-search" ref={searchRef}>
          <button
            type="button"
            className="nav-link category-search-toggle"
            onClick={() => setSearchOpen((prev) => !prev)}
            aria-label="搜索分类"
            aria-expanded={searchOpen}
            title="搜索分类"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {searchOpen && (
            <div className="category-search-pop">
              <input
                className="category-search-input"
                autoFocus
                type="search"
                placeholder="搜索分类…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearchOpen(false);
                  if (event.key === "Enter" && searchResults[0]) {
                    pickCategory(searchResults[0].name);
                  }
                }}
              />
              <div className="category-search-label">
                {query.trim() ? "匹配" : "最近使用"}
              </div>
              {searchResults.length === 0 ? (
                <div className="category-search-empty">
                  {query.trim() ? "没有匹配的分类" : "还没有最近使用的分类"}
                </div>
              ) : (
                searchResults.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    className="category-search-option"
                    onClick={() => pickCategory(item.name)}
                  >
                    <span>{item.name}</span>
                    {item.parent && (
                      <span className="category-search-parent">{item.parent}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
