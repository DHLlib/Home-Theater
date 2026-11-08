import type { PlayProgress } from "../types";

/**
 * 「继续播放」跳转 URL。
 * 与「最近播放」页既有的跳转保持一致：显式带 site_id / original_id / ep / title / year，
 * 播放器据此打开上次来源与集数，并按 title+year 读取服务端保存的进度。
 */
export function buildResumePlayerUrl(
  item: Pick<
    PlayProgress,
    "source_site_id" | "source_video_id" | "episode_index" | "title" | "year"
  >
): string {
  const yearParam = item.year != null ? `&year=${item.year}` : "";
  return `/player?site_id=${item.source_site_id}&original_id=${encodeURIComponent(
    item.source_video_id
  )}&ep=${item.episode_index}&title=${encodeURIComponent(item.title)}${yearParam}`;
}
