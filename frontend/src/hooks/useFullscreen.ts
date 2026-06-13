import { useCallback, useEffect, useRef, useState } from "react";
import { fullscreen } from "../utils/fullscreen";

export interface UseFullscreenReturn {
  isFullscreen: boolean;
  isFakeLandscape: boolean;
  isSimulatedFullscreen: boolean;
  enterFullscreen: (element?: HTMLElement | null) => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: (element?: HTMLElement | null) => Promise<void>;
}

/**
 * 检测屏幕当前是否为竖屏
 */
function isPortrait(): boolean {
  const angle = (screen as any).orientation?.angle ?? window.orientation ?? 0;
  return angle === 0 || angle === 180;
}

/**
 * 检测浏览器是否支持方向锁定
 * 注意：国产浏览器（夸克/微信）可能声称支持但调用无效，需实际测试
 */
function supportsOrientationLock(): boolean {
  try {
    const lock = (screen as any).orientation?.lock;
    if (typeof lock !== "function") return false;
    // 实际调用一次测试（传入无效参数会抛错，可用来验证）
    // 但这里只做基本检查，真正调用时 catch 失败
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测是否需要强制伪横屏（夸克等浏览器声称支持 orientation.lock 但无效）
 */
function needsFakeLandscape(): boolean {
  const ua = navigator.userAgent;
  // 夸克浏览器：无论是否声称支持 orientation.lock，都使用伪横屏
  if (/Quark|UCBrowser/i.test(ua)) return true;
  // 微信内置浏览器
  if (/MicroMessenger/i.test(ua)) return true;
  // 其他浏览器：如果声称支持则信任，否则用伪横屏
  return !supportsOrientationLock();
}

/**
 * 全屏 API 兼容 hook
 * 自动监听 fullscreenchange 事件同步状态
 * 对不支持 screen.orientation.lock 的浏览器（夸克/微信等）使用 CSS 伪横屏
 */
export function useFullscreen(): UseFullscreenReturn {
  const [isFullscreen, setIsFullscreen] = useState(() => fullscreen.isFullscreen());
  const [isFakeLandscape, setIsFakeLandscape] = useState(false);
  const [isSimulatedFullscreen, setIsSimulatedFullscreen] = useState(false);
  const stateRef = useRef(isFullscreen);
  stateRef.current = isFullscreen;

  useEffect(() => {
    const handler = () => {
      const next = fullscreen.isFullscreen();
      setIsFullscreen(next);
      if (next) {
        if (!needsFakeLandscape()) {
          fullscreen.lockOrientation().catch(() => {});
        } else if (isPortrait()) {
          setIsFakeLandscape(true);
        }
      } else {
        fullscreen.unlockOrientation();
        setIsFakeLandscape(false);
      }
    };
    fullscreen.addChangeListener(handler);
    return () => fullscreen.removeChangeListener(handler);
  }, []);

  const enterFullscreen = useCallback(async (element?: HTMLElement | null) => {
    if (!element) return;
    try {
      await fullscreen.requestFullscreen(element);
      // 夸克/微信等浏览器可能不触发 fullscreenchange，延迟主动检查
      setTimeout(() => {
        const now = fullscreen.isFullscreen();
        if (now) {
          setIsFullscreen(true);
          if (!needsFakeLandscape()) {
            fullscreen.lockOrientation().catch(() => {});
          } else if (isPortrait()) {
            setIsFakeLandscape(true);
          }
        }
      }, 500);
    } catch {
      // 全屏 API 不支持或失败，使用 CSS 模拟全屏
      setIsSimulatedFullscreen(true);
      if (needsFakeLandscape() && isPortrait()) {
        setIsFakeLandscape(true);
      }
    }
  }, []);

  const exitFullscreenFn = useCallback(async () => {
    if (isSimulatedFullscreen) {
      setIsSimulatedFullscreen(false);
      setIsFakeLandscape(false);
      return;
    }
    try {
      await fullscreen.exitFullscreen();
      await fullscreen.unlockOrientation();
      setIsFakeLandscape(false);
    } catch {
      // 静默失败
    }
  }, [isSimulatedFullscreen]);

  const toggleFullscreen = useCallback(async (element?: HTMLElement | null) => {
    if (stateRef.current || isSimulatedFullscreen) {
      await exitFullscreenFn();
    } else {
      await enterFullscreen(element);
    }
  }, [enterFullscreen, exitFullscreenFn, isSimulatedFullscreen]);

  return {
    isFullscreen,
    isFakeLandscape,
    isSimulatedFullscreen,
    enterFullscreen,
    exitFullscreen: exitFullscreenFn,
    toggleFullscreen,
  };
}
