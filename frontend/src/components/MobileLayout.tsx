import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import BottomNav from "./BottomNav";
import DetailModalHost from "./DetailModalHost";

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransition = {
  type: "tween" as const,
  // 与 DESIGN.md §6.1 同一刻度：0.15 / 0.2 / 0.3 秒（framer-motion 只吃数字，读不到 CSS 变量）
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
  duration: 0.2,
};

export default function MobileLayout() {
  const location = useLocation();

  return (
    <div className="mobile-layout-root">
      <main className="mobile-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="mobile-page"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav />
      <DetailModalHost />
    </div>
  );
}
