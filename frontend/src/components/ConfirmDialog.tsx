import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

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
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        style={{
          width: "100%",
          maxWidth: 380,
          borderRadius: 12,
          border: "1px solid var(--glass-border-bright)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          padding: "24px",
          animation: "confirmDialogIn 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes confirmDialogIn {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        <h3
          id="confirm-title"
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h3>

        <div
          id="confirm-message"
          style={{
            marginTop: 10,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          {message}
        </div>

        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
          }}
        >
          <button className="btn" onClick={onCancel} style={{ minHeight: 38, fontSize: 13 }}>
            {cancelText}
          </button>
          <button
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            style={{ minHeight: 38, fontSize: 13 }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
