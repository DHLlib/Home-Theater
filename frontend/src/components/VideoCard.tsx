import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDetail } from "../api/videos";
import { addFavorite } from "../api/favorites";
import { toastSuccess } from "../utils/toast";
import type { AggregatedVideo } from "../types";

interface VideoCardProps {
  item: AggregatedVideo;
  width?: number;
  showOverlay?: boolean;
}

function HeartIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export default function VideoCard({
  item,
  width,
  showOverlay = true,
}: VideoCardProps) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [poster, setPoster] = useState<string | null>(item.poster_url ?? null);
  const [loadingPoster, setLoadingPoster] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (poster || !item.sources.length) return;

    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !fetchedRef.current && !poster) {
            fetchedRef.current = true;
            setLoadingPoster(true);
            const first = item.sources[0];
            getDetail({
              title: item.title,
              year: item.year,
              sources: [first],
            })
              .then((res) => {
                const found = res.sources.find(
                  (s) =>
                    s.site_id === first.site_id &&
                    s.original_id === first.original_id
                );
                if (found?.poster_url) {
                  setPoster(found.poster_url);
                }
              })
              .catch(() => {
                // 静默失败，保持占位图
              })
              .finally(() => setLoadingPoster(false));
          }
        });
      },
      { rootMargin: "0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [item.poster_url, item.sources, item.title, item.year, poster]);

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.sources.length === 0) return;
    const first = item.sources[0];
    navigate(
      `/player?site_id=${first.site_id}&original_id=${encodeURIComponent(
        first.original_id
      )}&ep=0&title=${encodeURIComponent(item.title)}&year=${item.year ?? ""}`
    );
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    addFavorite({
      title: item.title,
      year: item.year,
      poster_url: poster || item.poster_url || undefined,
    }).then(() => toastSuccess("已收藏"));
  };

  return (
    <div
      ref={cardRef}
      className="video-card"
      role="button"
      tabIndex={0}
      aria-label={`${item.title}${item.year ? ` (${item.year})` : ""}`}
      style={width ? { width } : undefined}
      onClick={() => navigate("/detail", { state: item })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate("/detail", { state: item });
        }
      }}
    >
      <div
        className="poster-wrap"
        style={{
          aspectRatio: "2/3",
          background: "var(--card)",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border)",
          position: "relative",
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt={item.title}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : loadingPoster ? (
          <div className="skeleton" style={{ width: "100%", height: "100%" }} />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 8,
              color: "var(--text-secondary)",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.4 }}
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span style={{ fontSize: 12, opacity: 0.5 }}>暂无封面</span>
          </div>
        )}

        {/* 悬停信息层 */}
        {showOverlay && (
          <div className="card-overlay">
            <div className="card-overlay-content">
              <div className="meta-line">
                {item.sources.length > 1
                  ? `${item.sources.length} 个源`
                  : item.sources.length === 1
                  ? "1 个源"
                  : ""}
              </div>
              <div className="action-line">
                <button
                  className="action-btn"
                  onClick={handlePlay}
                  aria-label={`播放 ${item.title}`}
                >
                  播放
                </button>
                <button
                  className="action-btn secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate("/detail", { state: item });
                  }}
                  aria-label={`查看 ${item.title} 详情`}
                >
                  详情
                </button>
                <button
                  className="action-btn secondary"
                  onClick={handleFavorite}
                  aria-label={`收藏 ${item.title}`}
                >
                  <HeartIcon size={12} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div
        className="card-title"
        style={{ marginTop: 10, fontSize: 14, fontWeight: 500 }}
      >
        {item.title}
      </div>
      {item.year && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
          {item.year}
        </div>
      )}
    </div>
  );
}
