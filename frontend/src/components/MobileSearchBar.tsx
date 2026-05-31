import { useState } from "react";
import { useNavigate } from "react-router-dom";

function SearchIcon({ size = 18 }: { size?: number }) {
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

export default function MobileSearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/?wd=${encodeURIComponent(q)}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mobile-search-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        marginBottom: 12,
      }}
    >
      <div style={{ position: "relative", flex: 1 }}>
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
          placeholder="搜索视频..."
          style={{
            width: "100%",
            padding: "10px 12px 10px 40px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--fg)",
            fontSize: 14,
            fontFamily: "inherit",
            minHeight: 44,
          }}
        />
      </div>
    </form>
  );
}
