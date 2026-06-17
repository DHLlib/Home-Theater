import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile, useViewport } from "../hooks/useViewport";
import PosterImage from "./PosterImage";
import type { AggregatedVideo } from "../types";

interface RecommendedCarouselProps {
  videos: AggregatedVideo[];
  loading?: boolean;
  onSelect: (video: AggregatedVideo) => void;
}

const TRANSITION_DURATION = 0.45;
const VISIBLE_RADIUS = 3;

function getSlideStyle(
  offset: number,
  spacing: number,
  isMobile: boolean
): React.CSSProperties {
  const absOffset = Math.abs(offset);
  const baseScale = isMobile ? 0.72 : 1;

  let scale: number;
  let opacity: number;
  let zIndex: number;

  switch (absOffset) {
    case 0:
      scale = baseScale;
      opacity = 1;
      zIndex = 10;
      break;
    case 1:
      scale = baseScale * 0.8;
      opacity = 0.9;
      zIndex = 9;
      break;
    case 2:
      scale = baseScale * 0.65;
      opacity = 0.8;
      zIndex = 8;
      break;
    case 3:
      scale = baseScale * 0.52;
      opacity = 0.7;
      zIndex = 7;
      break;
    case 4:
      scale = baseScale * 0.46;
      opacity = 0.6;
      zIndex = 6;
      break;
    default:
      scale = baseScale * 0.46;
      opacity = 0;
      zIndex = 0;
  }

  return {
    transform: `translateX(${offset * spacing}px) scale(${scale})`,
    opacity,
    zIndex,
    pointerEvents: absOffset > 4 ? "none" : "auto",
    transition: `transform ${TRANSITION_DURATION}s cubic-bezier(0.4, 0, 0.2, 1), opacity ${TRANSITION_DURATION}s ease`,
  };
}

export default function RecommendedCarousel({
  videos,
  loading = false,
  onSelect,
}: RecommendedCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const isMobile = useIsMobile();
  const { width: viewportWidth } = useViewport();
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelLockRef = useRef(false);

  const displayVideos = useMemo(() => videos.slice(0, 15), [videos]);

  // 容器与 slide 尺寸的响应式计算：容器占满父级宽度，slide 按容器比例缩放
  const { imageHeight, spacing, slideWidth } = useMemo(() => {
    const padding = isMobile ? 24 : 64;
    const availableWidth = Math.min(viewportWidth - padding * 2, 1200);

    if (isMobile) {
      return {
        imageHeight: Math.min(320, Math.floor(availableWidth * 0.65)),
        spacing: Math.floor(availableWidth * 0.26),
        slideWidth: Math.floor(availableWidth * 0.36),
      };
    }

    return {
      imageHeight: Math.min(420, Math.floor(availableWidth * 0.45)),
      spacing: Math.floor(availableWidth * 0.22),
      slideWidth: Math.floor(availableWidth * 0.28),
    };
  }, [isMobile, viewportWidth]);

  // 自动轮播：5 秒切换一次，悬停时暂停，到最后一张后循环回第一张
  useEffect(() => {
    if (loading || displayVideos.length <= 1 || isHovered) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % displayVideos.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [loading, displayVideos.length, isHovered]);

  // 视频列表变化时重置
  useEffect(() => {
    setActiveIndex(0);
  }, [displayVideos.map((v) => `${v.title}-${v.year}`).join("|")]);

  // 滚轮切换：循环轮播
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (wheelLockRef.current || displayVideos.length <= 1) return;

      const delta = e.deltaY;
      if (Math.abs(delta) < 20) return;

      wheelLockRef.current = true;
      setTimeout(() => {
        wheelLockRef.current = false;
      }, TRANSITION_DURATION * 1000);

      setActiveIndex((prev) => {
        if (delta > 0) {
          return (prev + 1) % displayVideos.length;
        }
        return (prev - 1 + displayVideos.length) % displayVideos.length;
      });
    },
    [displayVideos.length]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleClick = (index: number) => {
    if (index === activeIndex) {
      onSelect(displayVideos[index]);
    } else {
      setActiveIndex(index);
    }
  };

  const goNext = useCallback(() => {
    if (displayVideos.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % displayVideos.length);
  }, [displayVideos.length]);

  const goPrev = useCallback(() => {
    if (displayVideos.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + displayVideos.length) % displayVideos.length);
  }, [displayVideos.length]);

  const showSkeleton = loading || displayVideos.length === 0;

  return (
    <div
      style={{
        margin: "30px auto",
        width: "100%",
        maxWidth: 1200,
        position: "relative",
        perspective: 1200,
        padding: `0 ${isMobile ? 12 : 24}px`,
        boxSizing: "border-box",
      }}
    >
      {/* 轮播视口 */}
      <div
        ref={containerRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          height: imageHeight,
          position: "relative",
          cursor: loading ? "default" : "grab",
          touchAction: "pan-y",
          overflow: "visible",
          borderRadius: 8,
        }}
      >
        {showSkeleton ? (
          <div
            className="skeleton"
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              marginLeft: -slideWidth / 2,
              width: slideWidth,
              height: imageHeight,
              borderRadius: 8,
            }}
          />
        ) : (
          displayVideos.map((video, index) => {
            const offset = index - activeIndex;
            const hasPoster = Boolean(
              video.poster_url || (video.poster_urls && video.poster_urls.length)
            );
            const style = getSlideStyle(offset, spacing, isMobile);
            const isVisible = Math.abs(offset) <= VISIBLE_RADIUS;

            return (
              <div
                key={`${video.title}-${video.year ?? "null"}-${index}`}
                onClick={() => handleClick(index)}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 0,
                  marginLeft: -slideWidth / 2,
                  width: slideWidth,
                  height: imageHeight,
                  borderRadius: 8,
                  overflow: "hidden",
                  transformOrigin: "center center",
                  boxShadow:
                    offset === 0
                      ? "0 20px 60px rgba(0,0,0,0.6)"
                      : "0 10px 30px rgba(0,0,0,0.4)",
                  ...style,
                }}
              >
                {/* 骨架背景 / 占位 */}
                <div
                  className="skeleton"
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    textAlign: "center",
                    padding: 12,
                  }}
                >
                  {!hasPoster && video.title}
                </div>

                {/* 实际图片：仅在可见半径内加载 */}
                {hasPoster && isVisible && (
                  <PosterImage
                    title={video.title}
                    year={video.year}
                    posterUrl={video.poster_url}
                    posterUrls={video.poster_urls}
                    alt={video.title}
                    loading="eager"
                    style={{ position: "absolute", inset: 0 }}
                  />
                )}

                {/* 当前项信息遮罩 */}
                {offset === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: "16px 12px 12px",
                      background:
                        "linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: isMobile ? 14 : 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {video.title}
                    </div>
                    {video.year && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-secondary)",
                          marginTop: 4,
                        }}
                      >
                        {video.year}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* 左右切换箭头 */}
        {!showSkeleton && displayVideos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="上一张"
              onClick={goPrev}
              style={{
                position: "absolute",
                left: isMobile ? 4 : 12,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 20,
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.45)",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all var(--transition-base)",
                backdropFilter: "blur(4px)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.7)";
                e.currentTarget.style.color = "var(--primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.45)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="下一张"
              onClick={goNext}
              style={{
                position: "absolute",
                right: isMobile ? 4 : 12,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 20,
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.45)",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all var(--transition-base)",
                backdropFilter: "blur(4px)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.7)";
                e.currentTarget.style.color = "var(--primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.45)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* 指示器 */}
      {!loading && displayVideos.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 6,
            marginTop: 16,
          }}
        >
          {displayVideos.map((_, index) => (
            <button
              key={index}
              onClick={() => setActiveIndex(index)}
              aria-label={`切换到第 ${index + 1} 张`}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                border: "none",
                padding: 0,
                cursor: "pointer",
                background:
                  index === activeIndex
                    ? "var(--primary)"
                    : "rgba(255,255,255,0.25)",
                transition: "background 0.3s ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
