import { useNavigate } from "react-router-dom";
import PosterImage from "../../components/PosterImage";
import PosterEmpty from "../../components/PosterEmpty";
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
          placeholder={<PosterEmpty size={28} />}
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
