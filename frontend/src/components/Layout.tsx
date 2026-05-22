import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";

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

function SunIcon({ size = 14 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ size = 14 }: { size?: number }) {
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
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const wdFromUrl = searchParams.get("wd") || "";
  const [query, setQuery] = useState(wdFromUrl);
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") || "light"
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "theme" && e.newValue) {
        setTheme(e.newValue);
        document.documentElement.setAttribute("data-theme", e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const links = [
    { to: "/", label: "首页", end: true },
    { to: "/favorites", label: "收藏" },
    { to: "/progress", label: "最近" },
    { to: "/downloads", label: "下载" },
    { to: "/settings", label: "设置" },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/?wd=${encodeURIComponent(q)}`);
  };

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  };

  return (
    <div>
      <nav>
        <div className="row" style={{ gap: 4 }}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className="nav-link"
            >
              {l.label}
            </NavLink>
          ))}
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
                left: 10,
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
                width: 180,
                padding: "6px 10px 6px 32px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--fg)",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </div>
          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            title={theme === "light" ? "切换深色模式" : "切换浅色模式"}
            style={{ padding: "8px 10px", minHeight: 40, marginLeft: 4 }}
            aria-label={theme === "light" ? "切换深色模式" : "切换浅色模式"}
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
        </form>
      </nav>
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
