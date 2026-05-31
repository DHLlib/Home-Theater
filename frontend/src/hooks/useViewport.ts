import { useState, useEffect } from "react";

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

export function useViewport(): ViewportInfo {
  const [info, setInfo] = useState<ViewportInfo>(getViewportInfo);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setInfo(getViewportInfo());
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

export function useIsMobile(): boolean {
  const { isMobile } = useViewport();
  return isMobile;
}

export function useIsDesktop(): boolean {
  const { isDesktop } = useViewport();
  return isDesktop;
}
