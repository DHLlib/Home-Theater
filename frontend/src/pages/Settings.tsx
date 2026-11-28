import { Navigate, useSearchParams } from "react-router-dom";
import CategorySettings from "../components/category-settings/CategorySettings";
import DownloadSettings from "../components/DownloadSettings";

function FolderIcon({ size = 16 }: { size?: number }) {
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
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TagIcon({ size = 16 }: { size?: number }) {
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
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

type TabKey = "categories" | "download";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "categories", label: "分类设置", icon: <TagIcon size={14} /> },
  { key: "download", label: "下载设置", icon: <FolderIcon size={14} /> },
];

export default function Settings() {
  // 当前 tab 由 URL 决定（?tab=categories / ?tab=download），便于分享与深链
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab");
  // 采集站与运维任务已迁到 /ops：旧深链直接重定向
  if (tabParam === "sites" || tabParam === "logs") {
    return <Navigate to="/ops" replace />;
  }

  const isMobileView =
    typeof window !== "undefined" &&
    (window.innerWidth < 768 ||
      /Mobi|Android|iPhone/i.test(navigator.userAgent));
  const activeTab: TabKey = tabParam === "download" ? "download" : "categories";
  const setActiveTab = (key: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="col settings-form" style={{ gap: 20 }}>
      {/* Tab 菜单 */}
      <div
        className="row settings-tab-bar"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--glass-border)",
          borderRadius: 10,
          padding: 6,
          gap: 4,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              data-tab={tab.key}
              type="button"
              className={active ? "btn btn-primary" : "btn"}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                justifyContent: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                minHeight: 40,
              }}
            >
              {tab.icon}
              <span className="tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "categories" &&
        (isMobileView ? (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.8,
              color: "var(--text-secondary)",
            }}
          >
            分类映射只在桌面端配置。移动端会直接使用已配置好的分类，不需要在这里操作。
          </div>
        ) : (
          <CategorySettings />
        ))}

      {/* 下载设置 */}
      {activeTab === "download" && <DownloadSettings />}
    </div>
  );
}
