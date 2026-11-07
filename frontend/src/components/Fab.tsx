interface FabProps {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  bottom?: string;
}

export default function Fab({
  children,
  onClick,
  ariaLabel,
  bottom = "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + 16px)",
}: FabProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        position: "fixed",
        right: 16,
        bottom,
        zIndex: 90,
        width: 52,
        height: 52,
        borderRadius: "50%",
        background: "#232326",
        color: "var(--text-primary)",
        border: "1px solid var(--border-bright)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
