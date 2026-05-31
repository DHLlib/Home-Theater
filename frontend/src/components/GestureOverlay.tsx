import { useEffect, useRef } from "react";
import type { UsePlayerGesturesReturn } from "../hooks/usePlayerGestures";

interface GestureOverlayProps {
  gestureHandlers: UsePlayerGesturesReturn;
  children: React.ReactNode;
}

/**
 * 透明手势覆盖层组件
 * 在 ckplayer 容器之上叠加一层，专门负责手势事件监听
 * - 原生 addEventListener capture 阶段拦截 touch 事件，阻止 ckplayer 原生监听
 * - 不拦截 ckplayer 控制栏区域的点击
 * - touch-action: none 阻止默认滚动（仅在水平滑动识别期间）
 */
export default function GestureOverlay({ gestureHandlers, children }: GestureOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef(gestureHandlers);

  // 保持 handlersRef 始终指向最新引用
  useEffect(() => {
    handlersRef.current = gestureHandlers;
  });

  // 原生 capture 阶段绑定 touch 事件
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // 构造兼容 React.TouchEvent 的伪事件对象
      const synthetic = {
        ...e,
        touches: e.touches,
        changedTouches: e.changedTouches,
        target: e.target,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.TouchEvent;
      handlersRef.current.onTouchStart(synthetic);
    };

    const onTouchMove = (e: TouchEvent) => {
      const synthetic = {
        ...e,
        touches: e.touches,
        changedTouches: e.changedTouches,
        target: e.target,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.TouchEvent;
      handlersRef.current.onTouchMove(synthetic);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const synthetic = {
        ...e,
        touches: e.touches,
        changedTouches: e.changedTouches,
        target: e.target,
        stopPropagation: () => e.stopPropagation(),
        preventDefault: () => e.preventDefault(),
      } as unknown as React.TouchEvent;
      handlersRef.current.onTouchEnd(synthetic);
    };

    el.addEventListener("touchstart", onTouchStart, { capture: true });
    el.addEventListener("touchmove", onTouchMove, { capture: true });
    el.addEventListener("touchend", onTouchEnd, { capture: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("touchend", onTouchEnd, { capture: true });
    };
  }, []);

  const {
    onMouseDown,
    onMouseMove,
    onMouseUp,
  } = gestureHandlers;

  return (
    <div
      ref={overlayRef}
      className="gesture-overlay"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {children}
    </div>
  );
}
