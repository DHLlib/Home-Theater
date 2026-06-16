import { useEffect, useState } from "react";
import {
  getDownloadRoot,
  setDownloadRoot,
  getMaxConcurrentDownloads,
  setMaxConcurrentDownloads,
  getAdFilterEnabled,
  setAdFilterEnabled,
} from "../api/settings";
import { toastSuccess, toastError } from "../utils/toast";

function FolderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

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

function SlidersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function SparkleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </svg>
  );
}

const cardBase: React.CSSProperties = {
  position: "relative",
  background:
    "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
  border: "1px solid var(--glass-border)",
  borderRadius: 18,
  padding: "22px 24px",
  transition: "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
};

const inputBase: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--glass-border-bright)",
  background: "rgba(0,0,0,0.35)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color 150ms ease, box-shadow 150ms ease",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--primary)",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: "var(--text-primary)",
  letterSpacing: 0.3,
};

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  lineHeight: 1.5,
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 20,
  fontSize: 12,
  background: "rgba(74,222,128,0.10)",
  color: "var(--primary)",
  border: "1px solid rgba(74,222,128,0.18)",
};

export default function DownloadSettings() {
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState<string | null>(null);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [savedMaxConcurrent, setSavedMaxConcurrent] = useState(10);
  const [adFilter, setAdFilter] = useState(false);
  const [savedAdFilter, setSavedAdFilter] = useState(false);

  useEffect(() => {
    getDownloadRoot()
      .then((r) => {
        setSavedRoot(r);
        if (r) setRoot(r);
      })
      .catch(() => toastError("读取下载目录失败"));

    getMaxConcurrentDownloads()
      .then((v) => {
        setSavedMaxConcurrent(v);
        setMaxConcurrent(v);
      })
      .catch(() => toastError("读取并发数失败"));

    getAdFilterEnabled()
      .then((v) => {
        setSavedAdFilter(v);
        setAdFilter(v);
      })
      .catch(() => toastError("读取去广告设置失败"));
  }, []);

  const saveRoot = () => {
    const trimmed = root.trim();
    if (!trimmed) return;
    setDownloadRoot(trimmed)
      .then((r) => {
        setSavedRoot(r.value);
        toastSuccess("下载目录已保存");
      })
      .catch(() => toastError("保存下载目录失败"));
  };

  const saveMaxConcurrent = () => {
    const value = Math.max(1, Math.min(50, Math.round(maxConcurrent)));
    setMaxConcurrentDownloads(value)
      .then((r) => {
        setSavedMaxConcurrent(r.value);
        setMaxConcurrent(r.value);
        toastSuccess("同时下载任务数已保存");
      })
      .catch(() => toastError("保存并发数失败"));
  };

  const saveAdFilter = () => {
    setAdFilterEnabled(adFilter)
      .then((r) => {
        setSavedAdFilter(r.value);
        toastSuccess(r.value ? "去广告已开启" : "去广告已关闭");
      })
      .catch(() => toastError("保存去广告设置失败"));
  };

  const adjustConcurrent = (delta: number) => {
    setMaxConcurrent((prev) => Math.max(1, Math.min(50, prev + delta)));
  };

  const rootDirty = root.trim() !== (savedRoot ?? "");
  const concurrentDirty = maxConcurrent !== savedMaxConcurrent;
  const adFilterDirty = adFilter !== savedAdFilter;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            height: 38,
            borderRadius: 12,
            background:
              "linear-gradient(135deg, rgba(74,222,128,0.18), rgba(74,222,128,0.05))",
            color: "var(--primary)",
            border: "1px solid rgba(74,222,128,0.22)",
          }}
        >
          <FolderIcon size={18} />
        </div>
        <div>
          <h2 style={{ ...titleStyle, fontSize: 18 }}>下载设置</h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            管理本地存储路径、并发任务与播放列表清洗
          </p>
        </div>
      </div>

      {/* Download Root Card */}
      <div
        style={cardBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--glass-border-bright)";
          e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--glass-border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 24,
            right: 24,
            height: 2,
            background: "linear-gradient(90deg, var(--primary), transparent 70%)",
            borderRadius: "0 0 2px 2px",
            opacity: 0.7,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ color: "var(--primary)", marginTop: 2 }}>
              <FolderIcon size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>STORAGE PATH</div>
              <h3 style={{ ...titleStyle, marginTop: 4 }}>下载根目录</h3>
              <p style={descStyle}>
                所有下载文件将保存到该目录。支持本地磁盘、NAS 映射路径或网络共享文件夹。
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                type="text"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="例如 D:/Downloads 或 //nas/media"
                style={{ ...inputBase, flex: 1, minWidth: 220 }}
                aria-label="下载根目录"
              />
              <button
                className="btn btn-primary"
                onClick={saveRoot}
                disabled={!rootDirty}
                style={{
                  minHeight: 40,
                  padding: "0 20px",
                  borderRadius: 10,
                  opacity: rootDirty ? 1 : 0.5,
                }}
              >
                保存路径
              </button>
            </div>
            {savedRoot && (
              <div style={chipStyle}>
                <CheckIcon size={12} />
                <span>当前配置：{savedRoot}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid for concurrency + ad filter */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
        }}
      >
        {/* Max Concurrent Card */}
        <div
          style={cardBase}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--glass-border-bright)";
            e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--glass-border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 24,
              right: 24,
              height: 2,
              background: "linear-gradient(90deg, var(--primary), transparent 70%)",
              borderRadius: "0 0 2px 2px",
              opacity: 0.7,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ color: "var(--primary)", marginTop: 2 }}>
                <SlidersIcon size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>CONCURRENCY</div>
                <h3 style={{ ...titleStyle, marginTop: 4 }}>同时下载任务数</h3>
                <p style={descStyle}>数值越高下载越快，但会占用更多带宽与磁盘 IO。</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  className="btn"
                  onClick={() => adjustConcurrent(-1)}
                  style={{ minHeight: 40, width: 40, borderRadius: 10, padding: 0 }}
                  aria-label="减少并发数"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                  style={{ ...inputBase, width: 80, textAlign: "center" }}
                  aria-label="同时下载任务数"
                />
                <button
                  className="btn"
                  onClick={() => adjustConcurrent(1)}
                  style={{ minHeight: 40, width: 40, borderRadius: 10, padding: 0 }}
                  aria-label="增加并发数"
                >
                  +
                </button>
                <button
                  className="btn btn-primary"
                  onClick={saveMaxConcurrent}
                  disabled={!concurrentDirty}
                  style={{
                    marginLeft: "auto",
                    minHeight: 40,
                    padding: "0 18px",
                    borderRadius: 10,
                    opacity: concurrentDirty ? 1 : 0.5,
                  }}
                >
                  保存
                </button>
              </div>

              {/* Visual bar */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(maxConcurrent / 50) * 100}%`,
                      background: "linear-gradient(90deg, var(--primary), #6ee79a)",
                      boxShadow: "0 0 10px var(--primary-glow)",
                      borderRadius: 2,
                      transition: "width 200ms ease",
                    }}
                  />
                </div>
                <div style={chipStyle}>
                  <CheckIcon size={12} />
                  <span>当前配置：{savedMaxConcurrent} 个任务</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Ad Filter Card */}
        <div
          style={cardBase}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--glass-border-bright)";
            e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--glass-border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 24,
              right: 24,
              height: 2,
              background: "linear-gradient(90deg, var(--primary), transparent 70%)",
              borderRadius: "0 0 2px 2px",
              opacity: 0.7,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ color: "var(--primary)", marginTop: 2 }}>
                <SparkleIcon size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>PLAYLIST CLEANER</div>
                <h3 style={{ ...titleStyle, marginTop: 4 }}>m3u8 去广告</h3>
                <p style={descStyle}>
                  启用后，后端会在解析 m3u8 时清洗播放列表，过滤常见广告片段。
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={adFilter}
                  onChange={(e) => setAdFilter(e.target.checked)}
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                  aria-label="启用 m3u8 去广告"
                />
                <span
                  style={{
                    position: "relative",
                    width: 48,
                    height: 26,
                    borderRadius: 13,
                    background: adFilter
                      ? "var(--primary)"
                      : "rgba(255,255,255,0.10)",
                    border: `1px solid ${
                      adFilter ? "var(--primary)" : "var(--glass-border-bright)"
                    }`,
                    transition: "background 150ms ease, border-color 150ms ease",
                    boxShadow: adFilter ? "0 0 12px var(--primary-glow)" : "none",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: adFilter ? 24 : 2,
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "#000",
                      transition: "left 150ms ease",
                    }}
                  />
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: adFilter ? "var(--primary)" : "var(--text-secondary)",
                    fontWeight: 500,
                    transition: "color 150ms ease",
                  }}
                >
                  {adFilter ? "已启用" : "已关闭"}
                </span>
              </label>
              <button
                className="btn btn-primary"
                onClick={saveAdFilter}
                disabled={!adFilterDirty}
                style={{
                  minHeight: 40,
                  padding: "0 18px",
                  borderRadius: 10,
                  opacity: adFilterDirty ? 1 : 0.5,
                }}
              >
                保存
              </button>
            </div>

            <div style={chipStyle}>
              <CheckIcon size={12} />
              <span>当前配置：{savedAdFilter ? "已开启" : "已关闭"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
