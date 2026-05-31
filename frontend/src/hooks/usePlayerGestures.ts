import { useCallback, useRef, useState } from "react";

type GestureState =
  | "idle"
  | "tracking"
  | "swiping"
  | "pinching"
  | "recognized";

export interface SwipeFeedback {
  direction: "left" | "right";
  offset: number;
}

export interface UsePlayerGesturesReturn {
  gestureState: GestureState;
  swipeFeedback: SwipeFeedback | null;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
}

export interface UsePlayerGesturesOptions {
  onDoubleTap: () => void;
  onSwipe: (direction: "left" | "right") => void;
  onSingleTap: () => void;
  onPinch?: (scale: number) => void;
  /** 是否禁用手势（如选集抽屉打开时） */
  disabled?: boolean;
}

const SWIPE_THRESHOLD = 50;
const DOUBLE_TAP_INTERVAL = 300;
const DOUBLE_TAP_DISTANCE = 20;
const PINCH_THRESHOLD = 0.15;
const HORIZONTAL_RATIO = 2;

interface TouchPoint {
  x: number;
  y: number;
  time: number;
}

interface GestureData {
  start: TouchPoint;
  startTouches: TouchPoint[];
  startDistance: number;
  state: GestureState;
  swipeFeedback: SwipeFeedback | null;
}

/**
 * 播放器手势识别状态机 hook
 *
 * 状态流转：
 * idle → touchstart → tracking
 * tracking → touchmove(位移>阈值, |dx|>|dy|*2) → swiping
 * tracking → touchmove(双指) → pinching
 * tracking → touchend(300ms内无第二次) → recognized(单击)
 * tracking → touchend(300ms内有第二次且位移<20px) → recognized(双击)
 * swiping/pinching → touchend → recognized → 执行动作 → idle
 */
export function usePlayerGestures(
  options: UsePlayerGesturesOptions
): UsePlayerGesturesReturn {
  const { onDoubleTap, onSwipe, onSingleTap, onPinch, disabled } = options;

  const [gestureState, setGestureState] = useState<GestureState>("idle");
  const [swipeFeedback, setSwipeFeedback] = useState<SwipeFeedback | null>(null);

  const dataRef = useRef<GestureData | null>(null);
  const lastTapRef = useRef<TouchPoint | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseRef = useRef<{ start: TouchPoint; down: boolean } | null>(null);

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const getTouchPoint = (t: React.Touch): TouchPoint => ({
    x: t.clientX,
    y: t.clientY,
    time: Date.now(),
  });

  const getDistance = (a: TouchPoint, b: TouchPoint): number => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleRecognized = useCallback(
    (type: "tap" | "doubleTap" | "swipe" | "pinch", payload?: unknown) => {
      if (type === "doubleTap") {
        onDoubleTap();
      } else if (type === "swipe") {
        onSwipe(payload as "left" | "right");
      } else if (type === "tap") {
        onSingleTap();
      } else if (type === "pinch" && onPinch) {
        onPinch(payload as number);
      }
      setGestureState("idle");
      setSwipeFeedback(null);
      dataRef.current = null;
    },
    [onDoubleTap, onSwipe, onSingleTap, onPinch]
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;

      // ckplayer 控制栏区域豁免：不拦截控制栏内的触摸
      const target = e.target as HTMLElement;
      if (target.closest(".ckplayer-controls, .ck-control")) {
        return;
      }

      const touches = e.touches;
      if (touches.length === 0) return;

      // 双击判定：300ms 内第二次触摸且位移 < 20px
      if (lastTapRef.current && touches.length === 1) {
        const now = Date.now();
        const dt = now - lastTapRef.current.time;
        const dist = getDistance(lastTapRef.current, getTouchPoint(touches[0]));
        if (dt < DOUBLE_TAP_INTERVAL && dist < DOUBLE_TAP_DISTANCE) {
          clearClickTimer();
          lastTapRef.current = null;
          setGestureState("recognized");
          handleRecognized("doubleTap");
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        // 不满足双击条件，取消 pending 的单击定时器，避免控制栏闪现
        clearClickTimer();
        lastTapRef.current = null;
      }

      // 记录起始点
      const startPoint = getTouchPoint(touches[0]);
      dataRef.current = {
        start: startPoint,
        startTouches: Array.from(touches).map(getTouchPoint),
        startDistance:
          touches.length >= 2
            ? getDistance(getTouchPoint(touches[0]), getTouchPoint(touches[1]))
            : 0,
        state: "tracking",
        swipeFeedback: null,
      };
      setGestureState("tracking");

      // 记录本次触摸用于下次双击判定
      if (touches.length === 1) {
        lastTapRef.current = startPoint;
      }
    },
    [disabled, clearClickTimer, handleRecognized]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const data = dataRef.current;
      if (!data || data.state === "idle") return;

      const touches = e.touches;
      if (touches.length === 0) return;

      // 双指 pinch
      if (touches.length >= 2 && data.startTouches.length >= 2) {
        const d = getDistance(
          getTouchPoint(touches[0]),
          getTouchPoint(touches[1])
        );
        const ratio = Math.abs(d - data.startDistance) / data.startDistance;
        if (ratio > PINCH_THRESHOLD && data.state !== "pinching") {
          data.state = "pinching";
          setGestureState("pinching");
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // 单指滑动判定
      if (touches.length === 1 && data.state === "tracking") {
        const current = getTouchPoint(touches[0]);
        const dx = current.x - data.start.x;
        const dy = current.y - data.start.y;

        // 水平滑动：|dx| > 50px 且 |dx| > |dy| * 2
        if (
          Math.abs(dx) > SWIPE_THRESHOLD &&
          Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO
        ) {
          data.state = "swiping";
          const direction = dx > 0 ? "right" : "left";
          const feedback: SwipeFeedback = {
            direction,
            offset: Math.abs(dx),
          };
          data.swipeFeedback = feedback;
          setGestureState("swiping");
          setSwipeFeedback(feedback);
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    [disabled]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const data = dataRef.current;
      if (!data) return;

      // 双指 pinch 结束
      if (data.state === "pinching") {
        const touches = e.changedTouches;
        if (touches.length >= 1) {
          // 简化：pinch 结束即触发 toggle fullscreen
          handleRecognized("pinch", 1);
          e.stopPropagation();
        }
        dataRef.current = null;
        return;
      }

      // 滑动结束 → 执行 seek
      if (data.state === "swiping" && data.swipeFeedback) {
        handleRecognized("swipe", data.swipeFeedback.direction);
        e.stopPropagation();
        dataRef.current = null;
        return;
      }

      // 单击判定：tracking 状态下，touchend 时启动 300ms 延迟
      if (data.state === "tracking") {
        const duration = Date.now() - data.start.time;
        if (duration < 500) {
          // 延迟 300ms 判定是否为双击
          clearClickTimer();
          clickTimerRef.current = setTimeout(() => {
            handleRecognized("tap");
            lastTapRef.current = null;
          }, DOUBLE_TAP_INTERVAL);
        } else {
          // 长按超过 500ms，不视为单击
          dataRef.current = null;
          setGestureState("idle");
        }
        return;
      }

      // 兜底清理
      dataRef.current = null;
      setGestureState("idle");
    },
    [disabled, clearClickTimer, handleRecognized]
  );

  // 鼠标事件兼容（桌面端）
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      const target = e.target as HTMLElement;
      if (target.closest(".ckplayer-controls, .ck-control")) return;

      mouseRef.current = {
        start: { x: e.clientX, y: e.clientY, time: Date.now() },
        down: true,
      };
    },
    [disabled]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      const mouse = mouseRef.current;
      if (!mouse || !mouse.down) return;

      const dx = e.clientX - mouse.start.x;
      const dy = e.clientY - mouse.start.y;

      if (
        Math.abs(dx) > SWIPE_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO
      ) {
        const direction = dx > 0 ? "right" : "left";
        mouse.down = false;
        onSwipe(direction);
        mouseRef.current = null;
      }
    },
    [disabled, onSwipe]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      const mouse = mouseRef.current;
      if (!mouse || !mouse.down) {
        mouseRef.current = null;
        return;
      }

      const dx = e.clientX - mouse.start.x;
      const dy = e.clientY - mouse.start.y;
      const duration = Date.now() - mouse.start.time;

      mouseRef.current = null;

      // 双击判定
      if (lastTapRef.current) {
        const dt = Date.now() - lastTapRef.current.time;
        const dist = getDistance(lastTapRef.current, {
          x: e.clientX,
          y: e.clientY,
          time: Date.now(),
        });
        if (dt < DOUBLE_TAP_INTERVAL && dist < DOUBLE_TAP_DISTANCE) {
          clearClickTimer();
          lastTapRef.current = null;
          onDoubleTap();
          return;
        }
      }

      // 滑动
      if (
        Math.abs(dx) > SWIPE_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO
      ) {
        const direction = dx > 0 ? "right" : "left";
        onSwipe(direction);
        return;
      }

      // 单击
      if (Math.abs(dx) < 10 && duration < 500) {
        lastTapRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
        clearClickTimer();
        clickTimerRef.current = setTimeout(() => {
          onSingleTap();
          lastTapRef.current = null;
        }, DOUBLE_TAP_INTERVAL);
      }
    },
    [disabled, clearClickTimer, onDoubleTap, onSwipe, onSingleTap]
  );

  return {
    gestureState,
    swipeFeedback,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
  };
}
