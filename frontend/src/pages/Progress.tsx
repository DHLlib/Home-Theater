import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRecent, clearRecent } from "../api/progress";
import ConfirmDialog from "../components/ConfirmDialog";
import type { PlayProgress } from "../types";

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relativeDateLabel(iso: string | null | undefined): string {
  if (!iso) return "更早";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return "本周";
  if (diffDays < 30) return "本月";
  return "更早";
}

function groupByDate(items: PlayProgress[]): Record<string, PlayProgress[]> {
  const groups: Record<string, PlayProgress[]> = {};
  const order: string[] = [];
  items.forEach((item) => {
    const label = relativeDateLabel(item.updated_at);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(item);
  });
  // preserve original order of first appearance
  const sorted: Record<string, PlayProgress[]> = {};
  order.forEach((label) => {
    sorted[label] = groups[label];
  });
  return sorted;
}

const GROUP_ORDER = ["今天", "昨天", "本周", "本月", "更早"];

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function ClockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function HistoryIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 16" />
    </svg>
  );
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function ProgressCard({ item, index }: { item: PlayProgress; index: number }) {
  const navigate = useNavigate();
  const pct = item.duration_seconds && item.duration_seconds > 0
    ? Math.min(100, Math.round((item.position_seconds / item.duration_seconds) * 100))
    : 0;

  const handleActivate = () => {
    navigate(
      `/player?site_id=${item.source_site_id}&original_id=${encodeURIComponent(
        item.source_video_id
      )}&ep=${item.episode_index}`
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`继续播放 ${item.title} ${item.episode_name}`}
      className="progress-card card-progress"
      style={{
        animation: `fadeInUp 0.5s ease both`,
        animationDelay: `${index * 60}ms`,
      }}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      <div className="card-shine" />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.title}
          >
            {item.title}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span>{item.episode_name}</span>
            {item.year && <span style={{ color: "var(--text-muted)" }}>· {item.year}</span>}
          </div>
        </div>

        <div className="play-badge">
          <PlayIcon size={18} />
        </div>
      </div>

      <div>
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: 2,
              background: "var(--primary)",
              boxShadow: "0 0 8px var(--primary-glow)",
              transition: "width 0.6s ease",
            }}
          />
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--text-muted)",
            fontFamily: "monospace",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ClockIcon size={12} />
            {formatTime(item.position_seconds)} / {item.duration_seconds ? formatTime(item.duration_seconds) : "-"}
          </span>
          <span>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

export default function Progress() {
  const [items, setItems] = useState<PlayProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  useEffect(() => {
    setLoading(true);
    listRecent()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const handleClear = () => {
    setShowClearDialog(false);
    setClearing(true);
    clearRecent()
      .then(() => setItems([]))
      .catch(() => alert("清空失败"))
      .finally(() => setClearing(false));
  };

  const groups = useMemo(() => groupByDate(items), [items]);
  const sortedLabels = useMemo(() => {
    return Object.keys(groups).sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  }, [groups]);

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: "-16px",
        padding: "32px 24px 48px",
      }}
    >
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          marginBottom: 28,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.02em",
            }}
          >
            最近播放
          </h1>
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)" }}>
            {loading ? "加载中..." : items.length > 0 ? `共 ${items.length} 条播放记录` : "暂无播放记录"}
          </div>
        </div>

        {!loading && items.length > 0 && (
          <button
            className="btn btn-danger"
            onClick={() => setShowClearDialog(true)}
            disabled={clearing}
            style={{ fontSize: 12, gap: 6 }}
          >
            <TrashIcon size={14} />
            {clearing ? "清空中..." : "清空记录"}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showClearDialog}
        title="清空最近播放"
        message="确定要清空所有最近播放记录吗？此操作不可恢复。"
        confirmText="清空"
        cancelText="取消"
        danger
        onConfirm={handleClear}
        onCancel={() => setShowClearDialog(false)}
      />

      {/* Content */}
      {loading ? (
        <div className="col" style={{ gap: 16 }}>
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{
                height: 120,
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
              }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "64px 24px",
            color: "var(--text-secondary)",
            textAlign: "center",
          }}
        >
          <HistoryIcon size={56} />
          <div style={{ marginTop: 16, fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>
            暂无播放记录
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)", maxWidth: 320 }}>
            看过的影片会出现在这里，点击即可从上次进度继续播放
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 32 }}>
          {sortedLabels.map((label) => (
            <section key={label}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 18,
                    borderRadius: 2,
                    background: "var(--primary)",
                    boxShadow: "0 0 8px var(--primary-glow)",
                  }}
                />
                <h2
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </h2>
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  {groups[label].length}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: 16,
                }}
              >
                {groups[label].map((item, idx) => (
                  <ProgressCard key={item.id} item={item} index={idx} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
