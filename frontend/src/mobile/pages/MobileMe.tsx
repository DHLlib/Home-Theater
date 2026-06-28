import { useNavigate } from "react-router-dom";
import { useTheme, applyTheme } from "../../lib/theme";

function ChevronRight({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function HistoryIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 16" />
    </svg>
  );
}

function SettingsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PaletteIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

interface MeItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}

function MeItem({ icon, label, onClick }: MeItemProps) {
  return (
    <button className="mobile-me-item" onClick={onClick}>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {icon}
        {label}
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

export default function MobileMe() {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const toggleTheme = () => {
    const next = theme === "cinema" ? "crimson" : "cinema";
    applyTheme(next);
  };

  return (
    <div className="mobile-page">
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">我的</h1>
      </div>

      <div className="mobile-me-grid">
        <MeItem
          icon={<HistoryIcon size={22} />}
          label="播放记录"
          onClick={() => navigate("/me/progress")}
        />
        <MeItem
          icon={<SettingsIcon size={22} />}
          label="设置"
          onClick={() => navigate("/me/settings")}
        />
        <MeItem
          icon={<PaletteIcon size={22} />}
          label={`主题：${theme === "cinema" ? "深黑影院" : "绯红"}`}
          onClick={toggleTheme}
        />
      </div>

      <div
        style={{
          marginTop: 32,
          textAlign: "center",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        Home Theater Mobile
      </div>
    </div>
  );
}
