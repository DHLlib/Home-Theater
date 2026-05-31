import { useCallback, useRef } from "react";

export interface UseAutoHideReturn {
  showControls: () => void;
  hideControls: () => void;
  resetTimer: () => void;
  clearTimer: () => void;
}

interface UseAutoHideOptions {
  delay?: number;
  fullscreenDelay?: number;
  isFullscreen: boolean;
  onShow: () => void;
  onHide: () => void;
}

/**
 * 控制栏 autoHide 计时器 hook
 * - 普通模式 3s 隐藏
 * - 全屏模式 5s 隐藏
 * - 任何交互重置计时器
 */
export function useAutoHide(options: UseAutoHideOptions): UseAutoHideReturn {
  const {
    delay = 3000,
    fullscreenDelay = 5000,
    isFullscreen,
    onShow,
    onHide,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(false);

  // 用 ref 缓存回调引用，避免父组件每次渲染创建新引用导致计时器频繁重建
  const onShowRef = useRef(onShow);
  const onHideRef = useRef(onHide);
  onShowRef.current = onShow;
  onHideRef.current = onHide;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideControls = useCallback(() => {
    if (visibleRef.current) {
      visibleRef.current = false;
      onHideRef.current();
    }
  }, []);

  const resetTimer = useCallback(() => {
    clearTimer();
    const actualDelay = isFullscreen ? fullscreenDelay : delay;
    timerRef.current = setTimeout(() => {
      hideControls();
    }, actualDelay);
  }, [clearTimer, hideControls, isFullscreen, delay, fullscreenDelay]);

  const showControls = useCallback(() => {
    if (!visibleRef.current) {
      visibleRef.current = true;
      onShowRef.current();
    }
    resetTimer();
  }, [resetTimer]);

  return {
    showControls,
    hideControls,
    resetTimer,
    clearTimer,
  };
}
