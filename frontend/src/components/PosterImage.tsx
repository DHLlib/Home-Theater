import { useEffect, useMemo, useState } from "react";
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
  }, [candidates.join("|")]);

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

  const src = candidates[currentIndex];

  const handleLoad = () => {
    setLoaded(true);
    setCachedPosterSuccess(title, year, src);
    onLoaded?.(src);
  };

  const handleError = () => {
    setLoaded(false);
    setCurrentIndex((prev) => prev + 1);
  };

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
