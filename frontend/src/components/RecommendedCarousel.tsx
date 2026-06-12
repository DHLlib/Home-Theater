import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile, useViewport } from "../hooks/useViewport";
import type { AggregatedVideo } from "../types";

interface RecommendedCarouselProps {
  videos: AggregatedVideo[];
  loading?: boolean;
  onSelect: (video: AggregatedVideo) => void;
}

const TRANSITION_DURATION = 0.45;
const VISIBLE_RADIUS = 2;

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
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
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

  // activeIndex 变化时，把新进入可见范围的图片加入加载集合
  useEffect(() => {
    const next = new Set(loadedImages);
    displayVideos.forEach((video, index) => {
      const offset = Math.abs(index - activeIndex);
      if (offset <= VISIBLE_RADIUS && video.poster_url) {
        next.add(video.poster_url);
      }
    });
    setLoadedImages(next);
  }, [activeIndex, displayVideos]);

  // 视频列表变化时重置
  useEffect(() => {
    setActiveIndex(0);
    const initial = new Set<string>();
    displayVideos.slice(0, VISIBLE_RADIUS + 1).forEach((v) => {
      if (v.poster_url) initial.add(v.poster_url);
    });
    setLoadedImages(initial);
  }, [displayVideos.map((v) => `${v.title}-${v.year}`).join("|")]);

  // 滚轮切换：线性，一次一张
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
          return Math.min(prev + 1, displayVideos.length - 1);
        }
        return Math.max(prev - 1, 0);
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
            const poster = video.poster_url || "";
            const style = getSlideStyle(offset, spacing, isMobile);
            const shouldLoad = poster && loadedImages.has(poster);
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
                  className={shouldLoad ? undefined : "skeleton"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: shouldLoad ? "var(--glass-bg)" : undefined,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    textAlign: "center",
                    padding: 12,
                    opacity: shouldLoad ? 0 : 1,
                    transition: "opacity 0.3s ease",
                  }}
                >
                  {!poster && video.title}
                </div>

                {/* 实际图片：仅在可见半径内加载 */}
                {poster && isVisible && (
                  <img
                    src={poster}
                    alt={video.title}
                    onLoad={() =>
                      setLoadedImages((prev) => new Set(prev).add(poster))
                    }
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      opacity: loadedImages.has(poster) ? 1 : 0,
                      transition: "opacity 0.35s ease",
                    }}
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
