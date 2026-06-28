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
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "var(--primary)",
        color: "#000",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
