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
      <div className="favorites-list" style={{ marginTop: 12 }}>
        {items.map((f) => (
          <div
            key={f.id}
            className="list-item-card"
            style={{
              cursor: "pointer",
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "10px 12px",
              background: "var(--card)",
              borderRadius: 8,
              border: "1px solid var(--border)",
              marginBottom: 8,
            }}
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
            {/* 海报缩略图 */}
            <div
              style={{
                width: 60,
                height: 90,
                flexShrink: 0,
                borderRadius: 4,
                overflow: "hidden",
                background: "var(--muted)",
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
                <div
                  className="empty"
                  style={{
                    height: "100%",
                    fontSize: 11,
                    padding: 4,
                  }}
                >
                  无封面
                </div>
              )}
            </div>

            {/* 信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{f.title}</div>
              {f.year && (
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.7,
                    marginTop: 4,
                  }}
                >
                  {f.year}
                </div>
              )}
            </div>

            {/* 删除按钮 */}
            <button
              className="btn"
              style={{
                padding: "8px 12px",
                fontSize: 12,
                minHeight: 44,
                minWidth: 44,
              }}
              aria-label={`取消收藏 ${f.title}`}
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
