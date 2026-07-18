import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import CategoryBar from "./CategoryBar";
import DetailModalHost from "./DetailModalHost";
import { useSitesQuery } from "../hooks/useVideos";
import { useTheme } from "../lib/theme";
import { useAutoHideNav } from "../hooks/useAutoHideNav";
import { useState, useEffect } from "react";
import {
  MenuIcon,
  CloseIcon,
  ThemeIcon,
  SearchIcon,
} from "./icons";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className="nav-menu-btn"
      title={theme === "cinema" ? "切换为暖黑影院" : "切换为深黑影院"}
      onClick={() => setTheme(theme === "cinema" ? "crimson" : "cinema")}
      style={{ marginLeft: 8 }}
    >
      <ThemeIcon size={18} />
    </button>
  );
}

const GLOBAL_LINKS = [
  { to: "/", label: "首页", end: true },
  { to: "/favorites", label: "收藏" },
  { to: "/dashboard", label: "看板" },
  { to: "/progress", label: "最近" },
  { to: "/downloads", label: "下载" },
  { to: "/settings", label: "设置" },
];

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const pageTransition = {
  duration: 0.2,
};

export default function DesktopLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: sites = [] } = useSitesQuery();
  const isNavVisible = useAutoHideNav();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState(searchParams.get("wd") || "");

  const activeCategory = searchParams.get("category") || null;

  useEffect(() => {
    setQuery(searchParams.get("wd") || "");
  }, [searchParams]);

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
      <nav
        className={`top-nav top-nav--single ${isNavVisible ? "" : "hidden"}`}
        aria-label="顶部导航"
      >
        <div className="top-nav-left">
          <button
            className="nav-menu-btn"
            aria-label="打开菜单"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon size={20} />
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
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            >
              <SearchIcon size={16} />
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索..."
              aria-label="搜索"
              style={{
                width: "min(180px, 100%)",
                padding: "8px 12px 8px 36px",
                borderRadius: 4,
                fontSize: 16,
                fontFamily: "inherit",
              }}
            />
          </div>
          <ThemeToggle />
        </form>
      </nav>

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
              <CloseIcon size={20} />
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

      <DetailModalHost />
    </div>
  );
}
