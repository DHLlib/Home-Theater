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
const CLONE_COUNT = VISIBLE_RADIUS;

function getSlideStyle(
  offset: number,
  spacing: number,
  isMobile: boolean,
  transitionEnabled: boolean
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
    transition: transitionEnabled
      ? `transform ${TRANSITION_DURATION}s cubic-bezier(0.4, 0, 0.2, 1), opacity ${TRANSITION_DURATION}s ease`
      : "none",
  };
}

export default function RecommendedCarousel({
  videos,
  loading = false,
  onSelect,
}: RecommendedCarouselProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isMobile = useIsMobile();
  const { width: viewportWidth } = useViewport();
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelLockRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  const displayVideos = useMemo(() => videos.slice(0, 15), [videos]);

  // 为无缝循环，前后各复制 VISIBLE_RADIUS 张；列表过短时不需要复制
  const { loopVideos, startOffset, realCount } = useMemo(() => {
    const n = displayVideos.length;
    if (n <= CLONE_COUNT * 2) {
      return { loopVideos: displayVideos, startOffset: 0, realCount: n };
    }
    return {
      loopVideos: [
        ...displayVideos.slice(-CLONE_COUNT),
        ...displayVideos,
        ...displayVideos.slice(0, CLONE_COUNT),
      ],
      startOffset: CLONE_COUNT,
      realCount: n,
    };
  }, [displayVideos]);

  // 容器与 slide 尺寸的响应式计算
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

  const [cursor, setCursor] = useState(startOffset);
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  // 视频列表变化时重置到真实第一张
  useEffect(() => {
    setCursor(startOffset);
    setTransitionEnabled(true);
  }, [startOffset]);

  // 真实 active 下标，用于指示器
  const realActiveIndex = useMemo(() => {
    if (realCount === 0) return 0;
    return ((cursor - startOffset) % realCount + realCount) % realCount;
  }, [cursor, startOffset, realCount]);

  // 进入复制区后，动画结束瞬间无动画跳回对应真实位置，实现无缝循环
  useEffect(() => {
    if (realCount === 0 || startOffset === 0) return;
    let target: number | null = null;
    if (cursor >= startOffset + realCount) {
      target = startOffset + (cursor - (startOffset + realCount));
    } else if (cursor < startOffset) {
      target = realCount + cursor;
    }
    if (target === null) return;

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setTransitionEnabled(false);
      setCursor(target!);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setTransitionEnabled(true);
          resetTimerRef.current = null;
        });
      });
    }, TRANSITION_DURATION * 1000);

    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [cursor, realCount, startOffset]);

  // 自动轮播：5 秒向前切换一次，悬停暂停
  useEffect(() => {
    if (loading || loopVideos.length <= 1 || isHovered) return;
    const timer = setInterval(() => {
      setCursor((prev) => prev + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [loading, loopVideos.length, isHovered]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (wheelLockRef.current || loopVideos.length <= 1) return;

      const delta = e.deltaY;
      if (Math.abs(delta) < 20) return;

      wheelLockRef.current = true;
      setTimeout(() => {
        wheelLockRef.current = false;
      }, TRANSITION_DURATION * 1000);

      setCursor((prev) => (delta > 0 ? prev + 1 : prev - 1));
    },
    [loopVideos.length]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleClick = (index: number) => {
    if (index === cursor) {
      onSelect(loopVideos[index]);
    } else {
      setCursor(index);
    }
  };

  const goNext = useCallback(() => {
    if (loopVideos.length <= 1) return;
    setCursor((prev) => prev + 1);
  }, [loopVideos.length]);

  const goPrev = useCallback(() => {
    if (loopVideos.length <= 1) return;
    setCursor((prev) => prev - 1);
  }, [loopVideos.length]);

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
          loopVideos.map((video, index) => {
            const offset = index - cursor;
            const hasPoster = Boolean(
              video.poster_url || (video.poster_urls && video.poster_urls.length)
            );
            const style = getSlideStyle(offset, spacing, isMobile, transitionEnabled);
            const isVisible = Math.abs(offset) <= VISIBLE_RADIUS;

            return (
              <div
                key={`${video.title}-${video.year ?? "null"}-${index}`}
                role="button"
                tabIndex={isVisible ? 0 : -1}
                aria-label={`${video.title}${video.year ? ` (${video.year})` : ""}`}
                onClick={() => handleClick(index)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleClick(index);
                  }
                }}
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
                  outline: "none",
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
        {!showSkeleton && loopVideos.length > 1 && (
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
              onClick={() => setCursor(startOffset + index)}
              aria-label={`切换到第 ${index + 1} 张`}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                border: "none",
                padding: 0,
                cursor: "pointer",
                background:
                  index === realActiveIndex
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
