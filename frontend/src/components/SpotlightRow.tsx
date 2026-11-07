import { useCallback, useEffect, useRef, useState } from "react";
import VideoCard from "./VideoCard";
import type { AggregatedVideo } from "../types";

interface SpotlightRowProps {
  videos: AggregatedVideo[];
  loading?: boolean;
}

/**
 * 推荐横条：品类标准件里的「一行」。
 * 用与封面墙同一张卡，横向滚动 + 吸附；桌面端悬停出现左右翻页。
 */
export default function SpotlightRow({ videos, loading = false }: SpotlightRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  const updateScrollable = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanScroll(el.scrollWidth - el.clientWidth > 8);
  }, []);

  useEffect(() => {
    updateScrollable();
    const el = trackRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScrollable);
      return () => window.removeEventListener("resize", updateScrollable);
    }
    const ro = new ResizeObserver(updateScrollable);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollable, videos.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.8, 320);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  if (!loading && videos.length === 0) return null;

  return (
    <section className="spot-row" aria-label="推荐">
      <div className="spot-head">
        <h2 className="spot-title">推荐</h2>
        <span className="spot-count tnum">{videos.length} 部</span>
      </div>

      <div className="spot-viewport">
        <div className="spot-track" ref={trackRef}>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div className="spot-item" key={i}>
                  <div className="skeleton spot-skeleton" />
                </div>
              ))
            : videos.map((v) => (
                <div className="spot-item" key={`${v.title}-${v.year ?? "null"}`}>
                  <VideoCard item={v} />
                </div>
              ))}
        </div>

        {!loading && canScroll && (
          <>
            <button
              type="button"
              className="spot-arrow left"
              aria-label="向左翻页"
              onClick={() => scrollBy(-1)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              className="spot-arrow right"
              aria-label="向右翻页"
              onClick={() => scrollBy(1)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
