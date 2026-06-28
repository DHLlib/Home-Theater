import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useIsMobile } from "../hooks/useViewport";
import DetailContent from "./DetailContent";
import type { AggregatedVideo } from "../types";

// 与卡片端共享元素补间的弹簧手感（生长 / 回缩）
const spring = { type: "spring", damping: 30, stiffness: 300, mass: 1 } as const;

/**
 * 详情弹窗宿主：挂在 Layout，监听 URL 的 ?detail=1 标记 + navigation state
 * 携带的完整 item，渲染居中模态（桌面）或全屏 sheet（移动端）。
 *
 * 开关由 URL 驱动：VideoCard.openDetail push 一次 → 这里渲染；关闭走
 * navigate(-1) 回退该 history entry，海报 layoutId 反向补间回卡片原位。
 * 直接访问 / 刷新导致 state 丢失时（无 detailItem）静默不渲染（暂不做分享降级）。
 */
export default function DetailModalHost() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const open = searchParams.get("detail") === "1";
  const item = (location.state as { detailItem?: AggregatedVideo } | null)
    ?.detailItem;
  const active = open && !!item;

  // 记录弹窗打开时所在的路由。关闭时据此区分：回到同路由（后退/点遮罩）vs 跳走（播放/下载/设置）
  const openPathRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (active) openPathRef.current = location.pathname;
  }, [active, location.pathname]);

  const close = () => {
    // openDetail 是一次 push，后退即关闭
    navigate(-1);
  };

  // 打开时锁 body 滚动：源卡片留在视口，避免虚拟列表回收导致 layoutId 反向补间断链
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  // Esc 关闭
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onSheetDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) close();
  };

  // 因「跳转到其它路由」（播放/下载/设置）而关闭：源卡片随旧页面卸载，
  // 共享元素 layoutId 的另一端已消失，若仍走退场动画会卡住。此时直接卸载，不挂 AnimatePresence。
  const navAwayClose =
    !active &&
    openPathRef.current !== null &&
    openPathRef.current !== location.pathname;
  if (navAwayClose) return null;

  return createPortal(
    <AnimatePresence>
      {active && item && (
        <motion.div
          key="detail-backdrop"
          initial={{
            opacity: 0,
            backdropFilter: "blur(0px)",
            backgroundColor: "rgba(0,0,0,0)",
          }}
          animate={{
            opacity: 1,
            backdropFilter: "blur(20px)",
            backgroundColor: "rgba(0,0,0,0.72)",
          }}
          exit={{
            opacity: 0,
            backdropFilter: "blur(0px)",
            backgroundColor: "rgba(0,0,0,0)",
          }}
          transition={{ duration: 0.3 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 900,
            display: "flex",
            alignItems: isMobile ? "flex-end" : "center",
            justifyContent: "center",
            padding: isMobile ? 0 : 24,
          }}
        >
          {isMobile ? (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={spring}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={onSheetDragEnd}
              style={{
                width: "100%",
                maxHeight:
                  "calc(100dvh - 56px - env(safe-area-inset-bottom))",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                background: "var(--bg-elevated)",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                border: "1px solid var(--glass-border)",
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  padding: "12px 20px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 4,
                    borderRadius: 2,
                    background: "var(--text-muted)",
                  }}
                />
                <button
                  onClick={close}
                  aria-label="关闭"
                  style={{
                    position: "absolute",
                    right: 16,
                    top: 12,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    border: "1px solid var(--glass-border)",
                    background: "var(--bg)",
                    color: "var(--text-primary)",
                    fontSize: 20,
                    lineHeight: 1,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: "0 20px 20px",
                }}
              >
                <DetailContent item={item} variant="sheet" />
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                width: "min(900px, 92vw)",
                maxHeight: "88vh",
                overflowY: "auto",
                background: "var(--bg-elevated)",
                borderRadius: 8,
                border: "1px solid var(--glass-border)",
                padding: 24,
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
              }}
            >
              <button
                onClick={close}
                aria-label="关闭"
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "1px solid var(--glass-border)",
                  background: "var(--bg)",
                  color: "var(--text-primary)",
                  fontSize: 20,
                  lineHeight: 1,
                  cursor: "pointer",
                  zIndex: 2,
                }}
              >
                ×
              </button>
              <DetailContent item={item} variant="modal" />
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
