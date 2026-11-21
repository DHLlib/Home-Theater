import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analyzeSources, getSources } from "../api/play";
import { toastError } from "../utils/toast";
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
      hd_recommended: quality.hd_recommended,
      stable_recommended: quality.stable_recommended,
      recommendation_reason: quality.recommendation_reason,
      hd_reason: quality.hd_reason,
      quality: quality.quality,
      media: quality.media,
    };
  });
  return orderSourcesByQuality(merged, playSources);
}

function playSourcesQueryKey(title: string, year?: number | null) {
  return ["playSources", title, year ?? null] as const;
}

export function usePlaySources(title: string, year?: number | null) {
  return useQuery({
    queryKey: playSourcesQueryKey(title, year),
    queryFn: () => getSources(title, year),
    enabled: title.length > 0,
    retry: false,
    staleTime: 15000,
  });
}

export function useAnalyzePlaySources(title: string, year?: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => analyzeSources(title, year),
    onSuccess: (data) => {
      queryClient.setQueryData(playSourcesQueryKey(title, year), data);
      if (data.analysis_running) {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({
            queryKey: playSourcesQueryKey(title, year),
          });
        }, 2000);
      }
    },
    onError: () => {
      toastError("画质分析未完成，不影响正常播放");
    },
  });
}
