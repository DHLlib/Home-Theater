import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import BottomNav from "./BottomNav";
import CategoryBar from "./CategoryBar";
import { useSitesQuery } from "../hooks/useVideos";

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

function MenuIcon({ size = 20 }: { size?: number }) {
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
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon({ size = 20 }: { size?: number }) {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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

const GLOBAL_LINKS = [
  { to: "/", label: "首页", end: true },
  { to: "/favorites", label: "收藏" },
  { to: "/dashboard", label: "看板" },
  { to: "/progress", label: "最近" },
  { to: "/downloads", label: "下载" },
  { to: "/settings", label: "设置" },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: sites = [] } = useSitesQuery();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState(searchParams.get("wd") || "");

  const activeCategory = searchParams.get("category") || null;

  // URL 中的搜索词变化时同步输入框
  useEffect(() => {
    setQuery(searchParams.get("wd") || "");
  }, [searchParams]);

  // 路由切换时自动关闭抽屉
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    const next = new URLSearchParams(searchParams);
    if (!q) {
      next.delete("wd");
    } else {
      next.set("wd", q);
    }
    navigate(`/?${next.toString()}`);
  };

  const handleSelectCategory = (category: string | null) => {
    const next = new URLSearchParams();
    if (category) {
      next.set("category", category);
    }
    navigate(`/?${next.toString()}`);
  };

  return (
    <div>
      {/* 单层顶部导航：菜单 + 品牌 | 分类 | 搜索 */}
      <nav className="top-nav top-nav--single" aria-label="顶部导航">
        <div className="top-nav-left">
          <button
            className="nav-menu-btn"
            aria-label="打开菜单"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>
          <Link to="/" className="nav-brand">
            Home Theater
          </Link>
        </div>

        <div className="top-nav-categories">
          <CategoryBar
            sites={sites}
            activeCategory={activeCategory}
            onSelect={handleSelectCategory}
            variant="inline"
          />
        </div>

        <form onSubmit={handleSearch} className="nav-search">
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
              aria-label="搜索"
              style={{
                width: 180,
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

      {/* 全局导航抽屉 */}
      <div
        className={drawerOpen ? "drawer-root open" : "drawer-root"}
        aria-hidden={!drawerOpen}
      >
        <div
          className="drawer-mask"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
        <aside className="side-drawer" aria-label="全局导航">
          <div className="drawer-header">
            <span className="nav-brand">Home Theater</span>
            <button
              className="nav-menu-btn"
              aria-label="关闭菜单"
              onClick={() => setDrawerOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          <nav className="drawer-nav">
            {GLOBAL_LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className="drawer-link"
                onClick={() => setDrawerOpen(false)}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </aside>
      </div>

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
