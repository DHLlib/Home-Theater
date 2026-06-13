import type { Episode } from "../types";

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
    <div>
      {groups.map((group, gi) => (
        <div key={gi} style={{ marginBottom: 12 }}>
          {groups.length > 1 && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.6,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {group.label}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {group.eps.map((ep) => {
              const isSelected = selected.has(ep.index);
              return (
                <button
                  key={ep.index}
                  className={`btn${isSelected ? " btn-primary" : ""}`}
                  onClick={() => handleClick(ep)}
                  title={ep.url}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    position: "relative",
                    paddingTop: multiSelect ? 20 : undefined,
                    borderColor: isSelected
                      ? "var(--primary)"
                      : undefined,
                  }}
                >
                  {multiSelect && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 6,
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        border: `1.5px solid ${
                          isSelected ? "var(--primary)" : "var(--text-muted)"
                        }`,
                        background: isSelected
                          ? "var(--primary)"
                          : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isSelected && (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--bg)"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  )}
                  {ep.ep_name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
