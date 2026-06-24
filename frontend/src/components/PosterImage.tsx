import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCachedPosterSuccess,
  setCachedPosterSuccess,
} from "../utils/cache";

export interface PosterImageProps {
  title: string;
  year?: number | null;
  posterUrl?: string | null;
  posterUrls?: string[] | null;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  placeholder?: React.ReactNode;
  onLoaded?: (url: string) => void;
  onExhausted?: () => void;
}

export default function PosterImage({
  title,
  year,
  posterUrl,
  posterUrls,
  alt,
  className,
  style,
  loading = "lazy",
  placeholder,
  onLoaded,
  onExhausted,
}: PosterImageProps) {
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const hasFiredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getCachedPosterSuccess(title, year).then((url) => {
      if (!cancelled) setRecordedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [title, year]);

  const candidates = useMemo(() => {
    const list: string[] = [];
    const add = (url: string | null | undefined) => {
      if (url && !list.includes(url)) list.push(url);
    };
    add(recordedUrl);
    for (const url of posterUrls || []) add(url);
    add(posterUrl);
    return list;
  }, [recordedUrl, posterUrl, posterUrls]);

  useEffect(() => {
    setCurrentIndex(0);
    setLoaded(false);
    hasFiredRef.current = false;
  }, [candidates.join("|")]);

  const src = candidates[currentIndex];

  const handleLoad = () => {
    if (hasFiredRef.current) return;
    hasFiredRef.current = true;
    setLoaded(true);
    setCachedPosterSuccess(title, year, src);
    onLoaded?.(src);
  };

  const handleError = () => {
    setLoaded(false);
    setCurrentIndex((prev) => prev + 1);
  };

  useEffect(() => {
    // 浏览器缓存命中时，图片可能在 onLoad 绑定前已完成加载，
    // 手动检查 complete 属性避免封面一直显示占位图。
    // 注意：本 effect 必须无条件调用（不能放在下方早期 return 之后），
    // 否则候选图全部失败、currentIndex 越界触发早期 return 时，
    // 本次渲染的 hook 数会比上次少 → React #300（见 lessons-learned #32）。
    const img = imgRef.current;
    if (img && img.complete && !hasFiredRef.current) {
      handleLoad();
    }
  }, [src]);

  if (candidates.length === 0 || currentIndex >= candidates.length) {
    onExhausted?.();
    if (placeholder) {
      return (
        <div
          className={className}
          style={{ width: "100%", height: "100%", ...style }}
        >
          {placeholder}
        </div>
      );
    }
    return null;
  }

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: "100%",
        position: placeholder ? "relative" : undefined,
        ...style,
      }}
    >
      {placeholder && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: loaded ? 0 : 1,
            transition: "opacity 0.25s ease",
            pointerEvents: "none",
          }}
        >
          {placeholder}
        </div>
      )}
      <img
        key={src}
        ref={imgRef}
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.25s ease",
        }}
      />
    </div>
  );
}
