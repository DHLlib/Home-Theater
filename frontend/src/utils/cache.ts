/** 基于 IndexedDB 的 API 响应缓存层 */

const DB_NAME = "ht-cache";
const DB_VERSION = 1;

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const TTL_MS = {
  aggregated: 5 * 60 * 1000, // 5 分钟
  detail: 10 * 60 * 1000, // 10 分钟
  episodes: 10 * 60 * 1000, // 10 分钟
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("aggregated")) {
        db.createObjectStore("aggregated");
      }
      if (!db.objectStoreNames.contains("detail")) {
        db.createObjectStore("detail");
      }
      if (!db.objectStoreNames.contains("episodes")) {
        db.createObjectStore("episodes");
      }
    };
  });
  return dbPromise;
}

async function get<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const entry: CacheEntry<T> | undefined = await new Promise(
      (resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }
    );
    if (!entry) return null;
    const ttl = TTL_MS[storeName as keyof typeof TTL_MS] || 5 * 60 * 1000;
    if (Date.now() - entry.ts > ttl) return null;
    return entry.value;
  } catch {
    return null;
  }
}

async function set<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ value, ts: Date.now() }, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // 静默失败，缓存非关键路径
  }
}

/* ===== 聚合列表缓存 ===== */

export function cacheAggregatedKey(
  params: {
    category?: string | null;
    timeFilter?: string | number;
    viewMode?: string;
    page?: number;
    wd?: string;
  }
): string {
  const { category, timeFilter, viewMode, page, wd } = params;
  return [category ?? "", timeFilter ?? "", viewMode ?? "", page ?? 1, wd ?? ""].join(":");
}

export async function getCachedAggregated<T>(params: Parameters<typeof cacheAggregatedKey>[0]): Promise<T | null> {
  return get<T>("aggregated", cacheAggregatedKey(params));
}

export async function setCachedAggregated<T>(params: Parameters<typeof cacheAggregatedKey>[0], value: T): Promise<void> {
  return set<T>("aggregated", cacheAggregatedKey(params), value);
}

/* ===== 详情缓存 ===== */

export function cacheDetailKey(title: string, year?: number | null): string {
  return `${title}::${year ?? "null"}`;
}

export async function getCachedDetail<T>(title: string, year?: number | null): Promise<T | null> {
  return get<T>("detail", cacheDetailKey(title, year));
}

export async function setCachedDetail<T>(title: string, year: number | null | undefined, value: T): Promise<void> {
  return set<T>("detail", cacheDetailKey(title, year), value);
}

/* ===== 集数缓存 ===== */

export function cacheEpisodesKey(site_id: number, original_id: string): string {
  return `${site_id}::${original_id}`;
}

export async function getCachedEpisodes<T>(site_id: number, original_id: string): Promise<T | null> {
  return get<T>("episodes", cacheEpisodesKey(site_id, original_id));
}

export async function setCachedEpisodes<T>(site_id: number, original_id: string, value: T): Promise<void> {
  return set<T>("episodes", cacheEpisodesKey(site_id, original_id), value);
}
