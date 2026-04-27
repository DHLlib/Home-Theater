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
}: {
  episodes: Episode[];
  onPick: (index: number) => void;
}) {
  const groups = groupEpisodes(episodes);

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
            {group.eps.map((ep) => (
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
        </div>
      ))}
    </div>
  );
}
