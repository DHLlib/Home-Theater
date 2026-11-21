import { get, put } from "./client";

export const getDownloadRoot = async (): Promise<string | null> => {
  try {
    const data = await get<{ value: string }>("/api/settings/download-root");
    return data.value;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
};

export const setDownloadRoot = (path: string) =>
  put<{ value: string }>("/api/settings/download-root", { value: path });

export const getMaxConcurrentDownloads = async (): Promise<number> => {
  try {
    const data = await get<{ value: number }>(
      "/api/settings/max-concurrent-downloads"
    );
    return data.value;
  } catch {
    return 10;
  }
};

export const setMaxConcurrentDownloads = (value: number) =>
  put<{ value: number }>("/api/settings/max-concurrent-downloads", { value });

export const getAdFilterEnabled = async (): Promise<boolean> => {
  try {
    const data = await get<{ value: boolean }>("/api/settings/ad-filter-enabled");
    return data.value;
  } catch {
    return false;
  }
};

export const setAdFilterEnabled = (value: boolean) =>
  put<{ value: boolean }>("/api/settings/ad-filter-enabled", { value });

export interface StreamAccelLevel {
  key: string;
  label: string;
  concurrency: number;
}

export interface StreamAccelSettings {
  enabled: boolean;
  level: string;
  default_level: string;
  levels: StreamAccelLevel[];
}

export const getStreamAccel = () =>
  get<StreamAccelSettings>("/api/settings/stream-accel");

export const setStreamAccel = (enabled: boolean, level?: string) =>
  put<{ enabled: boolean; level: string }>("/api/settings/stream-accel", {
    enabled,
    ...(level ? { level } : {}),
  });

export interface PlaybackFeatureSettings {
  media_analysis: boolean;
  playback_guard: boolean;
  enhancement: boolean;
  enhancement_available: boolean;
  algorithm: string;
  target_height: number;
}

export type PlaybackFeatureChanges = Partial<
  Pick<
    PlaybackFeatureSettings,
    "media_analysis" | "playback_guard" | "enhancement"
  >
>;

export const getPlaybackFeatures = () =>
  get<PlaybackFeatureSettings>("/api/settings/playback-features");

export const updatePlaybackFeatures = (changes: PlaybackFeatureChanges) =>
  put<PlaybackFeatureSettings>("/api/settings/playback-features", changes);