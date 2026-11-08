import type { PlayProgress } from "../types";

/** 首页「继续观看」最多展示条数（后端 /recent 已按 updated_at 倒序返回 50 条） */
export const CONTINUE_WATCHING_LIMIT = 8;

/** 看到该百分比及以上视为已看完，不再进入「继续观看」 */
export const PROGRESS_COMPLETE_PERCENT = 95;

/**
 * 播放记录的「同一部片」标识：title + year。
 * 进度表按 (title, year) 唯一，但不同来源/集数可能留下多条记录；
 * 首页「继续观看」用该 key 分组，组内跳过脏行后取最近一条有效进度。
 */
export function progressTitleKey(title: string, year?: number | null): string {
  return `${title}::${year ?? "null"}`;
}

export type ProgressSnapshot = Pick<
  PlayProgress,
  "position_seconds" | "duration_seconds"
>;

/** 播放进度百分比；时长未知时返回 0（无法计算）。 */
export function progressPercent(item: ProgressSnapshot): number {
  if (!item.duration_seconds || item.duration_seconds <= 0) return 0;
  const pct = Math.round((item.position_seconds / item.duration_seconds) * 100);
  return Math.min(100, Math.max(0, pct));
}

/** 有效进度行：看过至少 1 秒，且知道总时长（能计算百分比、画出进度条）。 */
export function hasValidProgress(item: ProgressSnapshot): boolean {
  return (
    item.position_seconds > 0 &&
    !!item.duration_seconds &&
    item.duration_seconds > 0
  );
}

/**
 * 「有进度且未看完」：有效行，且未达到 PROGRESS_COMPLETE_PERCENT。
 * 时长缺失/未开始的脏行按不展示处理。
 */
export function isUnfinishedProgress(item: PlayProgress): boolean {
  return (
    hasValidProgress(item) &&
    progressPercent(item) < PROGRESS_COMPLETE_PERCENT
  );
}
