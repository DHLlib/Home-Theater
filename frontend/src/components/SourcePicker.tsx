import BottomSheet from "./BottomSheet";
import { useIsMobile } from "../hooks/useViewport";
import type { SourceRef } from "../types";

type SourcePickerProps = {
  sources: SourceRef[];
  open: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (source: SourceRef) => void;
  formatSubtitle?: (source: SourceRef) => string | undefined;
};

/**
 * 强制让用户显式选择视频源。
 * 硬契约：
 *   - 不允许默认选中
 *   - 点击源项立即触发 onConfirm，无需二次确认
 */
export default function SourcePicker(props: SourcePickerProps) {
  const { sources, open, title, onCancel, onConfirm, formatSubtitle } = props;
  const isMobile = useIsMobile();

  if (!open) return null;

  const pickerTitle = title ?? "请选择来源";

  const sourceList = (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: "12px 0",
        maxHeight: "50vh",
        overflowY: "auto",
      }}
    >
      {sources.length === 0 && (
        <li style={{ color: "var(--text-secondary)", padding: 12 }}>无可用源</li>
      )}
      {sources.map((s) => {
        const key = `${s.site_id}-${s.original_id}`;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onConfirm(s)}
              className="btn"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                margin: "4px 0",
                border: "1px solid var(--glass-border)",
                background: "transparent",
                borderRadius: 4,
                color: "inherit",
                cursor: "pointer",
                minHeight: 48,
              }}
            >
              <div style={{ fontWeight: 500 }}>
                {s.site_name || `站点 #${s.site_id}`} · 原始 ID {s.original_id}
              </div>
              {formatSubtitle && (
                <div
                  style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}
                >
                  {formatSubtitle(s)}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const actionButtons = (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <button type="button" className="btn" onClick={onCancel}>
        取消
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet open={open} title={pickerTitle} onClose={onCancel}>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          每个源由不同采集站提供，请显式点选一个。
        </p>
        {sourceList}
        {actionButtons}
      </BottomSheet>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          padding: 20,
          borderRadius: 4,
          width: "min(420px, 92vw)",
          border: "1px solid var(--glass-border)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>{pickerTitle}</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          每个源由不同采集站提供，请显式点选一个再确认。
        </p>
        {sourceList}
        {actionButtons}
      </div>
    </div>
  );
}
