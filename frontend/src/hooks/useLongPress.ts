import { useCallback, useRef } from "react";

interface UseLongPressOptions {
  onLongPress: () => void;
  ms?: number;
}

/**
 * 长按手势 hook，同时兼容鼠标与触摸。
 * 长按触发 onLongPress；若长按被触发，则捕获并阻止随后的 click 事件，
 * 避免菜单弹出后又误触发点击。
 */
export function useLongPress({ onLongPress, ms = 500 }: UseLongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);

  const start = useCallback(() => {
    triggeredRef.current = false;
    timerRef.current = window.setTimeout(() => {
      triggeredRef.current = true;
      onLongPress();
    }, ms);
  }, [onLongPress, ms]);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    start();
  }, [start]);

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  const onClickCapture = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (triggeredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        triggeredRef.current = false;
      }
    },
    []
  );

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onClickCapture,
  };
}
