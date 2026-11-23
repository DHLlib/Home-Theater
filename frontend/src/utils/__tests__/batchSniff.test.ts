import { describe, expect, it } from "vitest";

import { MAX_BATCH_SNIFF, parseBatchSites } from "../batchSniff";

describe("parseBatchSites", () => {
  it("兼容 TVBox 的 api_site 配置", () => {
    const input = JSON.stringify({
      cache_time: 7200,
      api_site: {
        "iqiyizyapi.com": {
          name: "🎬-爱奇艺-",
          api: "https://iqiyizyapi.com/api.php/provide/vod",
          detail: "https://iqiyizyapi.com",
        },
        "dbzy.tv": {
          name: "🎬豆瓣资源",
          api: "https://caiji.dbzy5.com/api.php/provide/vod",
          detail: "https://dbzy.tv",
        },
      },
    });

    const { items, skipped } = parseBatchSites(input);

    expect(skipped).toBe(0);
    expect(items).toEqual([
      { name: "🎬-爱奇艺-", url: "https://iqiyizyapi.com/api.php/provide/vod" },
      { name: "🎬豆瓣资源", url: "https://caiji.dbzy5.com/api.php/provide/vod" },
    ]);
  });

  it("api_site 缺 name 时用主机名兜底", () => {
    const input = JSON.stringify({
      api_site: { "abc.com": { api: "https://abc.com/api.php/provide/vod" } },
    });
    expect(parseBatchSites(input).items[0].name).toBe("abc.com");
  });

  it("兼容 name/url 数组与 name/api 数组", () => {
    const byUrl = parseBatchSites(
      JSON.stringify([{ name: "A", url: "http://a.test/api" }])
    );
    const byApi = parseBatchSites(
      JSON.stringify([{ name: "B", api: "https://b.test/api" }])
    );
    expect(byUrl.items[0]).toEqual({ name: "A", url: "http://a.test/api" });
    expect(byApi.items[0]).toEqual({ name: "B", url: "https://b.test/api" });
  });

  it("跳过没有地址或协议不对的条目，但不整体失败", () => {
    const input = JSON.stringify({
      api_site: {
        good: { name: "好的", api: "https://good.test/api" },
        noapi: { name: "没地址", detail: "https://noapi.test" },
        bad: { name: "协议不对", api: "ftp://bad.test/api" },
      },
    });

    const { items, skipped } = parseBatchSites(input);

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("好的");
    expect(skipped).toBe(2);
  });

  it("空输入、坏 JSON、不认识的格式都给出明确错误", () => {
    expect(() => parseBatchSites("   ")).toThrow("请粘贴站点配置");
    expect(() => parseBatchSites("{oops")).toThrow("JSON 格式错误");
    expect(() => parseBatchSites(JSON.stringify({ cache_time: 1 }))).toThrow(
      "无法识别格式"
    );
  });

  it("全部无效时明确报错", () => {
    const input = JSON.stringify({ api_site: { x: { name: "x" } } });
    expect(() => parseBatchSites(input)).toThrow("没有可用的站点地址");
  });

  it("超过上限时直接拒绝", () => {
    const apiSite: Record<string, { name: string; api: string }> = {};
    for (let i = 0; i <= MAX_BATCH_SNIFF; i += 1) {
      apiSite[`s${i}`] = { name: `站点${i}`, api: `https://s${i}.test/api` };
    }
    expect(() => parseBatchSites(JSON.stringify({ api_site: apiSite }))).toThrow(
      `${MAX_BATCH_SNIFF}`
    );
  });
});
