import { useEffect, useRef, useState } from "react";

interface UseAutoHideNavOptions {
  /** 滚动多少距离后开始隐藏（默认 50px） */
  threshold?: number;
  /** 是否在顶部时始终显示（默认 true） */
  showOnTop?: boolean;
  /** 禁用自动隐藏（如播放页全屏时） */
  disabled?: boolean;
}

/**
 * 自动隐藏导航 hook
 * 向下滚动时隐藏导航，向上滚动时显示导航
 */
export function useAutoHideNav({
  threshold = 50,
  showOnTop = true,
  disabled = false,
}: UseAutoHideNavOptions = {}) {
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    if (disabled) {
      setIsVisible(true);
      return;
    }

    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;

          // 在顶部时始终显示
          if (showOnTop && currentScrollY <= 0) {
            setIsVisible(true);
            lastScrollY.current = currentScrollY;
            ticking.current = false;
            return;
          }

          // 滚动距离小于阈值时不触发
          if (Math.abs(currentScrollY - lastScrollY.current) < threshold) {
            ticking.current = false;
            return;
          }

          // 向下滚动隐藏，向上滚动显示
          if (currentScrollY > lastScrollY.current && currentScrollY > threshold) {
            setIsVisible(false);
          } else {
            setIsVisible(true);
          }

          lastScrollY.current = currentScrollY;
          ticking.current = false;
        });
        ticking.current = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold, showOnTop, disabled]);

  return isVisible;
}
