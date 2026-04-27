import { get, post } from "./client";
import type { PlayProgress, PlayProgressIn } from "../types";

export const upsertProgress = (body: PlayProgressIn) =>
  post<PlayProgress>("/api/progress", body);
export const listRecent = () => get<PlayProgress[]>("/api/progress/recent");
export const getProgress = (title: string, year?: number | null) => {
  const qs = new URLSearchParams();
  qs.set("title", title);
  if (year != null) qs.set("year", String(year));
  return get<PlayProgress | null>(`/api/progress?${qs}`);
};
