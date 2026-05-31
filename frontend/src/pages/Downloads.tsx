import { useEffect, useState } from "react";
import {
  listDownloads,
  pauseDownload,
  resumeDownload,
  deleteDownload,
} from "../api/downloads";
import { onSseEvent } from "../api/sse";
import type { DownloadTask } from "../types";

const statusText: Record<string, string> = {
  queued: "排队中",
  downloading: "下载中",
  paused: "已暂停",
  done: "完成",
  error: "错误",
};

const statusColor: Record<string, string> = {
  queued: "var(--text-secondary)",
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

export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteFileMap, setDeleteFileMap] = useState<Record<number, boolean>>({});

  const refresh = () => listDownloads().then(setTasks);

  useEffect(() => {
    refresh();

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
                    ev.status === "done" ? t.total_bytes ?? t.downloaded_bytes : t.downloaded_bytes,
                }
              : t
          );
        }
        // 新任务（从 create download 推过来的）
        if (ev.title && ev.file_path) {
          return [
            {
              id: ev.task_id,
              title: ev.title,
              episode_name: ev.episode_name || "",
              episode_index: 0,
              source_site_id: 0,
              source_video_id: "",
              url: "",
              suffix: "",
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

  const handleDelete = async (id: number) => {
    const res = await deleteDownload(id, deleteFileMap[id]);
    if (res.file_error) {
      alert(res.file_error);
    }
    setConfirmingId(null);
    refresh();
  };

  return (
    <div className="col">
      <h2>下载任务</h2>
      <div className="downloads-list">
      {tasks.map((t) => {
        const totalSegments = t.total_segments ?? 0;
        const hasSegmentProgress = totalSegments > 0;
        const progress = hasSegmentProgress
          ? Math.round((t.downloaded_segments / totalSegments) * 100)
          : t.total_bytes && t.total_bytes > 0
          ? Math.round((t.downloaded_bytes / t.total_bytes) * 100)
          : 0;
        const errorInfo = parseErrorType(t.error);
        const showProgress =
          t.status === "downloading" ||
          t.status === "paused" ||
          t.status === "queued";

        return (
          <div key={t.id}>
            <div
              className="row list-item-card"
              style={{
                justifyContent: "space-between",
                padding: "14px 12px",
                background: "var(--card)",
                borderRadius: 8,
                marginBottom: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {t.title} · {t.episode_name}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                  <span style={{ color: statusColor[t.status] || "inherit" }}>
                    {statusText[t.status] || t.status}
                  </span>
                  {" · "}
                  {hasSegmentProgress
                    ? `${t.downloaded_segments} / ${t.total_segments} 片段`
                    : `${formatBytes(t.downloaded_bytes)} / ${
                        t.total_bytes != null ? formatBytes(t.total_bytes) : "-"
                      }`}
                </div>
                {showProgress && (
                  <div style={{ marginTop: 6 }}>
                    <div
                      style={{
                        height: 6,
                        background: "var(--border)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: "100%",
                          background: "var(--primary)",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        textAlign: "right",
                        marginTop: 2,
                      }}
                    >
                      {progress}%
                    </div>
                  </div>
                )}
                {t.status === "error" && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: 8,
                      background: "rgba(255,0,0,0.08)",
                      border: "1px solid var(--danger)",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "var(--danger)",
                    }}
                  >
                    {errorInfo.type === "site_unavailable" && (
                      <div>站点不可用，请前往设置检查</div>
                    )}
                    {errorInfo.type === "file_removed" && (
                      <div>资源已失效</div>
                    )}
                    {errorInfo.type !== "site_unavailable" &&
                      errorInfo.type !== "file_removed" && (
                        <div>{errorInfo.message}</div>
                      )}
                  </div>
                )}
              </div>
              <div className="row" style={{ marginLeft: 12, flexShrink: 0 }}>
                {t.status === "downloading" && (
                  <button
                    className="btn"
                    aria-label={`暂停下载 ${t.title} ${t.episode_name}`}
                    onClick={() => pauseDownload(t.id).then(refresh)}
                  >
                    暂停
                  </button>
                )}
                {t.status === "paused" && (
                  <button
                    className="btn"
                    aria-label={`继续下载 ${t.title} ${t.episode_name}`}
                    onClick={() => resumeDownload(t.id).then(refresh)}
                  >
                    继续
                  </button>
                )}
                {t.status === "error" && errorInfo.retryable && (
                  <button
                    className="btn"
                    aria-label={`重试下载 ${t.title} ${t.episode_name}`}
                    onClick={() => resumeDownload(t.id).then(refresh)}
                  >
                    重试
                  </button>
                )}
                <button
                  className="btn"
                  aria-label={`删除下载任务 ${t.title} ${t.episode_name}`}
                  onClick={() => {
                    setConfirmingId(t.id);
                    setDeleteFileMap((prev) => ({ ...prev, [t.id]: false }));
                  }}
                >
                  删除
                </button>
              </div>
            </div>
            {confirmingId === t.id && (
              <div
                style={{
                  padding: 12,
                  background: "var(--card)",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 14, marginBottom: 8 }}>
                  确定删除此下载任务？
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    marginBottom: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteFileMap[t.id] || false}
                    onChange={(e) =>
                      setDeleteFileMap((prev) => ({
                        ...prev,
                        [t.id]: e.target.checked,
                      }))
                    }
                  />
                  同时删除本地源文件
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn"
                    style={{
                      background: "var(--danger)",
                      color: "#fff",
                    }}
                    onClick={() => handleDelete(t.id)}
                  >
                    确定删除
                  </button>
                  <button
                    className="btn"
                    onClick={() => setConfirmingId(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {tasks.length === 0 && (
        <div className="empty">暂无下载任务</div>
      )}
      </div>
    </div>
  );
}
