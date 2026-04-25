import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listFavorites, removeFavorite } from "../api/favorites";
import type { Favorite } from "../types";

export default function Favorites() {
  const [items, setItems] = useState<Favorite[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    listFavorites().then(setItems);
  }, []);

  return (
    <div>
      <h2>我的收藏</h2>
      <div className="grid" style={{ marginTop: 12 }}>
        {items.map((f) => (
          <div
            key={f.id}
            style={{ cursor: "pointer", position: "relative" }}
            onClick={() =>
              navigate("/detail", {
                state: {
                  title: f.title,
                  year: f.year,
                  poster_url: f.poster_url,
                  sources: [],
                },
              })
            }
          >
            <div
              style={{
                aspectRatio: "2/3",
                background: "var(--card)",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--border)",
              }}
            >
              {f.poster_url ? (
                <img
                  src={f.poster_url}
                  alt={f.title}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div className="empty" style={{ height: "100%" }}>
                  无封面
                </div>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 14 }}>{f.title}</div>
            {f.year && (
              <div style={{ fontSize: 12, opacity: 0.7 }}>{f.year}</div>
            )}
            <button
              className="btn"
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                padding: "4px 8px",
                fontSize: 12,
              }}
              onClick={(e) => {
                e.stopPropagation();
                removeFavorite(f.id).then(() =>
                  setItems((prev) => prev.filter((x) => x.id !== f.id))
                );
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <div className="empty">暂无收藏</div>
      )}
    </div>
  );
}
