import { useEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

interface VirtualGridProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  minItemWidth: number;
  gap?: number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function VirtualGrid<T>({
  items,
  itemKey,
  renderItem,
  minItemWidth,
  gap: fallbackGap = 24,
  overscan = 3,
  className,
  style,
}: VirtualGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [gap, setGap] = useState(fallbackGap);
  const [scrollMargin, setScrollMargin] = useState(0);

  // 监听容器宽度，动态计算列数；同时读取 CSS 中实际生效的 gap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const computedGap = parseFloat(getComputedStyle(el).gap) || fallbackGap;
      const width = rect.width;
      const count = Math.max(
        1,
        Math.floor((width + computedGap) / (minItemWidth + computedGap))
      );
      setColumnCount(count);
      setGap(computedGap);
      // 容器相对文档顶部的偏移，作为 window 虚拟器的 scrollMargin 基准
      setScrollMargin(rect.top + window.scrollY);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // 上方内容（轮播/「最新更新」封面懒加载）高度变化会改变容器在文档中的位置，
    // 但不改变容器自身尺寸，ResizeObserver 观察容器捕获不到，需额外观察 body。
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [minItemWidth, fallbackGap]);

  const rowCount = Math.ceil(items.length / columnCount);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => {
      // 粗略估算：海报 2:3（高≈列宽×1.5）+ 行底间距，实际行高由 measureElement 修正
      return minItemWidth * 1.5 + gap;
    },
    overscan,
    scrollMargin,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        ...style,
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualRows.map((virtualRow) => {
          const rowIndex = virtualRow.index;
          const startIndex = rowIndex * columnCount;
          const rowItems = items.slice(startIndex, startIndex + columnCount);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                gap,
                paddingBottom: gap,
              }}
            >
              {rowItems.map((item) => (
                <div key={itemKey(item)}>{renderItem(item)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
