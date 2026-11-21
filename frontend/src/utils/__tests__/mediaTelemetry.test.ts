import { describe, expect, it } from "vitest";
import { readPlaybackMedia } from "../mediaTelemetry";

describe("播放实测媒体信息", () => {
  it("使用视频元素的真实尺寸，并关联当前 HLS level 的码率和编码", () => {
    const player = {
      media: { videoWidth: 1920, videoHeight: 1080 },
      getPlugin: () => ({
        hls: {
          currentLevel: 1,
          levels: [
            { bitrate: 3_000_000 },
            { bitrate: 6_000_000, videoCodec: "avc1.640028" },
          ],
        },
      }),
    };

    expect(readPlaybackMedia(player, "https://media.test/1.m3u8")).toEqual({
      url: "https://media.test/1.m3u8",
      width: 1920,
      height: 1080,
      video_bitrate: 6_000_000,
      codec: "avc1.640028",
    });
  });

  it("视频尚未产生真实尺寸时不伪造实测记录", () => {
    expect(
      readPlaybackMedia({ media: { videoWidth: 0, videoHeight: 0 } }, "x")
    ).toBeNull();
  });
});
