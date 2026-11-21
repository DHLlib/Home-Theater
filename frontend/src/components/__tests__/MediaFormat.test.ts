import { describe, expect, it } from "vitest";
import { analyzeFormat } from "../../utils/mediaFormat";

describe("媒体格式契约", () => {
  it.each(["m3u8", "ffm3u8", "155m3u8", "xlyun", "360zy", "ckplayer", "M3U8"])(
    "后端可归一化的 HLS 后缀 %s 在播放器中也识别为 HLS",
    (suffix) => {
      expect(analyzeFormat("https://example.com/video", suffix).isM3u8).toBe(true);
    }
  );

  it.each(["", "mp4", "webm", "flv", "unknown"])(
    "非 HLS 后缀 %s 不会误用 HLS 播放器",
    (suffix) => {
      expect(analyzeFormat("https://example.com/video", suffix).isM3u8).toBe(false);
    }
  );

  it("后缀缺失时仍可按 URL 识别 m3u8", () => {
    expect(analyzeFormat("https://example.com/live.m3u8?token=1", "").isM3u8).toBe(true);
  });
});
