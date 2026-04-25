import type { Episode } from "../types";

export default function EpisodeList({
  episodes,
  onPick,
}: {
  episodes: Episode[];
  onPick: (index: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {episodes.map((ep) => (
        <button
          key={ep.index}
          className="btn"
          onClick={() => onPick(ep.index)}
          title={ep.url}
        >
          {ep.ep_name}
        </button>
      ))}
    </div>
  );
}
