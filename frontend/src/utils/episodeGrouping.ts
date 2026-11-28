import type { Episode } from "../types";

/**
 * 将 Episode 数组按 suffix 分组；若 suffix 全相同且集名重复，则按连续块切分（多线路）。
 * 返回 [{ label, eps: Episode[] }, ...]
 */
export function groupEpisodes(episodes: Episode[]): { label: string; eps: Episode[] }[] {
  if (episodes.length === 0) return [];

  // 使用 Object.groupBy 按 suffix 分组（返回 null-prototype 对象）
  const bySuffix = Object.groupBy(episodes, (ep) => ep.suffix);
  const suffixes = Object.keys(bySuffix);

  if (suffixes.length > 1) {
    return suffixes.map((s) => ({ label: s.toUpperCase(), eps: bySuffix[s] ?? [] }));
  }

  // 只有一种 suffix，检查是否有重复的集名（说明是多线路）
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

  return [{ label: suffixes[0]?.toUpperCase() || "选集", eps: episodes }];
}