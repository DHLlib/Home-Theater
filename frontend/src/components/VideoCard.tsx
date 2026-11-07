import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { getFavoriteStatus, toggleFavorite } from "../api/favorites";
import { toastError, toastSuccess } from "../utils/toast";
import { displayYear } from "../utils/year";
import { useIsMobile } from "../hooks/useViewport";
import PosterImage from "./PosterImage";
import { posterLayoutId } from "./DetailContent";
import { HeartIcon, PlayIcon } from "./icons";
import type { AggregatedVideo } from "../types";
import "./VideoCard.css";

export interface VideoCardProps {
  item: AggregatedVideo;
  width?: number;
  showOverlay?: boolean;
}

function PosterPlaceholder() {
  return (
    <div className="poster-placeholder">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>暂无封面</span>
    </div>
  );
}

function VideoCard({ item, width, showOverlay = true }: VideoCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFavoriteStatus(item.title, item.year)
      .then((res) => {
        if (!cancelled) setFavorited(res.favorited);
      })
      .catch(() => {
        // 静默失败，保持未收藏状态
      });
    return () => {
      cancelled = true;
    };
  }, [item.title, item.year]);

  // 打开详情弹窗：停在当前 pathname，仅加 detail=1 标记触发 DetailModalHost，
  // 完整 item（含 sources）走 navigation state，避免塞进 URL。
  // 这是一次 push，浏览器/移动端后退键天然 = 关闭弹窗。
  const openDetail = () => {
    const params = new URLSearchParams(location.search);
    params.set("detail", "1");
    navigate(
      { search: `?${params.toString()}` },
      { state: { detailItem: item } }
    );
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite({
      title: item.title,
      year: item.year,
      poster_url: item.poster_url || undefined,
      sources: item.sources,
    })
      .then((res) => {
        setFavorited(res.favorited);
        toastSuccess(res.favorited ? "已收藏" : "已取消收藏");
      })
      .catch(() => {
        toastError("收藏操作失败");
      });
  };

  const sourceCount = item.sources.length;
  const shownYear = displayYear(item.year);

  return (
    <article
      className="video-card"
      role="button"
      tabIndex={0}
      aria-label={`${item.title}${item.year ? ` (${item.year})` : ""}`}
      style={width ? { width } : undefined}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail();
        }
      }}
    >
      <div className="vc-poster">
        <motion.div
          layoutId={posterLayoutId(item.title, item.year)}
          className="vc-poster-media"
        >
          <PosterImage
            title={item.title}
            year={item.year}
            posterUrl={item.poster_url}
            posterUrls={item.poster_urls}
            alt={item.title}
            loading="lazy"
            placeholder={<PosterPlaceholder />}
          />
        </motion.div>

        <div className="vc-scrim" aria-hidden="true" />

        {showOverlay && !isMobile && (
          <div className="vc-actions">
            <button
              type="button"
              className="vc-play"
              onClick={(e) => {
                e.stopPropagation();
                openDetail();
              }}
              aria-label={`选择 ${item.title} 的来源`}
            >
              <PlayIcon size={13} />
              选择来源
            </button>
            <button
              type="button"
              className={`vc-fav${favorited ? " is-on" : ""}`}
              onClick={handleFavorite}
              aria-label={`${favorited ? "取消收藏" : "收藏"} ${item.title}`}
              aria-pressed={favorited}
            >
              <HeartIcon
                size={15}
                style={{ fill: favorited ? "currentColor" : "none" }}
              />
            </button>
          </div>
        )}
      </div>

      <div className="vc-caption">
        <h3 className="vc-title" title={item.title}>
          {item.title}
        </h3>
        <p className="vc-meta tnum">
          {shownYear != null && <span>{shownYear}</span>}
          {shownYear != null && sourceCount > 0 && (
            <i aria-hidden="true">·</i>
          )}
          {sourceCount > 0 && <span>{sourceCount} 个来源</span>}
        </p>
      </div>
    </article>
  );
}

export default React.memo(VideoCard);
