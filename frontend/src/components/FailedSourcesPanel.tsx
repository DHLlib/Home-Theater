import { useState } from "react";
import { probeSite } from "../api/sites";
import type { FailedSource } from "../types";

interface FailedSourcesPanelProps {
  failed: FailedSource[];
  onChange?: () => void;
}

function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ChevronUp({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDown({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

export default function FailedSourcesPanel({
  failed,
  onChange,
}: FailedSourcesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [retrying, setRetrying] = useState<Set<number>>(new Set());

  const visible = failed.filter((f) => f.site_id != null && !ignored.has(f.site_id));

  if (visible.length === 0) return null;

  const handleRetry = async (siteId: number) => {
    setRetrying((prev) => new Set(prev).add(siteId));
    try {
      await probeSite(siteId);
    } catch {
      // 静默失败
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(siteId);
        return next;
      });
      onChange?.();
    }
  };

  const handleIgnore = (siteId: number) => {
    setIgnored((prev) => new Set(prev).add(siteId));
  };

  const handleIgnoreAll = () => {
    setIgnored(new Set(visible.map((f) => f.site_id!)));
  };

  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 8,
        marginBottom: 12,
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* 紧凑提示条 */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          padding: "10px 14px",
          cursor: "pointer",
          userSelect: "none",
          minHeight: 44,
        }}
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        aria-label={`${visible.length} 个源加载失败，点击查看详情`}
      >
        <div
          className="row"
          style={{ gap: 6, fontSize: 13, color: "var(--warning)", fontWeight: 500 }}
        >
          <WarningIcon size={14} />
          <span>{visible.length} 个源加载失败</span>
        </div>
        <div
          className="row"
          style={{ gap: 4, fontSize: 12, color: "var(--text-secondary)" }}
        >
          {expanded ? (
            <>
              收起 <ChevronUp size={12} />
            </>
          ) : (
            <>
              查看详情 <ChevronDown size={12} />
            </>
          )}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {visible.map((f) => (
            <div
              key={f.site_id}
              className="row"
              style={{
                justifyContent: "space-between",
                padding: "10px 14px",
                fontSize: 12,
                gap: 8,
                flexWrap: "wrap",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
                  {f.site_name || `站点 ${f.site_id}`}
                </div>
                <div
                  style={{
                    color: "var(--danger)",
                    opacity: 0.9,
                    wordBreak: "break-all",
                    lineHeight: 1.5,
                  }}
                >
                  {f.error}
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <button
                  className="btn"
                  style={{
                    fontSize: 12,
                    padding: "4px 12px",
                    minHeight: 32,
                  }}
                  disabled={retrying.has(f.site_id!)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRetry(f.site_id!);
                  }}
                  aria-label={`重试 ${f.site_name || `站点 ${f.site_id}`}`}
                >
                  {retrying.has(f.site_id!) ? (
                    <span className="row" style={{ gap: 4 }}>
                      <Spinner size={12} />
                      探测中
                    </span>
                  ) : (
                    "重试"
                  )}
                </button>
                <button
                  className="btn"
                  style={{
                    fontSize: 12,
                    padding: "4px 12px",
                    minHeight: 32,
                    opacity: 0.6,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleIgnore(f.site_id!);
                  }}
                  aria-label={`忽略 ${f.site_name || `站点 ${f.site_id}`}`}
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
          <div
            style={{
              padding: "8px 14px",
              textAlign: "right",
            }}
          >
            <button
              className="btn"
              style={{ fontSize: 12, padding: "4px 12px", minHeight: 32, opacity: 0.5 }}
              onClick={(e) => {
                e.stopPropagation();
                handleIgnoreAll();
              }}
            >
              忽略全部
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
