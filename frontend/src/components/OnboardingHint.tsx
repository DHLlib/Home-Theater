import { useState } from "react";

interface OnboardingHintProps {
  storageKey: string;
  children: React.ReactNode;
}

/**
 * 一次性上下文提示条。
 * 用户关闭后写入 localStorage，不再重复显示。
 */
export default function OnboardingHint({
  storageKey,
  children,
}: OnboardingHintProps) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(`hint:${storageKey}`) === "dismissed";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(`hint:${storageKey}`, "dismissed");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      style={{
        padding: "8px 12px",
        background: "var(--glass-bg)",
        border: "1px solid var(--glass-border)",
        borderRadius: 4,
        fontSize: 12,
        color: "var(--text-secondary)",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        backdropFilter: "blur(12px)",
      }}
    >
      <span style={{ lineHeight: 1.5 }}>{children}</span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="不再提示"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          fontSize: 16,
          lineHeight: 1,
          padding: "0 2px",
          cursor: "pointer",
          flexShrink: 0,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
      >
        ×
      </button>
    </div>
  );
}
