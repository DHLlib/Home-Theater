import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

const inFlightAnalysis = new Map<string, ReturnType<typeof analyzeSources>>();

function analyzeSourcesShared(
  title: string,
  year: number | null | undefined,
  offset: number
) {
  const key = JSON.stringify([title, year ?? null, offset]);
  const existing = inFlightAnalysis.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      return await analyzeSources(title, year, offset);
    } finally {
      inFlightAnalysis.delete(key);
    }
  })();
  inFlightAnalysis.set(key, request);
  return request;
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

export function useAutoMediaAnalysis(
  title: string,
  year: number | null | undefined,
  enabled: boolean
) {
  const queryClient = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!enabled || !title) {
      setAnalyzing(false);
      return;
    }
    let cancelled = false;
    let offset = 0;
    setAnalyzing(true);

    const run = async () => {
      try {
        while (!cancelled) {
          const data = await analyzeSourcesShared(title, year, offset);
          if (cancelled) return;
          queryClient.setQueryData(playSourcesQueryKey(title, year), data);
          if (data.analysis_disabled) break;
          if (data.analysis_running) {
            await new Promise((resolve) => window.setTimeout(resolve, 2000));
            continue;
          }
          const nextOffset = data.next_offset ?? offset;
          if (data.remaining && nextOffset <= offset) {
            throw new Error("media analysis cursor did not advance");
          }
          offset = nextOffset;
          if (!data.remaining) break;
        }
      } catch {
        if (!cancelled) toastError("自动画质分析未完成，不影响正常播放");
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [title, year, enabled, queryClient]);

  return { analyzing };
}
