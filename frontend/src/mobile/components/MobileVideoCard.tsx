import { useNavigate } from "react-router-dom";
import type { AggregatedVideo } from "../../types";

interface MobileVideoCardProps {
  item: AggregatedVideo;
}

function pickPoster(item: AggregatedVideo): string | undefined {
  if (item.poster_url) return item.poster_url;
  if (item.poster_urls && item.poster_urls.length > 0) {
    return item.poster_urls.find((u) => u?.trim()) || item.poster_urls[0];
  }
  return undefined;
}

function formatMeta(item: AggregatedVideo): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  const sourceCount = item.sources.length;
  if (sourceCount > 0) parts.push(`${sourceCount} 个来源`);
  return parts.join(" · ") || " ";
}

export default function MobileVideoCard({ item }: MobileVideoCardProps) {
  const navigate = useNavigate();
  const poster = pickPoster(item);

  return (
    <div
      className="mobile-video-card"
      onClick={() =>
        navigate("/detail", {
          state: {
            title: item.title,
            year: item.year ?? null,
            sources: item.sources,
            poster_url: poster ?? null,
          },
        })
      }
    >
      <div className="mobile-video-card-poster">
        {poster ? (
          <img src={poster} alt={item.title} loading="lazy" />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              fontSize: 12,
            }}
          >
            无封面
          </div>
        )}
      </div>
      <div className="mobile-video-card-info">
        <h3 className="mobile-video-card-title" title={item.title}>
          {item.title}
        </h3>
        <div className="mobile-video-card-meta">{formatMeta(item)}</div>
      </div>
    </div>
  );
}
