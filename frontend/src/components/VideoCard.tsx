import React, { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { getFavoriteStatus, toggleFavorite } from "../api/favorites";
import { toastError, toastSuccess } from "../utils/toast";
import { useIsMobile } from "../hooks/useViewport";
import PosterImage from "./PosterImage";
import { posterLayoutId } from "./DetailContent";
import { HeartIcon, PlayIcon } from "./icons";
import type { AggregatedVideo } from "../types";

export interface VideoCardProps {
  item: AggregatedVideo;
  width?: number;
  showOverlay?: boolean;
}

// 3D 倾斜动效参数（克制版）
const springValues = { damping: 30, stiffness: 100, mass: 2 };
const ROTATE_AMPLITUDE = 6;

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
        color: "var(--text-muted)",
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.5 }}
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

function VideoCard({
  item,
  width,
  showOverlay = true,
}: VideoCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
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

  // 仅桌面端、且用户未要求减少动效时启用 3D 倾斜
  const tiltEnabled = !isMobile && !reduceMotion;
  const wrapRef = useRef<HTMLDivElement>(null);
  const rotateX = useSpring(useMotionValue(0), springValues);
  const rotateY = useSpring(useMotionValue(0), springValues);

  const handleMouseMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    rotateX.set((offsetY / (rect.height / 2)) * -ROTATE_AMPLITUDE);
    rotateY.set((offsetX / (rect.width / 2)) * ROTATE_AMPLITUDE);
  };

  const handleMouseLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
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

  const posterInner = (
    <>
      <motion.div
        layoutId={posterLayoutId(item.title, item.year)}
        style={{ position: "absolute", inset: 0 }}
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

      {/* 海报内底部信息层：标题+年份常驻，源数与操作按钮悬停浮现 */}
      <div className="card-info">
        {showOverlay && !isMobile && item.sources.length > 0 && (
          <div className="card-info-meta">{`${item.sources.length} 个源`}</div>
        )}
        <div className="card-info-title">{item.title}</div>
        {item.year != null && <div className="card-info-year">{item.year}</div>}
        {showOverlay && !isMobile && (
          <div className="card-info-actions">
            <button
              className="action-btn"
              onClick={(e) => {
                e.stopPropagation();
                openDetail();
              }}
              aria-label={`查看 ${item.title} 详情`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <PlayIcon size={12} />
              详情
            </button>
            <button
              className="action-btn secondary"
              onClick={handleFavorite}
              aria-label={`收藏 ${item.title}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                padding: 0,
              }}
            >
              <HeartIcon
                size={14}
                style={{
                  fill: favorited ? "var(--primary)" : "none",
                  color: favorited ? "var(--primary)" : "currentColor",
                }}
              />
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
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
      {tiltEnabled ? (
        <motion.div
          ref={wrapRef}
          className="poster-wrap"
          style={{
            aspectRatio: "2/3",
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
            rotateX,
            rotateY,
            transformStyle: "preserve-3d",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {posterInner}
        </motion.div>
      ) : (
        <div
          className="poster-wrap"
          style={{
            aspectRatio: "2/3",
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {posterInner}
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoCard);
