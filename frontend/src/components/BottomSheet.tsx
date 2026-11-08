import { useEffect, useRef, useCallback } from "react";

interface BottomSheetProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** 抽屉内可聚焦元素；Tab / Shift+Tab 在里面循环，不跑到背景页面 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export default function BottomSheet({
  open,
  title,
  onClose,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const touchStartY = useRef<number>(0);
  const touchStartTime = useRef<number>(0);

  // 禁止背景滚动
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  // 打开时把焦点移进抽屉、关闭时还给触发它的元素。
  // 否则键盘与读屏用户会停在背后的页面上，Tab 也会跑到抽屉外面。
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      previousFocusRef.current?.focus?.({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [open]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartY.current = touch.clientY;
    touchStartTime.current = Date.now();
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.changedTouches[0];
      const dy = touch.clientY - touchStartY.current;
      const dt = Date.now() - touchStartTime.current;

      // 向下滑动超过 60px 且速度足够快（< 300ms）则关闭
      if (dy > 60 && dt < 300) {
        onClose();
      }
    },
    [onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const root = sheetRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        (node) =>
          node.offsetWidth > 0 ||
          node.offsetHeight > 0 ||
          node === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || active === root) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="sheet-mask"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 底部抽屉 */}
      <div
        ref={sheetRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title || "底部面板"}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        {title && (
          <div
            style={{
              padding: "12px 16px 0",
              fontSize: 16,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {title}
          </div>
        )}
        <div className="bottom-sheet-content">{children}</div>
      </div>
    </>
  );
}
