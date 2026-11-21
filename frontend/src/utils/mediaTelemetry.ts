import type { PlaybackMediaInfo } from "../types";

export function readPlaybackMedia(
  player: any,
  url: string
): PlaybackMediaInfo | null {
  const video = player?.media as HTMLVideoElement | null | undefined;
  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  if (!width || !height) return null;

  const hlsPlugin = player?.getPlugin?.("hlsJs") || player?.plugins?.hlsJs || player?.hls;
  const hls = hlsPlugin?.hls || hlsPlugin?.core || hlsPlugin;
  const level = Array.isArray(hls?.levels)
    ? hls.levels[hls.currentLevel]
    : undefined;
  const rawBitrate = level?.bitrate ?? level?.attrs?.["AVERAGE-BANDWIDTH"];
  const bitrate = Number(rawBitrate);
  return {
    url,
    width,
    height,
    video_bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    codec: level?.videoCodec ?? level?.codec ?? null,
  };
}
