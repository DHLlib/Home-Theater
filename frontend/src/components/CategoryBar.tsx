import { useEffect, useMemo, useRef, useState } from "react";
import { listSystemCategories } from "../api/system-categories";
import type { Site, SystemCategoryTreeItem } from "../types";

interface CategoryBarProps {
  sites: Site[];
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
}

export default function CategoryBar({
  sites,
  activeCategory,
  onSelect,
}: CategoryBarProps) {
  const [systemTree, setSystemTree] = useState<SystemCategoryTreeItem[]>([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = () => listSystemCategories().then(setSystemTree).catch(() => {});
    load();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const site of sites) {
      for (const cat of site.categories || []) {
        if (cat.name) set.add(cat.name);
      }
    }
    return set;
  }, [sites]);

  const groups = useMemo(() => {
    const result: { label: string; items: string[] }[] = [];
    for (const parent of systemTree) {
      if (parent.enabled === false) continue;
      const visibleChildren = parent.children
        .filter((c) => c.enabled !== false)
        .map((c) => c.name)
        .filter((name) => availableCategories.has(name));
      if (visibleChildren.length > 0) {
        result.push({ label: parent.name, items: visibleChildren });
      }
    }
    return result;
  }, [systemTree, availableCategories]);

  // 当前选中的子类属于哪个父类
  const activeParent = useMemo(() => {
    if (!activeCategory) return null;
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

  if (availableCategories.size === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* 父类导航栏 */}
      <div
        className="row"
        style={{
          gap: 0,
          flexWrap: "wrap",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: 1,
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
                onClick={() => {
                  // 点击父类不触发筛选，仅展开下拉
                  setMenuOpen(group.label);
                }}
                style={{
                  color: isActive ? "var(--text-primary)" : undefined,
                  borderBottom: isActive
                    ? "2px solid var(--primary)"
                    : isOpen
                    ? "2px solid rgba(255,255,255,0.15)"
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
      </div>
    </div>
  );
}
