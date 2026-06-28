import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MobileVideoCard from "../components/MobileVideoCard";
import { useVideosInfinite } from "../../hooks/useVideos";

function videoKey(item: { title: string; year?: number | null }): string {
  return `${item.title}-${item.year ?? "null"}`;
}

export default function MobileSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wdFromUrl = searchParams.get("wd") || "";
  const [input, setInput] = useState(wdFromUrl);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    isCapped,
  } = useVideosInfinite({ wd: wdFromUrl });

  const videos = useMemo(() => data?.pages.flat() ?? [], [data]);

  const handleSearch = () => {
    const q = input.trim();
    if (!q) {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ wd: q }, { replace: true });
  };

  // 无限滚动 sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchNextPageRef = useRef(fetchNextPage);
  fetchNextPageRef.current = fetchNextPage;
  const isCappedRef = useRef(isCapped);
  isCappedRef.current = isCapped;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || isLoading || isCappedRef.current) return;

    const rootMargin = 300;
    const maybeFetch = () => {
      if (!isCappedRef.current) fetchNextPageRef.current();
    };

    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    if (
      rect.top <= viewportHeight + rootMargin &&
      rect.bottom >= -rootMargin
    ) {
      maybeFetch();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isCappedRef.current) {
          fetchNextPageRef.current();
        }
      },
      { rootMargin: `${rootMargin}px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isLoading, videos.length, isCapped]);

  const hasContent = videos.length > 0;

  return (
    <div className="mobile-page">
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">搜索</h1>
      </div>

      <div className="mobile-search-bar">
        <input
          className="mobile-search-input"
          type="search"
          placeholder="输入影片名称"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
        />
        <button className="mobile-search-btn" onClick={handleSearch}>
          搜索
        </button>
      </div>

      {wdFromUrl.trim() && !isLoading && videos.length === 0 && (
        <div className="mobile-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div className="mobile-empty-title">未找到相关视频</div>
          <p>试试其他关键词</p>
        </div>
      )}

      {isLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton" style={{ aspectRatio: "2/3", borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {videos.map((v) => (
          <MobileVideoCard key={videoKey(v)} item={v} />
        ))}
      </div>

      <div ref={sentinelRef} style={{ height: 1 }} />

      {isFetchingNextPage && (
        <div style={{ textAlign: "center", padding: 16 }}>
          <div className="spinner" style={{ width: 20, height: 20, display: "inline-block" }} />
          <span style={{ marginLeft: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            加载中...
          </span>
        </div>
      )}

      {(isCapped || !hasNextPage) && hasContent && (
        <div
          style={{
            textAlign: "center",
            padding: 24,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          {isCapped ? "— 已加载最大数量 —" : "— 已加载全部内容 —"}
        </div>
      )}
    </div>
  );
}
