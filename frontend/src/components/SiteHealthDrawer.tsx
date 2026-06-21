import { useEffect, useState } from "react";
import { getSiteHealth, probeSite, updateSite } from "../api/sites";
import type { Site, SiteHealth, SiteProbeLogEntry } from "../types";

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ActivityIcon({ size = 14 }: { size?: number }) {
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
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number | null) {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface SiteHealthDrawerProps {
  site: Site | null;
  open: boolean;
  onClose: () => void;
  onSiteChange?: (site: Site) => void;
}

export default function SiteHealthDrawer({
  site,
  open,
  onClose,
  onSiteChange,
}: SiteHealthDrawerProps) {
  const [health, setHealth] = useState<SiteHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !site) return;
    setLoading(true);
    setError(null);
    getSiteHealth(site.id)
      .then(setHealth)
      .catch((err) => setError(err?.message || "加载健康状态失败"))
      .finally(() => setLoading(false));
  }, [open, site]);

  const handleProbe = () => {
    if (!site) return;
    setProbing(true);
    probeSite(site.id)
      .then(() => {
        setLoading(true);
        return getSiteHealth(site.id).then(setHealth);
      })
      .catch(() => setError("探测失败"))
      .finally(() => {
        setProbing(false);
        setLoading(false);
      });
  };

  const toggleSite = () => {
    if (!site) return;
    const nextEnabled = !site.enabled;
    updateSite(site.id, { enabled: nextEnabled }).then(() => {
      onSiteChange?.({ ...site, enabled: nextEnabled });
      setLoading(true);
      getSiteHealth(site.id)
        .then(setHealth)
        .finally(() => setLoading(false));
    });
  };

  if (!open || !site) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 520,
          height: "100%",
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--glass-border)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          animation: "siteHealthDrawerIn 0.25s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{
          `
          @keyframes siteHealthDrawerIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `
        }</style>

        {/* 头部 */}
        <div
          className="row"
          style={{
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: "1px solid var(--glass-border)",
          }}
        >
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div
              className="row"
              style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {site.name}
              </h3>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: site.enabled
                    ? "rgba(74,222,128,0.12)"
                    : "var(--glass-border)",
                  color: site.enabled ? "var(--success)" : "var(--text-secondary)",
                  flexShrink: 0,
                }}
              >
                {site.enabled ? "已启用" : "已禁用"}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={site.base_url}
            >
              {site.base_url}
            </div>
          </div>
          <button
            className="btn"
            onClick={onClose}
            style={{ padding: "8px 12px", flexShrink: 0 }}
            aria-label="关闭"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div
          className="col"
          style={{
            flex: 1,
            gap: 16,
            padding: "20px 24px",
            overflowY: "auto",
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              onClick={handleProbe}
              disabled={probing || loading}
              style={{ gap: 4, fontSize: 13, flex: 1 }}
            >
              <ActivityIcon size={12} />
              {probing ? "探测中..." : "立即探测"}
            </button>
            <button
              className="btn"
              onClick={toggleSite}
              disabled={loading}
              style={{ fontSize: 13, flex: 1 }}
            >
              {site.enabled ? "禁用站点" : "启用站点"}
            </button>
          </div>

          {loading ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
                fontSize: 14,
              }}
            >
              加载中...
            </div>
          ) : error ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--danger)",
                fontSize: 14,
              }}
            >
              {error}
            </div>
          ) : health ? (
            <>
              <div
                className="row"
                style={{ gap: 10, flexWrap: "wrap" }}
              >
                <MetricCard
                  label="最新探测"
                  value={
                    health.latest_probe
                      ? health.latest_probe.ok
                        ? "正常"
                        : "异常"
                      : "无记录"
                  }
                  sub={
                    health.latest_probe
                      ? health.latest_probe.ok
                        ? formatDuration(health.latest_probe.latency_ms)
                        : health.latest_probe.error || "请求失败"
                      : "尚未执行探测"
                  }
                  tone={
                    health.latest_probe
                      ? health.latest_probe.ok
                        ? "success"
                        : "danger"
                      : "muted"
                  }
                />
                <MetricCard
                  label="24h 可用率"
                  value={`${health.availability_24h}%`}
                  sub="过去 24 小时成功探测占比"
                  tone={
                    health.availability_24h >= 95
                      ? "success"
                      : health.availability_24h >= 80
                      ? "warning"
                      : "danger"
                  }
                />
              </div>

              {!site.enabled && health.auto_disabled_at && (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 6,
                    background: "rgba(251,191,36,0.08)",
                    border: "1px solid rgba(251,191,36,0.2)",
                    fontSize: 12,
                    color: "var(--warning)",
                  }}
                >
                  自动禁用于 {formatDateTime(health.auto_disabled_at)}
                </div>
              )}

              <div className="col" style={{ gap: 10 }}>
                <div
                  className="row"
                  style={{
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>探测历史</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    最近 {health.recent_logs.length} 条
                  </span>
                </div>

                {health.recent_logs.length === 0 ? (
                  <div
                    style={{
                      padding: 32,
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8,
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      textAlign: "center",
                    }}
                  >
                    <ActivityIcon size={32} />
                    <p style={{ marginTop: 8 }}>暂无探测记录</p>
                  </div>
                ) : (
                  <div className="col" style={{ gap: 8 }}>
                    {health.recent_logs.map((log) => (
                      <LogRow key={log.id} log={log} />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const toneColor =
    tone === "success"
      ? "var(--success)"
      : tone === "warning"
      ? "var(--warning)"
      : tone === "danger"
      ? "var(--danger)"
      : "var(--text-secondary)";
  return (
    <div
      style={{
        flex: 1,
        minWidth: 160,
        padding: 16,
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--glass-border)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: toneColor,
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={sub}
      >
        {sub}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: SiteProbeLogEntry }) {
  return (
    <div
      className="row"
      style={{
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.03)",
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: log.ok
            ? "rgba(74,222,128,0.12)"
            : "rgba(251,113,133,0.12)",
          color: log.ok ? "var(--success)" : "var(--danger)",
          flexShrink: 0,
        }}
      >
        {log.ok ? <CheckIcon size={10} /> : <XIcon size={10} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="row"
          style={{
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 500 }}>
            {log.ok ? "探测成功" : "探测失败"}
          </span>
          {log.latency_ms !== undefined && log.latency_ms !== null && (
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {log.latency_ms}ms
            </span>
          )}
          {log.error && (
            <span
              style={{
                fontSize: 12,
                color: "var(--danger)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
              title={log.error}
            >
              {log.error}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {formatDateTime(log.created_at)}
        </div>
      </div>
    </div>
  );
}
