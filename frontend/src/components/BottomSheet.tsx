import { useEffect, useRef, useCallback } from "react";

interface BottomSheetProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({
  open,
  title,
  onClose,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
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
