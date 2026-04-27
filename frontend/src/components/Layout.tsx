import { useState } from "react";
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

export default function Layout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const wdFromUrl = searchParams.get("wd") || "";
  const [query, setQuery] = useState(wdFromUrl);

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
        </form>
      </nav>
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
