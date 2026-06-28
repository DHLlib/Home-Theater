import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listFavorites, removeFavorite } from "../../api/favorites";
import ActionSheet from "../../components/ActionSheet";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useLongPress } from "../../hooks/useLongPress";
import type { Favorite } from "../../types";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function FavoriteCard({
  item,
  onMenu,
}: {
  item: Favorite;
  onMenu: (id: number) => void;
}) {
  const navigate = useNavigate();
  const longPress = useLongPress({ onLongPress: () => onMenu(item.id) });

  return (
    <div
      className="mobile-video-card"
      onClick={() =>
        navigate("/detail", {
          state: {
            title: item.title,
            year: item.year ?? null,
            poster_url: item.poster_url ?? null,
            sources: item.sources || [],
          },
        })
      }
      {...longPress}
      style={{ touchAction: "manipulation", userSelect: "none" }}
    >
      <div className="mobile-video-card-poster">
        {item.poster_url ? (
          <img src={item.poster_url} alt={item.title} loading="lazy" />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              fontSize: 12,
            }}
          >
            无封面
          </div>
        )}
      </div>
      <div className="mobile-video-card-info">
        <h3 className="mobile-video-card-title" title={item.title}>
          {item.title}
        </h3>
        <div className="mobile-video-card-meta">
          {item.year ? `${item.year} · ` : ""}
          {item.sources?.length || 0} 个来源
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
          收藏于 {formatDate(item.created_at)}
        </div>
      </div>
    </div>
  );
}

export default function MobileFavorites() {
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [showDialog, setShowDialog] = useState(false);

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

  const menuItem = useMemo(() => items.find((x) => x.id === menuId), [items, menuId]);

  const handleRemoveRequest = (id: number) => {
    setMenuId(null);
    setRemovingId(id);
    setShowDialog(true);
  };

  const handleConfirmRemove = () => {
    if (removingId == null) return;
    setShowDialog(false);
    removeFavorite(removingId)
      .then(() => {
        setItems((prev) => prev.filter((x) => x.id !== removingId));
      })
      .catch(() => alert("删除失败"))
      .finally(() => setRemovingId(null));
  };

  return (
    <div className="mobile-page">
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">我的收藏</h1>
      </div>

      <ConfirmDialog
        open={showDialog}
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
        onCancel={() => {
          setShowDialog(false);
          setRemovingId(null);
        }}
      />

      <ActionSheet
        open={menuId != null}
        title={menuItem?.title}
        actions={[
          {
            key: "remove",
            label: "移出珍藏",
            danger: true,
            onClick: () => {
              if (menuId != null) handleRemoveRequest(menuId);
            },
          },
        ]}
        onClose={() => setMenuId(null)}
      />

      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton" style={{ aspectRatio: "2/3", borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="mobile-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="17" cy="8" r="1.5" />
            <circle cx="17" cy="14" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
            <circle cx="7" cy="14" r="1.5" />
            <circle cx="7" cy="8" r="1.5" />
          </svg>
          <div className="mobile-empty-title">珍藏室还是空的</div>
          <p>遇到喜欢的影片，点击收藏即可收录于此</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {sortedItems.map((item) => (
          <FavoriteCard key={item.id} item={item} onMenu={setMenuId} />
        ))}
      </div>
    </div>
  );
}
