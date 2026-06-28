import { useMobileLayout } from "../hooks/useViewport";
import DesktopLayout from "./DesktopLayout";
import MobileLayout from "./MobileLayout";

/**
 * 布局入口：根据当前视口决定渲染桌面布局或移动布局。
 *
 * 之前 Layout.tsx 同时渲染两套导航并通过 CSS 隐藏，导致 DOM 冗余、层级冲突。
 * 现在拆分为 DesktopLayout / MobileLayout，由这里按设备形态二选一渲染。
 */
export default function Layout() {
  const { isMobile } = useMobileLayout();
  return isMobile ? <MobileLayout /> : <DesktopLayout />;
}
