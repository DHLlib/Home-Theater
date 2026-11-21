import { get } from "./client";
import type {
  Episode,
  PlaybackEventInput,
  PlaySourcesResponse,
} from "../types";

export const getEpisodes = (site_id: number, original_id: string) =>
  get<Episode[]>(
    `/api/play/episodes?site_id=${site_id}&original_id=${encodeURIComponent(
      original_id
    )}`
  );

export const getSources = (title: string, year?: number | null) => {
  const qs = new URLSearchParams();
  qs.set("title", title);
  if (year != null) qs.set("year", String(year));
  return get<PlaySourcesResponse>(`/api/play/sources?${qs}`);
};

export async function reportPlaybackEvents(
  events: PlaybackEventInput[]
): Promise<void> {
  if (events.length === 0) return;
  try {
    await fetch("/api/play/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    // Telemetry is best-effort and must never interrupt playback.
  }
}
