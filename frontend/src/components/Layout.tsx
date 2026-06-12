import { useEffect, useState, useRef } from "react";
import { NavLink, Outlet, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import BottomNav from "./BottomNav";

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

const pageTransition = {
  type: "tween" as const,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
  duration: 0.3,
};

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const wdFromUrl = searchParams.get("wd") || "";
  const [query, setQuery] = useState(wdFromUrl);
  const navRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const links = [
    { to: "/", label: "首页", end: true },
    { to: "/favorites", label: "收藏" },
    { to: "/dashboard", label: "看板" },
    { to: "/progress", label: "最近" },
    { to: "/downloads", label: "下载" },
    { to: "/settings", label: "设置" },
  ];

  // 更新导航指示条位置
  useEffect(() => {
    const activeLink = links.find((l) => {
      if (l.end) return location.pathname === l.to;
      return location.pathname.startsWith(l.to);
    });
    if (activeLink) {
      const el = navRefs.current.get(activeLink.to);
      if (el) {
        const parent = el.parentElement;
        if (parent) {
          const parentRect = parent.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          setIndicatorStyle({
            left: elRect.left - parentRect.left,
            width: elRect.width,
          });
        }
      }
    }
  }, [location.pathname]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/?wd=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      {/* 顶部导航 — 液态玻璃 */}
      <nav className="top-nav">
        <div className="row" style={{ gap: 4, position: "relative" }}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              ref={(el) => {
                if (el) navRefs.current.set(l.to, el);
              }}
              to={l.to}
              end={l.end}
              className="nav-link"
            >
              {l.label}
            </NavLink>
          ))}
          {/* 绿色导航指示条 */}
          <motion.div
            className="nav-indicator"
            animate={{
              left: indicatorStyle.left,
              width: indicatorStyle.width,
            }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 30,
            }}
            style={{ position: "absolute", bottom: -1 }}
          />
        </div>
        <form
          onSubmit={handleSearch}
          className="row"
          style={{ gap: 0, marginLeft: "auto" }}
        >
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-secondary)",
                pointerEvents: "none",
              }}
            >
              <SearchIcon />
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索..."
              style={{
                width: 200,
                padding: "8px 12px 8px 36px",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </div>
        </form>
      </nav>

      {/* 页面内容 + 转场动画 */}
      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav />
    </div>
  );
}
