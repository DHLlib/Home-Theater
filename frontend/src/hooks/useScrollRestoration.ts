import { useEffect, useRef } from "react";

const STORAGE_PREFIX = "home-scroll:";
const RESTORE_TIMEOUT_MS = 2500;

function readSaved(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function saveScroll(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(window.scrollY));
  } catch {
    // 隐私模式/配额满：忽略
  }
}

/**
 * 首页滚动位置保存与恢复。
 *
 * 浏览器默认的 scrollRestoration 会在页面内容（虚拟列表高度）还没建立时
 * 抢先恢复，结果被夹到顶部，表现为「F5 之后滚动位置跳走」。
 * 这里关闭默认行为，等列表高度可容纳目标位置后再自己恢复。
 */
export function useScrollRestoration(key: string, ready: boolean): void {
  const restoredRef = useRef(false);

  // 记录滚动位置（rAF 节流；离开/刷新前兜底保存）
  // 恢复完成前不写入，避免刷新瞬间的 scroll(0) 把已保存的位置冲掉
  useEffect(() => {
    let queued = false;
    const onScroll = () => {
      if (!restoredRef.current || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        saveScroll(key);
      });
    };
    const onPageHide = () => {
      if (restoredRef.current) saveScroll(key);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      if (restoredRef.current) saveScroll(key);
    };
  }, [key]);

  // 关闭浏览器默认恢复
  useEffect(() => {
    if (!("scrollRestoration" in history)) return;
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);

  // 切换列表（分类/搜索条件变化）时允许对新 key 重新恢复
  useEffect(() => {
    restoredRef.current = false;
  }, [key]);

  // 数据就绪后恢复：等虚拟列表把文档撑到足够高，避免被提前 clamp
  useEffect(() => {
    if (!ready || restoredRef.current) return;
    const target = readSaved(key);
    if (target == null || target <= 1) {
      restoredRef.current = true;
      return;
    }

    const start = performance.now();
    let lastHeight = -1;
    let stableFrames = 0;
    let frame = 0;

    const finish = (top: number) => {
      restoredRef.current = true;
      // 虚拟列表在滚动后还会做一次行高测量，可能微调总高度；
      // 再补两帧重新对齐目标位置，避免差出一行。
      const apply = () => window.scrollTo(0, top);
      apply();
      requestAnimationFrame(() => {
        apply();
        requestAnimationFrame(apply);
      });
    };

    const tick = () => {
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight
      );

      if (maxScroll >= target) {
        finish(target);
        return;
      }

      const height = document.documentElement.scrollHeight;
      if (height === lastHeight) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastHeight = height;
      }

      // 高度连续多帧不变（首屏内容已稳定）或超时：恢复到能到达的最远位置
      if (stableFrames >= 12 || performance.now() - start > RESTORE_TIMEOUT_MS) {
        finish(maxScroll);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, key]);
}
