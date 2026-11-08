import { lazy } from "react";
import type { ComponentType } from "react";

const RELOAD_KEY = "ht-chunk-reload";
const RELOAD_WINDOW_MS = 10_000;

/**
 * 带缓存清除参数重载页面，同一会话 10 秒内最多一次。
 *
 * 场景：每次 `npm run build` 都会清空 dist/assets 并换 hash。手机浏览器如果拿着
 * 旧的 index.html（或停在旧页面上切路由），去请求已经删掉的 chunk 就会失败，
 * React 拿不到组件 → 白屏。重载并带上 `_r` 参数可以绕过缓存的 HTML。
 */
export function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (Date.now() - last < RELOAD_WINDOW_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // 隐私模式下 sessionStorage 不可用：仍然尝试重载一次
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

/**
 * 路由级懒加载失败（chunk 404）时自动重载一次，避免停在白屏。
 */
// 与 React.lazy 的签名保持一致：forwardRef 组件（如 VideoPlayer）也要能套进来
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      reloadOnce();
      throw error;
    }
  });
}
