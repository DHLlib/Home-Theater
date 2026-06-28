import { useEffect, useMemo, useState } from "react";
import {
  listDownloads,
  pauseDownload,
  resumeDownload,
  deleteDownload,
} from "../api/downloads";
import { onSseEvent } from "../api/sse";
import ActionSheet from "../components/ActionSheet";
import ConfirmDialog from "../components/ConfirmDialog";
import Fab from "../components/Fab";
import { useIsMobile } from "../hooks/useViewport";
import { toast, toastSuccess } from "../utils/toast";
import type { DownloadTask } from "../types";
import type { ActionSheetAction } from "../components/ActionSheet";

const statusText: Record<string, string> = {
  queued: "排队中",
  downloading: "下载中",
  paused: "已暂停",
  done: "已完成",
  error: "错误",
};

const statusColor: Record<string, string> = {
  queued: "var(--text-muted)",
  downloading: "var(--primary)",
  paused: "var(--warning)",
  done: "var(--success)",
  error: "var(--danger)",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function parseErrorType(error?: string | null) {
  if (!error) return { type: "unknown", message: "", retryable: false };
  if (error.startsWith("connection_error"))
    return { type: "connection_error", message: error, retryable: true };
  if (error.startsWith("site_unavailable"))
    return { type: "site_unavailable", message: error, retryable: false };
  if (error.startsWith("file_removed"))
    return { type: "file_removed", message: error, retryable: false };
  return { type: "unknown", message: error, retryable: false };
}

function TerminalIcon({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 8 4 4-4 4" />
      <line x1="13" y1="16" x2="18" y2="16" />
    </svg>
  );
}

function MoreIcon({ size = 18 }: { size?: number }) {
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
    >
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function StatusLed({ status }: { status: string }) {
  const active = status === "downloading" || status === "error";
  const color = statusColor[status] || "var(--text-muted)";
  return (
    <span
      className="status-led"
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 8px ${color}`,
      }}
      data-active={active}
    />
  );
}

function TaskProgress({ t }: { t: DownloadTask }) {
  const totalSegments = t.total_segments ?? 0;
  const hasSegmentProgress = totalSegments > 0;
  const progress = hasSegmentProgress
    ? Math.round((t.downloaded_segments / totalSegments) * 100)
    : t.total_bytes && t.total_bytes > 0
    ? Math.round((t.downloaded_bytes / t.total_bytes) * 100)
    : 0;

  return (
    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="progress-bar-track" style={{ height: 3 }}>
        <div
          className={`progress-bar-fill${t.status === "paused" ? " paused" : ""}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-muted)",
          fontFamily: "monospace",
          letterSpacing: "0.02em",
        }}
      >
        <span>
          {hasSegmentProgress
            ? `${t.downloaded_segments} / ${totalSegments} 片段`
            : `${formatBytes(t.downloaded_bytes)} / ${
                t.total_bytes != null ? formatBytes(t.total_bytes) : "-"
              }`}
        </span>
        <span style={{ color: "var(--text-secondary)" }}>{progress}%</span>
      </div>
    </div>
  );
}

function TaskRow({
  t,
  selected,
  onToggleSelect,
  onPause,
  onResume,
  onDeleteRequest,
  isMobile,
  onOpenMenu,
}: {
  t: DownloadTask;
  selected?: boolean;
  onToggleSelect?: () => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onDeleteRequest: (id: number) => void;
  isMobile?: boolean;
  onOpenMenu?: (id: number) => void;
}) {
  const errorInfo = parseErrorType(t.error);

  return (
    <div
      className={`task-row${selected ? " selected" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--glass-border)",
        transition: "background var(--transition-base)",
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "BUTTON" ||
          target.tagName === "INPUT" ||
          target.closest("button") ||
          target.closest("label")
        ) {
          return;
        }
        if (isMobile) {
          onOpenMenu?.(t.id);
          return;
        }
        onToggleSelect?.();
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: isMobile ? "flex-start" : "center",
          gap: isMobile ? 12 : 16,
          padding: isMobile ? "14px 16px" : "14px 18px 14px 22px",
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {!isMobile && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              flexShrink: 0,
              cursor: "pointer",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              style={{
                width: 16,
                height: 16,
                accentColor: "var(--primary)",
                cursor: "pointer",
              }}
            />
          </label>
        )}

        <div
          style={{
            flex: isMobile ? 1 : "0 0 180px",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: isMobile ? "100%" : undefined,
          }}
        >
          <span
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--glass-border)",
              fontSize: 11,
              color: "var(--text-secondary)",
              fontFamily: "monospace",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            站点{t.source_site_id}
          </span>
          <span
            style={{
              fontSize: 13,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={t.episode_name}
          >
            {t.episode_name}
          </span>
          {isMobile && (
            <span style={{ marginLeft: "auto" }}>
              <StatusLed status={t.status} />
            </span>
          )}
        </div>

        <TaskProgress t={t} />

        {!isMobile && (
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 100,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--glass-border)",
                fontSize: 11,
                color: statusColor[t.status] || "var(--text-secondary)",
                fontWeight: 500,
              }}
            >
              <StatusLed status={t.status} />
              <span>{statusText[t.status] || t.status}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {t.status === "downloading" && (
                <button
                  className="btn"
                  aria-label={`暂停下载 ${t.title} ${t.episode_name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPause(t.id);
                  }}
                  style={{ minWidth: 60, fontSize: 11, minHeight: 30, padding: "5px 10px" }}
                >
                  暂停
                </button>
              )}
              {t.status === "paused" && (
                <button
                  className="btn btn-primary"
                  aria-label={`继续下载 ${t.title} ${t.episode_name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResume(t.id);
                  }}
                  style={{ minWidth: 60, fontSize: 11, minHeight: 30, padding: "5px 10px" }}
                >
                  继续
                </button>
              )}
              {t.status === "error" && errorInfo.retryable && (
                <button
                  className="btn btn-primary"
                  aria-label={`重试下载 ${t.title} ${t.episode_name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResume(t.id);
                  }}
                  style={{ minWidth: 60, fontSize: 11, minHeight: 30, padding: "5px 10px" }}
                >
                  重试
                </button>
              )}
              <button
                className="btn"
                aria-label={`删除下载任务 ${t.title} ${t.episode_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRequest(t.id);
                }}
                style={{
                  minWidth: 60,
                  fontSize: 11,
                  minHeight: 30,
                  padding: "5px 10px",
                  color: "var(--danger)",
                  borderColor: "rgba(251,113,133,0.25)",
                }}
              >
                删除
              </button>
            </div>
          </div>
        )}
      </div>

      {t.status === "error" && (
        <div style={{ padding: isMobile ? "0 16px 12px" : "0 18px 12px 22px" }}>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 4,
              background: "var(--danger-dim)",
              border: "1px solid rgba(251,113,133,0.15)",
              fontSize: 11,
              color: "var(--danger)",
              lineHeight: 1.5,
            }}
          >
            {errorInfo.type === "site_unavailable" && <>站点不可用，请前往设置检查</>}
            {errorInfo.type === "file_removed" && <>资源已失效</>}
            {errorInfo.type !== "site_unavailable" &&
              errorInfo.type !== "file_removed" &&
              errorInfo.message}
          </div>
        </div>
      )}
    </div>
  );
}

function FilmStripEdge() {
  return (
    <div
      className="film-strip-edge"
      style={{
        width: 18,
        flexShrink: 0,
        alignSelf: "stretch",
        background: "rgba(255,255,255,0.02)",
        borderRight: "1px solid var(--glass-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-around",
        padding: "10px 0",
        gap: 8,
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 1,
            background: "var(--text-muted)",
            opacity: 0.35,
          }}
        />
      ))}
    </div>
  );
}

function VideoDownloadCard({
  title,
  items,
  stats,
  expanded,
  onToggle,
  selectedIds,
  onToggleTask,
  onPause,
  onResume,
  onDeleteRequest,
  onBatchResume,
  onBatchPause,
  onBatchDelete,
  isMobile,
  onBatchMenu,
  onOpenMenu,
}: {
  title: string;
  items: DownloadTask[];
  stats: { total: number; downloading: number; paused: number; done: number; error: number };
  expanded: boolean;
  onToggle: () => void;
  selectedIds: Set<number>;
  onToggleTask: (taskId: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onDeleteRequest: (id: number) => void;
  onBatchResume: (title: string) => void;
  onBatchPause: (title: string) => void;
  onBatchDelete: (title: string) => void;
  isMobile?: boolean;
  onBatchMenu?: (title: string) => void;
  onOpenMenu?: (taskId: number) => void;
}) {
  const totalBytes = useMemo(
    () => items.reduce((sum, t) => sum + (t.total_bytes ?? 0), 0),
    [items]
  );
  const downloadedBytes = useMemo(
    () => items.reduce((sum, t) => sum + t.downloaded_bytes, 0),
    [items]
  );
  const byteProgress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
  const doneProgress = Math.round((stats.done / stats.total) * 100);
  const progress = totalBytes > 0 ? byteProgress : doneProgress;

  const activeStatus = stats.error > 0 ? "error" : stats.downloading > 0 ? "downloading" : "queued";

  return (
    <article
      className="video-card card-elevated"
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background:
            activeStatus === "downloading"
              ? "var(--primary)"
              : activeStatus === "error"
              ? "var(--danger)"
              : stats.done === stats.total
              ? "var(--success)"
              : "transparent",
          boxShadow:
            activeStatus === "downloading"
              ? "0 0 14px var(--primary-glow)"
              : activeStatus === "error"
              ? "0 0 14px rgba(251,113,133,0.35)"
              : "none",
          transition: "all var(--transition-base)",
        }}
      />

      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "stretch",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <FilmStripEdge />

        <div
          style={{
            flex: 1,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  lineHeight: 1.3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={title}
              >
                {title}
              </h3>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px 14px",
                  alignItems: "center",
                }}
              >
                <span>{stats.total} 个传输任务</span>
                <span style={{ color: "var(--text-muted)" }}>·</span>
                <span style={{ fontFamily: "monospace" }}>{progress}% 总进度</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 12px",
                  borderRadius: 100,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--glass-border)",
                }}
              >
                {stats.downloading > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--primary)" }}>
                    <StatusLed status="downloading" /> {stats.downloading}
                  </span>
                )}
                {stats.paused > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--warning)" }}>
                    <StatusLed status="paused" /> {stats.paused}
                  </span>
                )}
                {stats.done > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--success)" }}>
                    <StatusLed status="done" /> {stats.done}
                  </span>
                )}
                {stats.error > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--danger)" }}>
                    <StatusLed status="error" /> {stats.error}
                  </span>
                )}
              </div>

              <div
                className="batch-actions"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                {isMobile ? (
                  <button
                    type="button"
                    className="btn"
                    aria-label={`更多操作 ${title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBatchMenu?.(title);
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <MoreIcon size={18} />
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      aria-label={`继续下载 ${title} 下可继续的任务`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBatchResume(title);
                      }}
                      style={{ fontSize: 12, minHeight: 32, padding: "5px 12px" }}
                    >
                      继续
                    </button>
                    <button
                      className="btn"
                      aria-label={`暂停下载 ${title} 下可暂停的任务`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBatchPause(title);
                      }}
                      style={{ fontSize: 12, minHeight: 32, padding: "5px 12px" }}
                    >
                      暂停
                    </button>
                    <button
                      className="btn"
                      aria-label={`删除 ${title} 下选中的任务`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBatchDelete(title);
                      }}
                      style={{
                        fontSize: 12,
                        minHeight: 32,
                        padding: "5px 12px",
                        color: "var(--danger)",
                        borderColor: "rgba(251,113,133,0.25)",
                      }}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>

              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  transition: "transform var(--transition-base)",
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--glass-border)",
                }}
              >
                ▼
              </span>
            </div>
          </div>

          <div className="progress-bar-track" style={{ height: 4 }}>
            <div
              className="progress-bar-fill"
              style={{
                width: `${progress}%`,
                transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </div>
        </div>
      </div>

      <div className={`expand-wrapper${expanded ? " open" : ""}`}>
        <div className="expand-inner">
          <div
            style={{
              borderTop: "1px solid var(--glass-border)",
              background: "rgba(0,0,0,0.25)",
            }}
          >
            {items.map((t, idx) => (
              <div
                key={t.id}
                className="task-row-outer"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                <TaskRow
                  t={t}
                  selected={selectedIds.has(t.id)}
                  onToggleSelect={() => onToggleTask(t.id)}
                  onPause={onPause}
                  onResume={onResume}
                  onDeleteRequest={onDeleteRequest}
                  isMobile={isMobile}
                  onOpenMenu={onOpenMenu}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteFileMap, setDeleteFileMap] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedMap, setSelectedMap] = useState<Record<string, Set<number>>>({});
  const [batchDelete, setBatchDelete] = useState<{ title: string; ids: number[] } | null>(null);
  const [batchDeleteFile, setBatchDeleteFile] = useState(false);
  const [menuTaskId, setMenuTaskId] = useState<number | null>(null);
  const [menuTitle, setMenuTitle] = useState<string | null>(null);

  const isMobile = useIsMobile();

  const refresh = () => listDownloads().then(setTasks);

  useEffect(() => {
    setLoading(true);
    listDownloads()
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));

    const unsubProgress = onSseEvent<{
      task_id: number;
      downloaded_bytes: number;
      total_bytes: number | null;
      downloaded_segments: number;
      total_segments: number | null;
      status: string;
    }>("download_progress", (ev) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === ev.task_id
            ? {
                ...t,
                downloaded_bytes: ev.downloaded_bytes,
                total_bytes: ev.total_bytes ?? t.total_bytes,
                downloaded_segments: ev.downloaded_segments,
                total_segments: ev.total_segments ?? t.total_segments,
                status: ev.status,
              }
            : t
        )
      );
    });

    const unsubStatus = onSseEvent<{
      task_id: number;
      status: string;
      error?: string | null;
      title?: string;
      episode_name?: string;
      file_path?: string;
      source_site_id?: number;
      source_video_id?: string;
      url?: string;
      suffix?: string;
    }>("download_status", (ev) => {
      if (ev.status === "deleted") {
        setTasks((prev) => prev.filter((t) => t.id !== ev.task_id));
        return;
      }
      setTasks((prev) => {
        const exists = prev.find((t) => t.id === ev.task_id);
        if (exists) {
          return prev.map((t) =>
            t.id === ev.task_id
              ? {
                  ...t,
                  status: ev.status,
                  error: ev.error ?? t.error,
                  downloaded_bytes:
                    ev.status === "done"
                      ? t.total_bytes ?? t.downloaded_bytes
                      : t.downloaded_bytes,
                }
              : t
          );
        }
        if (ev.title && ev.file_path) {
          return [
            {
              id: ev.task_id,
              title: ev.title,
              episode_name: ev.episode_name || "",
              episode_index: 0,
              source_site_id: ev.source_site_id ?? 0,
              source_video_id: ev.source_video_id ?? "",
              url: ev.url ?? "",
              suffix: ev.suffix ?? "",
              file_path: ev.file_path,
              total_bytes: null,
              downloaded_bytes: 0,
              total_segments: null,
              downloaded_segments: 0,
              status: ev.status,
              error: ev.error ?? null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as DownloadTask,
            ...prev,
          ];
        }
        return prev;
      });
    });

    return () => {
      unsubProgress();
      unsubStatus();
    };
  }, []);

  const stats = useMemo(() => {
    const total = tasks.length;
    const downloading = tasks.filter((t) => t.status === "downloading").length;
    const paused = tasks.filter((t) => t.status === "paused").length;
    const done = tasks.filter((t) => t.status === "done").length;
    const error = tasks.filter((t) => t.status === "error").length;
    return { total, downloading, paused, done, error };
  }, [tasks]);

  type GroupStats = { total: number; downloading: number; paused: number; done: number; error: number };
  const groups = useMemo(() => {
    const map = new Map<string, DownloadTask[]>();
    for (const t of tasks) {
      if (!map.has(t.title)) map.set(t.title, []);
      map.get(t.title)!.push(t);
    }
    return Array.from(map.entries()).map(([title, items]) => {
      const groupStats: GroupStats = {
        total: items.length,
        downloading: items.filter((t) => t.status === "downloading").length,
        paused: items.filter((t) => t.status === "paused").length,
        done: items.filter((t) => t.status === "done").length,
        error: items.filter((t) => t.status === "error").length,
      };
      return { title, items, stats: groupStats };
    });
  }, [tasks]);

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (!(g.title in next)) next[g.title] = true;
      }
      return next;
    });
  }, [groups]);

  const activeItem = useMemo(
    () => tasks.find((t) => t.id === confirmingId),
    [tasks, confirmingId]
  );

  const handlePause = (id: number) => {
    pauseDownload(id).then(refresh);
  };

  const handleResume = (id: number) => {
    resumeDownload(id).then(refresh);
  };

  const handleDeleteRequest = (id: number) => {
    setConfirmingId(id);
    setDeleteFileMap((prev) => ({ ...prev, [id]: false }));
  };

  const handleConfirmDelete = () => {
    if (confirmingId == null) return;
    const deleteFile = deleteFileMap[confirmingId] || false;
    deleteDownload(confirmingId, deleteFile)
      .then((res) => {
        if (res.file_error) {
          alert(res.file_error);
        }
      })
      .catch(() => alert("删除失败"))
      .finally(() => {
        setConfirmingId(null);
        refresh();
      });
  };

  const getSelectedIds = (title: string) => selectedMap[title] ?? new Set<number>();

  const getBatchTargets = (title: string, items: DownloadTask[]) => {
    const selected = getSelectedIds(title);
    if (selected.size > 0) return items.filter((t) => selected.has(t.id));
    return items;
  };

  const handleToggleTaskSelection = (title: string, taskId: number) => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      const set = new Set(next[title] ?? []);
      if (set.has(taskId)) set.delete(taskId);
      else set.add(taskId);
      next[title] = set;
      return next;
    });
  };

  const handleBatchResume = (title: string) => {
    const group = groups.find((g) => g.title === title);
    if (!group) return;
    const targets = getBatchTargets(title, group.items).filter(
      (t) => t.status !== "downloading" && t.status !== "done"
    );
    if (targets.length === 0) {
      toast("info", "没有可继续的任务");
      return;
    }
    Promise.all(targets.map((t) => resumeDownload(t.id))).then(() => {
      refresh();
      toastSuccess(`已继续 ${targets.length} 个任务`);
    });
  };

  const handleBatchPause = (title: string) => {
    const group = groups.find((g) => g.title === title);
    if (!group) return;
    const targets = getBatchTargets(title, group.items).filter(
      (t) => t.status !== "paused" && t.status !== "done"
    );
    if (targets.length === 0) {
      toast("info", "没有可暂停的任务");
      return;
    }
    Promise.all(targets.map((t) => pauseDownload(t.id))).then(() => {
      refresh();
      toastSuccess(`已暂停 ${targets.length} 个任务`);
    });
  };

  const handleBatchDeleteRequest = (title: string) => {
    const group = groups.find((g) => g.title === title);
    if (!group) return;
    const targets = getBatchTargets(title, group.items);
    if (targets.length === 0) return;
    setBatchDeleteFile(false);
    setBatchDelete({ title, ids: targets.map((t) => t.id) });
  };

  const handleConfirmBatchDelete = () => {
    if (batchDelete == null) return;
    Promise.all(
      batchDelete.ids.map((id) =>
        deleteDownload(id, batchDeleteFile).then((res) => ({ id, res }))
      )
    )
      .then((results) => {
        const errors = results.filter(({ res }) => res.file_error);
        if (errors.length > 0) {
          alert(`部分文件删除失败：${errors.map(({ res }) => res.file_error).join("、")}`);
        }
      })
      .catch(() => alert("删除失败"))
      .finally(() => {
        setBatchDelete(null);
        setBatchDeleteFile(false);
        setSelectedMap((prev) => {
          const next = { ...prev };
          delete next[batchDelete.title];
          return next;
        });
        refresh();
      });
  };

  const handleGlobalPause = () => {
    const targets = tasks.filter((t) => t.status === "downloading");
    if (targets.length === 0) return;
    Promise.all(targets.map((t) => pauseDownload(t.id))).then(() => {
      refresh();
      toastSuccess(`已暂停 ${targets.length} 个任务`);
    });
  };

  const handleGlobalResume = () => {
    const targets = tasks.filter((t) => t.status !== "downloading" && t.status !== "done");
    if (targets.length === 0) return;
    Promise.all(targets.map((t) => resumeDownload(t.id))).then(() => {
      refresh();
      toastSuccess(`已继续 ${targets.length} 个任务`);
    });
  };

  const menuTask = tasks.find((t) => t.id === menuTaskId);
  const menuGroup = groups.find((g) => g.title === menuTitle);

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: "-16px",
        padding: "32px 24px 48px",
      }}
    >
      <style>{`
        @keyframes ledPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px currentColor; }
          50% { opacity: 0.45; box-shadow: 0 0 2px currentColor; }
        }
        @keyframes vaultReveal {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes taskReveal {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .status-led[data-active="true"] {
          animation: ledPulse 1.6s ease-in-out infinite;
        }
        .video-card {
          animation: vaultReveal 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .expand-wrapper {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .expand-wrapper.open {
          grid-template-rows: 1fr;
        }
        .expand-inner {
          overflow: hidden;
        }
        .task-row:hover {
          background: rgba(255,255,255,0.025);
        }
        .task-row.selected {
          background: rgba(74,222,128,0.05);
        }
        .task-row-outer {
          animation: taskReveal 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .task-row-outer:last-child .task-row {
          border-bottom: none;
        }
        .film-strip-edge span {
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
        }
        .video-list {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        @media (max-width: 767px) {
          .video-list {
            gap: 14px;
          }
          .task-row > div:first-child {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
          .task-row > div:first-child > label {
            align-self: flex-start;
          }
          .task-row > div:first-child > div {
            width: 100%;
            flex: none !important;
            min-width: 0;
          }
          .task-row > div:first-child > div:last-child {
            justify-content: space-between;
          }
        }
      `}</style>

      <header
        style={{
          marginBottom: 28,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            className="font-display"
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.04em",
            }}
          >
            下载中心
          </h1>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            {loading
              ? "加载中..."
              : tasks.length > 0
              ? `共 ${tasks.length} 个传输任务`
              : "传输队列空闲"}
          </div>
        </div>

        {!loading && tasks.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            {[
              { label: "总数", value: stats.total, color: "var(--text-secondary)" },
              { label: "下载中", value: stats.downloading, color: "var(--primary)" },
              { label: "已暂停", value: stats.paused, color: "var(--warning)" },
              { label: "已完成", value: stats.done, color: "var(--success)" },
              { label: "错误", value: stats.error, color: "var(--danger)" },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 100,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--glass-border)",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "var(--text-muted)" }}>{s.label}</span>
                <span
                  style={{
                    color: s.color,
                    fontWeight: 600,
                    fontFamily: "monospace",
                  }}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </header>

      <ConfirmDialog
        open={confirmingId != null}
        title="删除传输任务"
        message={
          <div className="col" style={{ gap: 12 }}>
            <div>
              确定要删除
              <strong style={{ color: "var(--text-primary)" }}>
                「{activeItem?.title} · {activeItem?.episode_name}」
              </strong>
              吗？
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
            >
              <input
                type="checkbox"
                checked={confirmingId != null ? deleteFileMap[confirmingId] || false : false}
                onChange={(e) => {
                  if (confirmingId != null) {
                    setDeleteFileMap((prev) => ({
                      ...prev,
                      [confirmingId]: e.target.checked,
                    }));
                  }
                }}
              />
              同时删除本地源文件
            </label>
          </div>
        }
        confirmText="删除"
        cancelText="取消"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setConfirmingId(null);
          setDeleteFileMap((prev) =>
            confirmingId != null ? { ...prev, [confirmingId]: false } : prev
          );
        }}
      />

      <ActionSheet
        open={menuTaskId != null}
        title={menuTask ? `${menuTask.title} · ${menuTask.episode_name}` : undefined}
        actions={(() => {
          if (!menuTask) return [];
          const errorInfo = parseErrorType(menuTask.error);
          const actions: ActionSheetAction[] = [];
          if (menuTask.status === "downloading") {
            actions.push({
              key: "pause",
              label: "暂停",
              onClick: () => handlePause(menuTask.id),
            });
          } else if (menuTask.status === "paused") {
            actions.push({
              key: "resume",
              label: "继续",
              onClick: () => handleResume(menuTask.id),
            });
          } else if (menuTask.status === "error" && errorInfo.retryable) {
            actions.push({
              key: "retry",
              label: "重试",
              onClick: () => handleResume(menuTask.id),
            });
          }
          actions.push({
            key: "delete",
            label: "删除",
            danger: true,
            onClick: () => handleDeleteRequest(menuTask.id),
          });
          return actions;
        })()}
        onClose={() => setMenuTaskId(null)}
      />

      <ActionSheet
        open={menuTitle != null}
        title={menuGroup ? menuGroup.title : undefined}
        actions={(() => {
          if (!menuGroup) return [];
          const actions: ActionSheetAction[] = [];
          const anyResume = menuGroup.items.some(
            (t) => t.status !== "downloading" && t.status !== "done"
          );
          const anyPause = menuGroup.items.some(
            (t) => t.status !== "paused" && t.status !== "done"
          );
          if (anyResume) {
            actions.push({
              key: "resume",
              label: "全部继续",
              onClick: () => handleBatchResume(menuGroup.title),
            });
          }
          if (anyPause) {
            actions.push({
              key: "pause",
              label: "全部暂停",
              onClick: () => handleBatchPause(menuGroup.title),
            });
          }
          actions.push({
            key: "delete",
            label: "全部删除",
            danger: true,
            onClick: () => handleBatchDeleteRequest(menuGroup.title),
          });
          return actions;
        })()}
        onClose={() => setMenuTitle(null)}
      />

      <ConfirmDialog
        open={batchDelete != null}
        title="批量删除传输任务"
        message={
          <div className="col" style={{ gap: 12 }}>
            <div>
              确定要删除
              <strong style={{ color: "var(--text-primary)" }}>
                「{batchDelete?.title}」
              </strong>
              下的 <strong style={{ color: "var(--text-primary)" }}>{batchDelete?.ids.length}</strong>{" "}
              个任务吗？
            </div>
            {batchDelete && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  maxHeight: 120,
                  overflow: "auto",
                }}
              >
                {(() => {
                  const names = tasks
                    .filter((t) => batchDelete.ids.includes(t.id))
                    .map((t) => `站点${t.source_site_id}：${t.episode_name}`);
                  const visible = names.slice(0, 3);
                  const rest = names.length - visible.length;
                  return (
                    <>
                      {visible.join("、")}
                      {rest > 0 && <span style={{ color: "var(--text-muted)" }}>（等共 {names.length} 项）</span>}
                    </>
                  );
                })()}
              </div>
            )}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
            >
              <input
                type="checkbox"
                checked={batchDeleteFile}
                onChange={(e) => setBatchDeleteFile(e.target.checked)}
              />
              同时删除本地源文件
            </label>
          </div>
        }
        confirmText="删除"
        cancelText="取消"
        danger
        onConfirm={handleConfirmBatchDelete}
        onCancel={() => {
          setBatchDelete(null);
          setBatchDeleteFile(false);
        }}
      />

      {loading ? (
        <div className="video-list">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{
                height: 120,
                borderRadius: 8,
                animationDelay: `${i * 80}ms`,
              }}
            />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "72px 24px",
            color: "var(--text-secondary)",
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--text-muted)", animation: "breathe-rotate 8s linear infinite" }}>
            <TerminalIcon size={72} />
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 16,
              fontWeight: 500,
              color: "var(--text-primary)",
            }}
          >
            传输队列空闲
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-muted)",
              maxWidth: 320,
            }}
          >
            从详情页发起下载后，任务会在这里显示实时进度
          </div>
        </div>
      ) : (
        <div className="video-list">
          {groups.map((g) => (
            <VideoDownloadCard
              key={g.title}
              title={g.title}
              items={g.items}
              stats={g.stats}
              expanded={expandedGroups[g.title] !== false}
              onToggle={() =>
                setExpandedGroups((prev) => ({
                  ...prev,
                  [g.title]: !prev[g.title],
                }))
              }
              selectedIds={selectedMap[g.title] ?? new Set()}
              onToggleTask={(taskId) => handleToggleTaskSelection(g.title, taskId)}
              onPause={handlePause}
              onResume={handleResume}
              onDeleteRequest={handleDeleteRequest}
              onBatchResume={handleBatchResume}
              onBatchPause={handleBatchPause}
              onBatchDelete={handleBatchDeleteRequest}
              isMobile={isMobile}
              onBatchMenu={setMenuTitle}
              onOpenMenu={setMenuTaskId}
            />
          ))}
        </div>
      )}

      {isMobile && tasks.length > 0 && (
        <Fab
          onClick={stats.downloading > 0 ? handleGlobalPause : handleGlobalResume}
          ariaLabel={stats.downloading > 0 ? "全部暂停" : "全部继续"}
        >
          {stats.downloading > 0 ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </Fab>
      )}
    </div>
  );
}
