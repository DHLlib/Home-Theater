import { useNavigate } from "react-router-dom";
import PosterImage from "../../components/PosterImage";
import { displayYear } from "../../utils/year";
import type { AggregatedVideo } from "../../types";

interface MobileVideoCardProps {
  item: AggregatedVideo;
}

function formatMeta(item: AggregatedVideo): string {
  const parts: string[] = [];
  const year = displayYear(item.year);
  if (year) parts.push(String(year));
  const sourceCount = item.sources.length;
  if (sourceCount > 0) parts.push(`${sourceCount} 个来源`);
  return parts.join(" · ") || " ";
}

export default function MobileVideoCard({ item }: MobileVideoCardProps) {
  const navigate = useNavigate();

  return (
    <div
      className="mobile-video-card"
      onClick={() =>
        navigate("/detail", {
          state: {
            title: item.title,
            year: item.year ?? null,
            sources: item.sources,
            poster_url: item.poster_url ?? null,
          },
        })
      }
    >
      <div className="mobile-video-card-poster">
        <PosterImage
          title={item.title}
          year={item.year}
          posterUrl={item.poster_url}
          posterUrls={item.poster_urls}
          alt={item.title}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          placeholder={
            <div className="poster-empty">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span>暂无封面</span>
            </div>
          }
        />
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
