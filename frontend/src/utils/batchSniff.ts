export interface BatchSniffSite {
  name: string;
  url: string;
}

export interface BatchSniffParseResult {
  items: BatchSniffSite[];
  /** 缺地址、地址不是 http(s)、或不是对象的条目数 */
  skipped: number;
}

/** 单次嗅探上限：后端 batch-probe 同样按此限制 */
export const MAX_BATCH_SNIFF = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSite(raw: unknown, fallbackName?: string): BatchSniffSite | null {
  if (!isRecord(raw)) return null;
  const name = String(raw.name ?? fallbackName ?? "").trim();
  const url = String(raw.api ?? raw.url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { name: name || url, url };
}

/**
 * 解析批量嗅探输入。兼容三种常见形态：
 * 1. `[{ "name": "...", "url": "..." }]`
 * 2. `[{ "name": "...", "api": "..." }]`
 * 3. TVBox 风格配置 `{ "cache_time": 7200, "api_site": { "域名": { "name", "api", "detail" } } }`
 */
export function parseBatchSites(input: string): BatchSniffParseResult {
  const text = input.trim();
  if (!text) throw new Error("请粘贴站点配置");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? `：${err.message}` : "";
    throw new Error(`JSON 格式错误${detail}`, { cause: err });
  }

  let rawItems: unknown[];
  if (Array.isArray(data)) {
    rawItems = data;
  } else if (isRecord(data) && isRecord(data.api_site)) {
    rawItems = Object.entries(data.api_site).map(([key, value]) =>
      isRecord(value) ? { ...value, name: value.name ?? key } : value
    );
  } else {
    throw new Error(
      "无法识别格式：需要 [{name,url}] 数组，或 {api_site:{...}} 的站点配置"
    );
  }

  if (rawItems.length === 0) throw new Error("配置里没有站点");

  const items: BatchSniffSite[] = [];
  let skipped = 0;
  for (const raw of rawItems) {
    const site = toSite(raw);
    if (site) items.push(site);
    else skipped += 1;
  }

  if (items.length === 0) throw new Error("没有可用的站点地址（需以 http:// 或 https:// 开头）");
  if (items.length > MAX_BATCH_SNIFF) {
    throw new Error(`一次最多 ${MAX_BATCH_SNIFF} 个站点，当前 ${items.length} 个`);
  }
  return { items, skipped };
}
