import { useEffect, useRef, useState } from "react";
import { batchProbe } from "../api/sites";
import { MAX_BATCH_SNIFF, parseBatchSites } from "../utils/batchSniff";
import type { BatchProbeResult } from "../types";

interface BatchSniffDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export default function BatchSniffDialog({
  open,
  onClose,
  onAdded,
}: BatchSniffDialogProps) {
  const [batchJson, setBatchJson] = useState("");
  const [batchResults, setBatchResults] = useState<BatchProbeResult[] | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setBatchJson("");
      setBatchResults(null);
      setBatchLoading(false);
      setSkippedCount(0);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleProbe = () => {
    let parsed;
    try {
      parsed = parseBatchSites(batchJson);
    } catch (e) {
      alert(e instanceof Error ? e.message : "解析失败");
      return;
    }
    setBatchLoading(true);
    setBatchResults(null);
    setSkippedCount(parsed.skipped);
    batchProbe(parsed.items)
      .then((r) => {
        setBatchResults(r.results);
        if (onAdded && r.results.some((x) => x.added)) {
          onAdded();
        }
      })
      .catch((err) => {
        alert("探测失败: " + (err?.message || "未知错误"));
      })
      .finally(() => setBatchLoading(false));
  };

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--glass-border)",
    background: "var(--bg)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
    resize: "vertical",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "80vh",
          borderRadius: 12,
          border: "1px solid var(--glass-border-bright)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "confirmDialogIn 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{
          `
          @keyframes confirmDialogIn {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `
        }</style>

        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--glass-border)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            批量嗅探站点
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            支持 TVBox 配置（api_site 对象）或 [{"{"}name,url{"}"}] 数组，最多{" "}
            {MAX_BATCH_SNIFF} 条；探测成功会自动添加并立即触发全量刮削
          </p>
        </div>

        <div
          className="col"
          style={{
            gap: 12,
            padding: "20px 24px",
            overflowY: "auto",
            flex: 1,
          }}
        >
          <textarea
            ref={textareaRef}
            value={batchJson}
            onChange={(e) => setBatchJson(e.target.value)}
            placeholder={`{\n  "api_site": {\n    "example.com": {\n      "name": "示例站点",\n      "api": "https://example.com/api.php/provide/vod",\n      "detail": "https://example.com"\n    }\n  }\n}`}
            style={{ ...inputStyle, width: "100%", minHeight: 140 }}
          />

          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{ minHeight: 38, fontSize: 13 }}
            >
              关闭
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleProbe}
              disabled={batchLoading}
              style={{ minHeight: 38, fontSize: 13 }}
            >
              {batchLoading ? "嗅探中..." : "嗅探并添加"}
            </button>
          </div>

          {batchResults && (
            <div className="col" style={{ gap: 8, marginTop: 4 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                }}
              >
                嗅探结果
                {skippedCount > 0 ? `（已跳过 ${skippedCount} 条无效项）` : ""}
              </div>
              <div className="col" style={{ gap: 6 }}>
                {batchResults.map((r, i) => (
                  <div
                    key={i}
                    className="row"
                    style={{
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "var(--tint-soft)",
                      fontSize: 13,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>
                      {r.ok ? (
                        <span style={{ color: "var(--success)" }}>✓</span>
                      ) : (
                        <span style={{ color: "var(--danger)" }}>✗</span>
                      )}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={r.name}
                    >
                      {r.name}
                    </span>
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {r.ok
                        ? r.added
                          ? `已添加 ${r.latency_ms}ms`
                          : `已存在 ${r.latency_ms}ms`
                        : r.error}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
