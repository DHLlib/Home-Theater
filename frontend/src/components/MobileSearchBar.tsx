import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "./icons";

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
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        >
          <SearchIcon size={18} />
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索视频..."
          style={{
            width: "100%",
            padding: "10px 12px 10px 40px",
            borderRadius: 4,
            border: "1px solid var(--border-hover)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: 16,
            fontFamily: "inherit",
            minHeight: 44,
          }}
        />
      </div>
    </form>
  );
}
