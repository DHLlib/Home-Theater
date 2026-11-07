import type { Episode } from "../types";
import "./EpisodeList.css";

function groupEpisodes(episodes: Episode[]): { label: string; eps: Episode[] }[] {
  if (episodes.length === 0) return [];

  const bySuffix: Record<string, Episode[]> = {};
  for (const ep of episodes) {
    if (!bySuffix[ep.suffix]) bySuffix[ep.suffix] = [];
    bySuffix[ep.suffix].push(ep);
  }
  const suffixes = Object.keys(bySuffix);

  if (suffixes.length > 1) {
    return suffixes.map((s) => ({ label: s.toUpperCase(), eps: bySuffix[s] }));
  }

  const groups: Episode[][] = [];
  let currentGroup: Episode[] = [];
  const seen = new Set<string>();

  for (const ep of episodes) {
    if (seen.has(ep.ep_name)) {
      groups.push(currentGroup);
      currentGroup = [];
      seen.clear();
    }
    currentGroup.push(ep);
    seen.add(ep.ep_name);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  if (groups.length > 1) {
    return groups.map((g, i) => ({ label: `线路 ${i + 1}`, eps: g }));
  }

  return [{ label: suffixes[0]?.toUpperCase() || "", eps: episodes }];
}

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
              return (
                <button
                  key={ep.index}
                  type="button"
                  className={`ep-btn${isSelected ? " is-selected" : ""}${
                    multiSelect ? " is-multi" : ""
                  }`}
                  onClick={() => handleClick(ep)}
                  title={ep.url}
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
