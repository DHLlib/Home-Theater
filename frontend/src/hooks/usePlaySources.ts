import { useQuery } from "@tanstack/react-query";
import { getSources } from "../api/play";
import type { PlaySource, SourceRef } from "../types";

export function playSourceKey(source: SourceRef): string {
  return `${source.site_id}-${source.original_id}`;
}

export function orderSourcesByQuality<T extends SourceRef>(
  sources: T[],
  playSources: PlaySource[]
): T[] {
  const order = new Map(
    playSources.map((source, index) => [playSourceKey(source), index])
  );
  return [...sources].sort((a, b) => {
    const aOrder = order.get(playSourceKey(a)) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(playSourceKey(b)) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

export function mergeSourceQuality(
  sources: SourceRef[],
  playSources: PlaySource[]
): SourceRef[] {
  const bySource = new Map(
    playSources.map((source) => [playSourceKey(source), source])
  );
  const merged = sources.map((source) => {
    const quality = bySource.get(playSourceKey(source));
    if (!quality) return source;
    return {
      ...source,
      recommended: quality.recommended,
      recommendation_reason: quality.recommendation_reason,
      quality: quality.quality,
    };
  });
  return orderSourcesByQuality(merged, playSources);
}

export function usePlaySources(title: string, year?: number | null) {
  return useQuery({
    queryKey: ["playSources", title, year ?? null],
    queryFn: () => getSources(title, year),
    enabled: title.length > 0,
    retry: false,
    staleTime: 15000,
  });
}
