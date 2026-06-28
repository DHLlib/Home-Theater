import { useEffect, useState, useSyncExternalStore } from "react";

export const BREAKPOINTS = {
  MOBILE_MAX: 767,
  TABLET_MIN: 768,
  TABLET_MAX: 1023,
  DESKTOP_MIN: 1024,
} as const;

export interface ViewportInfo {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

function getViewportInfo(): ViewportInfo {
  const width = typeof window !== "undefined" ? window.innerWidth : 1024;
  const height = typeof window !== "undefined" ? window.innerHeight : 768;
  return {
    width,
    height,
    isMobile: width <= BREAKPOINTS.MOBILE_MAX,
    isTablet: width >= BREAKPOINTS.TABLET_MIN && width <= BREAKPOINTS.TABLET_MAX,
    isDesktop: width >= BREAKPOINTS.DESKTOP_MIN,
  };
}

function getMql(query: string): MediaQueryList | null {
  return typeof window !== "undefined" ? window.matchMedia(query) : null;
}

function subscribeMql(query: string, callback: () => void): () => void {
  const mql = getMql(query);
  if (!mql) return () => {};
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMql(`(max-width: ${BREAKPOINTS.MOBILE_MAX}px)`, cb),
    () => getMql(`(max-width: ${BREAKPOINTS.MOBILE_MAX}px)`)?.matches ?? false,
    () => false
  );
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMql(`(min-width: ${BREAKPOINTS.DESKTOP_MIN}px)`, cb),
    () => getMql(`(min-width: ${BREAKPOINTS.DESKTOP_MIN}px)`)?.matches ?? false,
    () => false
  );
}

export function useViewport(): ViewportInfo {
  const [info, setInfo] = useState<ViewportInfo>(getViewportInfo);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setInfo((prev) => {
          const next = getViewportInfo();
          if (
            prev.width === next.width &&
            prev.height === next.height &&
            prev.isMobile === next.isMobile &&
            prev.isTablet === next.isTablet &&
            prev.isDesktop === next.isDesktop
          ) {
            return prev;
          }
          return next;
        });
      }, 150);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  return info;
}

export type LayoutType = "mobile" | "tablet" | "desktop";

export interface MobileLayoutInfo {
  type: LayoutType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/**
 * 返回当前应该使用的布局形态。
 * 在组件层面决定渲染 MobileLayout 还是 DesktopLayout，避免一份 DOM 内
 * 同时存在两套导航并通过 CSS 隐藏。
 */
export function useMobileLayout(): MobileLayoutInfo {
  const { isMobile, isTablet, isDesktop } = useViewport();
  let type: LayoutType = "desktop";
  if (isMobile) type = "mobile";
  else if (isTablet) type = "tablet";
  return { type, isMobile, isTablet, isDesktop };
}
