import { useState } from "react";
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
 *   - 「确定」按钮在用户未点击源前必须 disabled
 *   - 用户没有点选源就不能触发 onConfirm
 */
export default function SourcePicker(props: SourcePickerProps) {
  const { sources, open, title, onCancel, onConfirm, formatSubtitle } = props;
  const [picked, setPicked] = useState<SourceRef | null>(null);
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
        <li style={{ opacity: 0.7, padding: 12 }}>无可用源</li>
      )}
      {sources.map((s) => {
        const key = `${s.site_id}-${s.original_id}`;
        const isPicked =
          picked != null &&
          picked.site_id === s.site_id &&
          picked.original_id === s.original_id;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => setPicked(s)}
              className="btn"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                margin: "4px 0",
                border: isPicked
                  ? "1px solid var(--primary)"
                  : "1px solid var(--glass-border)",
                background: isPicked
                  ? "var(--primary-dim)"
                  : "transparent",
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
                  style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}
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
    <div
      style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
    >
      <button type="button" className="btn" onClick={onCancel}>
        取消
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={picked == null}
        onClick={() => picked && onConfirm(picked)}
        title={picked == null ? "请先选择一个源" : undefined}
      >
        确定
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet open={open} title={pickerTitle} onClose={onCancel}>
        <p style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
          每个源由不同采集站提供，请显式点选一个再确认。
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
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          每个源由不同采集站提供，请显式点选一个再确认。
        </p>
        {sourceList}
        {actionButtons}
      </div>
    </div>
  );
}
