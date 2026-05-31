import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRecent } from "../api/progress";
import type { PlayProgress } from "../types";

export default function Progress() {
  const [items, setItems] = useState<PlayProgress[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    listRecent().then(setItems);
  }, []);

  return (
    <div>
      <h2>最近播放</h2>
      <div className="col" style={{ marginTop: 12 }}>
        {items.map((p) => (
          <div
            key={p.id}
            className="list-item-card"
            role="button"
            tabIndex={0}
            aria-label={`继续播放 ${p.title} ${p.episode_name}`}
            style={{
              padding: "14px 12px",
              background: "var(--card)",
              borderRadius: 8,
              cursor: "pointer",
              border: "1px solid var(--border)",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
            onClick={() =>
              navigate(
                `/player?site_id=${p.source_site_id}&original_id=${encodeURIComponent(
                  p.source_video_id
                )}&ep=${p.episode_index}`
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(
                  `/player?site_id=${p.source_site_id}&original_id=${encodeURIComponent(
                    p.source_video_id
                  )}&ep=${p.episode_index}`
                );
              }
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{p.title}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {p.episode_name} · {formatTime(p.position_seconds)} /{" "}
                {p.duration_seconds ? formatTime(p.duration_seconds) : "-"}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="empty">暂无播放记录</div>
        )}
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
