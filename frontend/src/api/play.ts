import { get, post } from "./client";
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

export const analyzeSources = (
  title: string,
  year?: number | null,
  offset = 0
) =>
  post<PlaySourcesResponse>("/api/play/sources/analyze", { title, year, offset });

export interface EnhancementCapability {
  available: boolean;
  algorithm: string;
  target_height: number;
}

export interface EnhancementStartResponse {
  session_id: string;
  url: string;
  algorithm: string;
  target_height: number;
}

export const getEnhancementCapability = () =>
  get<EnhancementCapability>("/api/play/enhance/capability");

export const startEnhancement = (input: {
  site_id: number;
  url: string;
  suffix: string;
  session_id?: string;
}) => post<EnhancementStartResponse>("/api/play/enhance", input);

export async function stopEnhancement(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/play/enhance/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      keepalive: true,
    });
  } catch {
    // 后端空闲看门狗是停止请求失败时的兜底。
  }
}

export async function sendPlaybackHeartbeat(
  sessionId: string,
  active: boolean
): Promise<void> {
  try {
    await fetch("/api/play/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, active }),
      keepalive: true,
    });
  } catch {
    // 播放保护失败时不打断播放；会话会在后端自动过期。
  }
}

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
