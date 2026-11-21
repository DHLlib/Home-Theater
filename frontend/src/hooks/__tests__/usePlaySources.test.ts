import { describe, expect, it } from "vitest";
import type { PlaySource, SourceRef } from "../../types";
import {
  mergeSourceQuality,
  orderSourcesByQuality,
} from "../usePlaySources";

const original: SourceRef[] = [
  { site_id: 1, original_id: "a", site_name: "站点A" },
  { site_id: 2, original_id: "b", site_name: "站点B" },
];

const ranked: PlaySource[] = [
  {
    site_id: 2,
    original_id: "b",
    site_name: "站点B",
    episode_count: 12,
    suffix: "ffm3u8",
    recommended: true,
    recommendation_reason: "成功率 95%",
  },
  {
    site_id: 1,
    original_id: "a",
    site_name: "站点A",
    episode_count: 12,
    suffix: "ffm3u8",
  },
];

describe("play source quality helpers", () => {
  it("按后端质量顺序排列并保留原始字段", () => {
    const ordered = orderSourcesByQuality(original, ranked);
    expect(ordered.map((source) => source.original_id)).toEqual(["b", "a"]);
    expect(ordered[0].site_name).toBe("站点B");
  });

  it("把推荐信息合并到选源数据", () => {
    const merged = mergeSourceQuality(original, ranked);
    expect(merged[0].recommended).toBe(true);
    expect(merged[0].recommendation_reason).toBe("成功率 95%");
    expect(merged[1].recommended).toBeUndefined();
  });
});
