import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import DetailModalHost from "./DetailModalHost";
import { useTheme } from "../lib/theme";
import { useAutoHideNav } from "../hooks/useAutoHideNav";
import { useEffect, useState } from "react";
import { ThemeIcon, SearchIcon } from "./icons";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className="nav-icon-btn"
      title={theme === "cinema" ? "切换为浅色主题" : "切换为深色主题"}
      onClick={() => setTheme(theme === "cinema" ? "light" : "cinema")}
      aria-label="切换主题"
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
  const isNavVisible = useAutoHideNav();

  const [query, setQuery] = useState(searchParams.get("wd") || "");

  // 播放页是沉浸式表面：不挂全站顶栏，避免 62px 的导航吃掉画面
  const isPlayer = location.pathname.startsWith("/player");

  useEffect(() => {
    setQuery(searchParams.get("wd") || "");
  }, [searchParams]);

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

  return (
    <div>
      {!isPlayer && (
        <nav
          className={`top-nav${isNavVisible ? "" : " hidden"}`}
          aria-label="顶部导航"
        >
        <div className="top-nav-left">
          <Link to="/" className="nav-brand">
            Home Theater
          </Link>
          <div className="nav-links">
            {GLOBAL_LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `nav-link${isActive ? " is-active" : ""}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>

        <form onSubmit={handleSearch} className="nav-search" role="search">
          <span className="nav-search-icon" aria-hidden="true">
            <SearchIcon size={15} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索片名、演员、年份"
            aria-label="搜索"
            className="nav-search-input"
          />
        </form>

        <div className="top-nav-right">
          <ThemeToggle />
        </div>
        </nav>
      )}

      <main className={isPlayer ? "main-immersive" : undefined}>
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
