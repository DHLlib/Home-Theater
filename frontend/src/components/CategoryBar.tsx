import { useEffect, useMemo, useRef, useState } from "react";
import type { Site } from "../types";

interface CategoryBarProps {
  sites: Site[];
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
}

function ChevronUpIcon({ size = 14 }: { size?: number }) {
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
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDownIcon({ size = 14 }: { size?: number }) {
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function CategoryBar({
  sites,
  activeCategory,
  onSelect,
}: CategoryBarProps) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const site of sites) {
      for (const cat of site.categories || []) {
        if (cat.name) set.add(cat.name);
      }
    }
    return Array.from(set).sort();
  }, [sites]);

  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setOverflow(el.scrollHeight > el.clientHeight);
  }, [categories]);

  if (categories.length === 0) return null;

  return (
    <div className="row" style={{ gap: 8, marginBottom: 16, alignItems: "flex-start" }}>
      {/* 分类列表 */}
      <div
        ref={containerRef}
        className="row"
        style={{
          gap: 8,
          flexWrap: "wrap",
          overflow: "hidden",
          maxHeight: expanded ? undefined : 44,
          flex: 1,
        }}
      >
        <button
          className="btn"
          style={{
            background: activeCategory === null ? "var(--primary)" : undefined,
            color: activeCategory === null ? "var(--primary-fg)" : undefined,
            borderColor: activeCategory === null ? "var(--primary)" : undefined,
          }}
          onClick={() => onSelect(null)}
        >
          全部
        </button>
        {categories.map((name) => (
          <button
            key={name}
            className="btn"
            style={{
              background: activeCategory === name ? "var(--primary)" : undefined,
              color: activeCategory === name ? "var(--primary-fg)" : undefined,
              borderColor: activeCategory === name ? "var(--primary)" : undefined,
            }}
            onClick={() => onSelect(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {/* 更多/收起按钮 — 紧跟列表右侧 */}
      {overflow && (
        <button
          className="btn"
          onClick={() => setExpanded(!expanded)}
          style={{
            fontSize: 12,
            padding: "4px 10px",
            minHeight: 32,
            flexShrink: 0,
          }}
          aria-label={expanded ? "收起分类" : "展开更多分类"}
        >
          <span className="row" style={{ gap: 4 }}>
            {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
            {expanded ? "收起" : "更多"}
          </span>
        </button>
      )}
    </div>
  );
}
