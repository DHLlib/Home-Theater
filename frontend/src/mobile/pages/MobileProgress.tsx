import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRecent, deleteProgress } from "../../api/progress";
import ActionSheet from "../../components/ActionSheet";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useLongPress } from "../../hooks/useLongPress";
import { toastSuccess } from "../../utils/toast";
import type { PlayProgress } from "../../types";

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relativeDateLabel(iso: string | null | undefined): string {
  if (!iso) return "更早";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return "本周";
  if (diffDays < 30) return "本月";
  return "更早";
}

const GROUP_ORDER = ["今天", "昨天", "本周", "本月", "更早"];

function groupByDate(items: PlayProgress[]): Record<string, PlayProgress[]> {
  const groups: Record<string, PlayProgress[]> = {};
  const order: string[] = [];
  for (const item of items) {
    const label = relativeDateLabel(item.updated_at);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(item);
  }
  const sorted: Record<string, PlayProgress[]> = {};
  for (const label of order) sorted[label] = groups[label];
  return sorted;
}

function ProgressRow({
  item,
  onMenu,
}: {
  item: PlayProgress;
  onMenu: (id: number) => void;
}) {
  const navigate = useNavigate();
  const longPress = useLongPress({ onLongPress: () => onMenu(item.id) });

  const pct =
    item.duration_seconds && item.duration_seconds > 0
      ? Math.min(
          100,
          Math.round((item.position_seconds / item.duration_seconds) * 100)
        )
      : 0;

  const handleActivate = () => {
    const yearParam = item.year != null ? `&year=${item.year}` : "";
    navigate(
      `/player?site_id=${item.source_site_id}&original_id=${encodeURIComponent(
        item.source_video_id
      )}&ep=${item.episode_index}&title=${encodeURIComponent(
        item.title
      )}${yearParam}`
    );
  };

  return (
    <div
      className="mobile-list-item"
      onClick={handleActivate}
      {...longPress}
      style={{ touchAction: "manipulation", userSelect: "none" }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mobile-list-item-title" title={item.title}>
          {item.title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--text-secondary)",
            display: "flex",
            gap: 8,
          }}
        >
          <span>{item.episode_name}</span>
          {item.year && <span style={{ color: "var(--text-muted)" }}>· {item.year}</span>}
        </div>
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
            marginTop: 8,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: 2,
              background: "var(--primary)",
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--text-muted)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>
            {formatTime(item.position_seconds)} /{" "}
            {item.duration_seconds ? formatTime(item.duration_seconds) : "-"}
          </span>
          <span>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

export default function MobileProgress() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PlayProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setLoading(true);
    listRecent()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => groupByDate(items), [items]);
  const sortedLabels = useMemo(
    () => Object.keys(groups).sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)),
    [groups]
  );

  const menuItem = useMemo(
    () => items.find((x) => x.id === menuId),
    [items, menuId]
  );

  const handleDeleteOne = (id: number) => {
    deleteProgress(id)
      .then(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
        toastSuccess("已删除播放记录");
      })
      .catch(() => alert("删除失败"));
  };

  const handleClear = () => {
    setShowClearDialog(false);
    setClearing(true);
    import("../../api/progress")
      .then(({ clearRecent }) => clearRecent())
      .then(() => setItems([]))
      .catch(() => alert("清空失败"))
      .finally(() => setClearing(false));
  };

  return (
    <div className="mobile-page">
      <div className="mobile-page-header" style={{ justifyContent: "space-between" }}>
        <h1 className="mobile-page-title">播放记录</h1>
        {!loading && items.length > 0 && (
          <button
            className="btn btn-danger"
            style={{ fontSize: 12, padding: "6px 12px", minHeight: 32 }}
            onClick={() => setShowClearDialog(true)}
            disabled={clearing}
          >
            {clearing ? "清空中..." : "清空"}
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

      <ActionSheet
        open={menuId != null}
        title={menuItem ? `${menuItem.title} · ${menuItem.episode_name}` : undefined}
        actions={[
          {
            key: "resume",
            label: "继续播放",
            onClick: () => {
              if (!menuItem) return;
              const yearParam =
                menuItem.year != null ? `&year=${menuItem.year}` : "";
              navigate(
                `/player?site_id=${menuItem.source_site_id}&original_id=${encodeURIComponent(
                  menuItem.source_video_id
                )}&ep=${menuItem.episode_index}&title=${encodeURIComponent(
                  menuItem.title
                )}${yearParam}`
              );
            },
          },
          {
            key: "delete",
            label: "删除记录",
            danger: true,
            onClick: () => {
              if (menuId != null) handleDeleteOne(menuId);
            },
          },
        ]}
        onClose={() => setMenuId(null)}
      />

      {loading && (
        <div className="col" style={{ gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 80, borderRadius: 10 }} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="mobile-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 16" />
          </svg>
          <div className="mobile-empty-title">暂无播放记录</div>
          <p>看过的影片会出现在这里，点击即可从上次进度继续播放</p>
        </div>
      )}

      <div className="col" style={{ gap: 24 }}>
        {sortedLabels.map((label) => (
          <section key={label}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 4,
                  height: 16,
                  borderRadius: 2,
                  background: "var(--primary)",
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                {label}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {groups[label].length}
              </span>
            </div>
            <div className="col" style={{ gap: 8 }}>
              {groups[label].map((item) => (
                <ProgressRow key={item.id} item={item} onMenu={setMenuId} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
