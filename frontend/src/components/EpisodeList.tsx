import type { Episode } from "../types";
import { toastError } from "../utils/toast";
import { groupEpisodes } from "../utils/episodeGrouping";
import "./EpisodeList.css";

export default function EpisodeList({
  episodes,
  onPick,
  multiSelect = false,
  selectedIndices,
  onToggleSelection,
}: {
  episodes: Episode[];
  onPick: (index: number) => void;
  multiSelect?: boolean;
  selectedIndices?: Set<number>;
  onToggleSelection?: (index: number, selected: boolean) => void;
}) {
  const groups = groupEpisodes(episodes);
  const selected = selectedIndices ?? new Set<number>();

  const handleClick = (ep: Episode) => {
    if (multiSelect && onToggleSelection) {
      onToggleSelection(ep.index, !selected.has(ep.index));
    } else {
      onPick(ep.index);
    }
  };

  return (
    <div className="ep-groups">
      {groups.map((group, gi) => (
        <div key={gi} className="ep-group">
          {groups.length > 1 && <div className="ep-group-label">{group.label}</div>}
          <div className="ep-grid">
            {group.eps.map((ep) => {
              const isSelected = selected.has(ep.index);
              const unreachable = ep.reachable === false;
              return (
                <button
                  key={ep.index}
                  type="button"
                  className={`ep-btn${isSelected ? " is-selected" : ""}${
                    multiSelect ? " is-multi" : ""
                  }${unreachable ? " is-unreachable" : ""}`}
                  onClick={() => {
                    if (unreachable) {
                      toastError("该集线路不通，可能是 CDN 域名被屏蔽或已失效");
                      return;
                    }
                    handleClick(ep);
                  }}
                  title={
                    unreachable
                      ? "线路不通（可能是 CDN 被屏蔽或已失效）"
                      : ep.url
                  }
                  aria-disabled={unreachable || undefined}
                  aria-pressed={multiSelect ? isSelected : undefined}
                >
                  {multiSelect && (
                    <span className="ep-check" aria-hidden="true">
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  )}
                  <span className="ep-name">{ep.ep_name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
