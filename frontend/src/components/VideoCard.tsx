import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { addFavorite } from "../api/favorites";
import { toastSuccess } from "../utils/toast";
import { useIsMobile } from "../hooks/useViewport";
import type { AggregatedVideo } from "../types";

export interface VideoCardProps {
  item: AggregatedVideo;
  width?: number;
  showOverlay?: boolean;
}

function HeartIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function PosterPlaceholder() {
  return (
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
  );
}

function VideoCard({
  item,
  width,
  showOverlay = true,
}: VideoCardProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [imgError, setImgError] = useState(false);
  const [favorited, setFavorited] = useState(false);

  const poster = item.poster_url && !imgError ? item.poster_url : null;

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
      poster_url: item.poster_url || undefined,
      sources: item.sources,
    }).then(() => {
      setFavorited(true);
      toastSuccess("已收藏");
    });
  };

  return (
    <div
      className="video-card"
      role="button"
      tabIndex={0}
      aria-label={`${item.title}${item.year ? ` (${item.year})` : ""}`}
      style={width ? { width } : undefined}
      onClick={() => {
        const params = new URLSearchParams();
        params.set("title", item.title);
        if (item.year != null) params.set("year", String(item.year));
        params.set("sources", JSON.stringify(item.sources));
        navigate(`/detail?${params.toString()}`, { state: item });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const params = new URLSearchParams();
          params.set("title", item.title);
          if (item.year != null) params.set("year", String(item.year));
          params.set("sources", JSON.stringify(item.sources));
          navigate(`/detail?${params.toString()}`, { state: item });
        }
      }}
    >
      <div
        className="poster-wrap"
        style={{
          aspectRatio: "2/3",
          borderRadius: 4,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt={item.title}
            loading="lazy"
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <PosterPlaceholder />
        )}

        {/* 悬停信息层 */}
        {showOverlay && !isMobile && (
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
                  <HeartIcon size={12} color={favorited ? "#ff4081" : "currentColor"} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div
        className="card-title"
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

export default React.memo(VideoCard);
