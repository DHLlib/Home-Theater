import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listFavorites, removeFavorite } from "../api/favorites";
import ConfirmDialog from "../components/ConfirmDialog";
import type { Favorite } from "../types";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function FilmReelIcon({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="17" cy="8" r="1.5" />
      <circle cx="17" cy="14" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
      <circle cx="7" cy="14" r="1.5" />
      <circle cx="7" cy="8" r="1.5" />
    </svg>
  );
}

function ArchiveCard({
  item,
  index,
  onRemove,
}: {
  item: Favorite;
  index: number;
  onRemove: (id: number) => void;
}) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    navigate("/detail", {
      state: {
        title: item.title,
        year: item.year,
        poster_url: item.poster_url,
        sources: item.sources || [],
      },
    });
  };

  const handleRemove = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onRemove(item.id);
  };

  return (
    <article
      className="archive-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`打开 ${item.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{
        marginBottom: 24,
        position: "relative",
        borderRadius: 6,
        border: "1px solid var(--glass-border)",
        background: "var(--bg-elevated)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "all var(--transition-slow)",
        animation: `archiveReveal 0.7s cubic-bezier(0.22, 1, 0.36, 1) both`,
        animationDelay: `${index * 70}ms`,
      }}
    >
      <div className="perf perf-left" aria-hidden="true" />
      <div className="perf perf-right" aria-hidden="true" />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: hovered ? "var(--primary)" : "transparent",
          boxShadow: hovered ? "0 0 12px var(--primary-glow)" : "none",
          transition: "all var(--transition-base)",
          zIndex: 2,
        }}
      />

      <button
        className="btn"
        onClick={handleRemove}
        aria-label={`取消收藏 ${item.title}`}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 3,
          width: 32,
          height: 32,
          minHeight: 32,
          padding: 0,
          borderRadius: "50%",
          opacity: 1,
          transform: "scale(1)",
          transition: "all var(--transition-fast)",
          background: "rgba(0,0,0,0.75)",
          borderColor: "var(--glass-border-bright)",
          color: "var(--text-secondary)",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ×
      </button>

      <div
        style={{
          position: "relative",
          aspectRatio: "2 / 3",
          overflow: "hidden",
          background: "rgba(0,0,0,0.3)",
        }}
      >
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt={item.title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transition: "transform var(--transition-slow)",
              transform: hovered ? "scale(1.05)" : "scale(1)",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: 12,
              textAlign: "center",
              padding: 16,
            }}
          >
            无封面
          </div>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
            pointerEvents: "none",
          }}
        />
      </div>

      <div
        style={{
          padding: "16px 18px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.35,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
            title={item.title}
          >
            {item.title}
          </h3>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            {item.year ? <span>{item.year}</span> : null}
            <span style={{ color: "var(--text-muted)" }}>
              {item.sources?.length || 0} 个来源
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 12,
            borderTop: "1px solid var(--glass-border)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "monospace",
              letterSpacing: "0.04em",
            }}
          >
            归档 {formatDate(item.created_at)}
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--primary)",
              opacity: 0.6,
            }}
          />
        </div>
      </div>
    </article>
  );
}

export default function Favorites() {
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setLoading(true);
    listFavorites()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [items]);

  const activeItem = useMemo(
    () => items.find((x) => x.id === removingId),
    [items, removingId]
  );

  const handleRemoveRequest = (id: number) => {
    setRemovingId(id);
    setShowDeleteDialog(true);
  };

  const handleConfirmRemove = () => {
    if (removingId == null) return;
    setShowDeleteDialog(false);
    removeFavorite(removingId)
      .then(() => {
        setItems((prev) => prev.filter((x) => x.id !== removingId));
      })
      .catch(() => alert("删除失败"))
      .finally(() => setRemovingId(null));
  };

  const handleCancelRemove = () => {
    setShowDeleteDialog(false);
    setRemovingId(null);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: "-16px",
        padding: "32px 24px 48px",
      }}
    >
      <style>{`
        @keyframes archiveReveal {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .archive-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);
        }
        .perf {
          position: absolute;
          top: 18px;
          bottom: 18px;
          width: 10px;
          z-index: 1;
          pointer-events: none;
          background-image: radial-gradient(
            circle at center,
            rgba(0,0,0,0.85) 0px,
            rgba(0,0,0,0.85) 2px,
            rgba(255,255,255,0.12) 2.5px,
            rgba(255,255,255,0.12) 4px,
            transparent 4.5px
          );
          background-size: 10px 14px;
          opacity: 0.6;
        }
        .perf-left { left: 4px; }
        .perf-right { right: 4px; }
        .archive-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }
        @media (max-width: 767px) {
          .archive-grid {
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 12px;
          }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .archive-grid {
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
          }
        }
      `}</style>

      <header
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
            className="font-display"
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.04em",
            }}
          >
            我的珍藏
          </h1>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            {loading
              ? "加载中..."
              : items.length > 0
              ? `共收录 ${items.length} 部影片`
              : "暂无珍藏"}
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={showDeleteDialog}
        title="移出珍藏"
        message={
          <>
            确定要将
            <strong style={{ color: "var(--text-primary)" }}>
              「{activeItem?.title || ""}」
            </strong>
            从珍藏室移除吗？
          </>
        }
        confirmText="移除"
        cancelText="保留"
        danger
        onConfirm={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />

      {loading ? (
        <div className="archive-grid">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{
                aspectRatio: "2 / 3",
                marginBottom: 24,
                borderRadius: 6,
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
            padding: "72px 24px",
            color: "var(--text-secondary)",
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--text-muted)", animation: "breathe-rotate 8s linear infinite" }}>
            <FilmReelIcon size={72} />
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 16,
              fontWeight: 500,
              color: "var(--text-primary)",
            }}
          >
            珍藏室还是空的
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-muted)",
              maxWidth: 320,
            }}
          >
            遇到喜欢的影片，点击收藏即可收录于此
          </div>
        </div>
      ) : (
        <div className="archive-grid">
          {sortedItems.map((item, idx) => (
            <ArchiveCard
              key={item.id}
              item={item}
              index={idx}
              onRemove={handleRemoveRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}
