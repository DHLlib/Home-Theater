import { useEffect, useMemo, useRef, useState } from "react";
import type { Site } from "../types";

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
    <div style={{ position: "relative", marginBottom: 16 }}>
      <div
        ref={containerRef}
        className="row"
        style={{
          gap: 8,
          flexWrap: "wrap",
          overflow: "hidden",
          maxHeight: expanded ? undefined : 40,
          paddingRight: overflow && !expanded ? 76 : undefined,
        }}
      >
        <button
          className="btn"
          style={{
            background: activeCategory === null ? "var(--primary)" : undefined,
            color: activeCategory === null ? "#fff" : undefined,
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
              color: activeCategory === name ? "#fff" : undefined,
            }}
            onClick={() => onSelect(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {overflow && (
        <button
          className="btn"
          onClick={() => setExpanded(!expanded)}
          style={{
            position: "absolute",
            right: 0,
            top: 3,
            fontSize: 12,
            padding: "4px 10px",
            lineHeight: 1,
          }}
        >
          {expanded ? "⬆️ 收起" : "⬇️ 更多"}
        </button>
      )}
    </div>
  );
}
