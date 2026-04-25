import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDetail } from "../api/videos";
import type { AggregatedVideo } from "../types";

export default function VideoCard({ item }: { item: AggregatedVideo }) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [poster, setPoster] = useState<string | null>(item.poster_url ?? null);
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
              });
          }
        });
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [item.poster_url, item.sources, item.title, item.year, poster]);

  return (
    <div
      ref={cardRef}
      className="video-card"
      style={{ cursor: "pointer" }}
      onClick={() => navigate("/detail", { state: item })}
    >
      <div
        style={{
          aspectRatio: "2/3",
          background: "var(--card)",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt={item.title}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            className="empty"
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              opacity: 0.5,
            }}
          >
            加载中…
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 500 }}>
        {item.title}
      </div>
      {item.year && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>{item.year}</div>
      )}
    </div>
  );
}
