import { useEffect, useRef, useState } from "react";

interface AddSiteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string, base_url: string) => void;
}

export default function AddSiteDialog({
  open,
  onClose,
  onConfirm,
}: AddSiteDialogProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUrl("");
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;
    onConfirm(trimmedName, trimmedUrl);
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
          maxWidth: 420,
          borderRadius: 12,
          border: "1px solid var(--glass-border-bright)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          padding: "24px",
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

        <h3
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          添加采集站
        </h3>

        <form onSubmit={handleSubmit} className="col" style={{ gap: 16, marginTop: 20 }}>
          <div className="col" style={{ gap: 6 }}>
            <label
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                fontWeight: 500,
              }}
            >
              站点名称
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：非凡资源"
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid var(--glass-border)",
                background: "var(--bg)",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>

          <div className="col" style={{ gap: 6 }}>
            <label
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                fontWeight: 500,
              }}
            >
              站点地址
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="例如 http://xxx/api.php/provide/vod"
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid var(--glass-border)",
                background: "var(--bg)",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{ minHeight: 38, fontSize: 13 }}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || !url.trim()}
              style={{ minHeight: 38, fontSize: 13 }}
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
