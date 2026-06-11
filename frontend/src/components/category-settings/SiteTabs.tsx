import React from "react";
import type { Site } from "../../types";

interface SiteTabsProps {
  sites: Site[];
  activeSiteId: number | null;
  onChange: (siteId: number) => void;
}

const SiteTabs = React.memo(function SiteTabs({
  sites,
  activeSiteId,
  onChange,
}: SiteTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        overflowX: "auto",
        padding: "4px 0",
        borderBottom: "1px solid var(--glass-border)",
      }}
    >
      {sites.map((site) => {
        const isActive = site.id === activeSiteId;
        return (
          <button
            key={site.id}
            onClick={() => onChange(site.id)}
            style={{
              padding: "8px 16px",
              borderRadius: "6px 6px 0 0",
              border: "1px solid var(--glass-border)",
              borderBottom: isActive
                ? "1px solid var(--bg)"
                : "1px solid var(--glass-border)",
              background: isActive ? "var(--bg)" : "rgba(255,255,255,0.03)",
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
              marginBottom: -1,
              transition: "color 150ms ease, background-color 150ms ease",
            }}
          >
            {site.name}
          </button>
        );
      })}
    </div>
  );
});

export default SiteTabs;
