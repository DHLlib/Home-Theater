import { useEffect, useMemo, useState } from "react";
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

  // 加载系统分类树
  useEffect(() => {
    listSystemCategories().then(setSystemTree).catch(() => {});
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

  // 构建分组：父分类 -> 该父下可用的子分类列表
  // 过滤掉 enabled=false 的分类；父分类被禁用时其下所有子类不展示
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

  if (availableCategories.size === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginBottom: 16,
      }}
    >
      {/* 全部按钮 */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn"
          style={{
            background:
              activeCategory === null ? "var(--primary)" : undefined,
            color: activeCategory === null ? "var(--primary-fg)" : undefined,
            borderColor:
              activeCategory === null ? "var(--primary)" : undefined,
          }}
          onClick={() => onSelect(null)}
        >
          全部
        </button>
      </div>

      {/* 分组展示 */}
      {groups.map((group) => (
        <div
          key={group.label}
          className="row"
          style={{
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-secondary)",
              minWidth: 48,
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            {group.label}
          </span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", flex: 1 }}>
            {group.items.map((name) => (
              <button
                key={name}
                className="btn"
                style={{
                  padding: "4px 10px",
                  fontSize: 13,
                  minHeight: 28,
                  background:
                    activeCategory === name
                      ? "var(--primary)"
                      : undefined,
                  color:
                    activeCategory === name
                      ? "var(--primary-fg)"
                      : undefined,
                  borderColor:
                    activeCategory === name
                      ? "var(--primary)"
                      : undefined,
                }}
                onClick={() => onSelect(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
