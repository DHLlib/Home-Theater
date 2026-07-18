import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAutoHideNav } from "../hooks/useAutoHideNav";
import {
  HomeIcon,
  SearchIcon,
  HeartIcon,
  DashboardIcon,
  SettingsIcon,
} from "./icons";

const TABS = [
  { to: "/", label: "首页", end: true, Icon: HomeIcon },
  { to: "/search", label: "搜索", end: true, Icon: SearchIcon },
  { to: "/favorites", label: "收藏", end: false, Icon: HeartIcon },
  { to: "/dashboard", label: "看板", end: false, Icon: DashboardIcon },
  { to: "/settings", label: "设置", end: false, Icon: SettingsIcon },
];

export default function BottomNav() {
  const location = useLocation();
  const isVisible = useAutoHideNav();

  return (
    <nav
      className={`bottom-nav ${isVisible ? "" : "hidden"}`}
      aria-label="底部导航"
    >
      {TABS.map((tab) => {
        const isActive = tab.end
          ? location.pathname === tab.to
          : location.pathname.startsWith(tab.to);
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={`bottom-nav-item${isActive ? " active" : ""}`}
            aria-label={tab.label}
            style={{ position: "relative" }}
          >
            <tab.Icon size={22} />
            <span>{tab.label}</span>
            {isActive && (
              <motion.div
                layoutId="bottom-nav-indicator"
                style={{
                  position: "absolute",
                  top: 4,
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--primary)",
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
