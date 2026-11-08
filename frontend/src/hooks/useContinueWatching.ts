import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRecent } from "../api/progress";
import {
  CONTINUE_WATCHING_LIMIT,
  hasValidProgress,
  isUnfinishedProgress,
  progressTitleKey,
} from "../utils/progress";
import type { PlayProgress } from "../types";

/**
 * 首页「继续观看」数据源。
 * 直接复用「最近播放」页的 listRecent（GET /api/progress/recent，按 updated_at 倒序）。
 * 处理规则：
 * - 按 title+year 分组，组内跳过脏行（position<=0 / duration 为空），取最近一条有效行；
 * - 有效行未看完 → 输出卡片（即使组内还有更新的脏行）；
 * - 有效行已看完 → 整组丢弃，避免用更早的未看完行复活；
 * - 顺序按有效行在列表中的先后（即最近观看），封顶 8 条。
 */
export const continueWatchingQueryKey = ["progress", "recent"] as const;

export interface UseContinueWatchingOptions {
  /** 区块不可见时传 false，避免无意义请求；默认 true */
  enabled?: boolean;
}

export function useContinueWatching({
  enabled = true,
}: UseContinueWatchingOptions = {}) {
  const query = useQuery({
    queryKey: continueWatchingQueryKey,
    queryFn: listRecent,
    enabled,
  });

  const items = useMemo(() => {
    // 已经有「有效行」结论的分组（无论最终输出还是整组丢弃）
    const resolvedGroups = new Set<string>();
    const list: PlayProgress[] = [];

    for (const item of query.data ?? []) {
      const key = progressTitleKey(item.title, item.year);
      if (resolvedGroups.has(key)) continue;

      // 脏行不能代表这一部片，继续在组内找更早的有效行
      if (!hasValidProgress(item)) continue;

      // 组内第一条有效行即该片的最新有效进度
      resolvedGroups.add(key);
      if (!isUnfinishedProgress(item)) continue;

      list.push(item);
      if (list.length >= CONTINUE_WATCHING_LIMIT) break;
    }

    return list;
  }, [query.data]);

  return { items, isLoading: query.isLoading };
}
