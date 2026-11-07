import { createPortal } from "react-dom";
import BottomSheet from "./BottomSheet";
import { useIsMobile } from "../hooks/useViewport";
import type { SourceRef } from "../types";
import "./SourcePicker.css";

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
    <ul className="sp-list">
      {sources.length === 0 && <li className="sp-empty">无可用源</li>}
      {sources.map((s) => {
        const key = `${s.site_id}-${s.original_id}`;
        const subtitle = formatSubtitle?.(s);
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onConfirm(s)}
              className="sp-item"
            >
              <span className="sp-item-name">
                {s.site_name || `站点 #${s.site_id}`}
              </span>
              {subtitle && (
                <span className="sp-item-meta tnum">{subtitle}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (isMobile) {
    return (
      <BottomSheet open={open} title={pickerTitle} onClose={onCancel}>
        <p className="sp-hint">每个源由不同采集站提供，点一个即可开始。</p>
        {sourceList}
      </BottomSheet>
    );
  }

  // 通过 Portal 挂到 body：弹窗/抽屉内部有 backdrop-filter 与 overflow，
  // 直接渲染会把「选源」这一强制步骤压在详情弹窗的层叠上下文里。
  return createPortal(
    <div
      className="sp-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={pickerTitle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="sp-dialog">
        <h3 className="sp-title">{pickerTitle}</h3>
        <p className="sp-hint">每个源由不同采集站提供，请显式点选一个再确认。</p>
        {sourceList}
        <div className="sp-actions">
          <button type="button" className="dc-btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
