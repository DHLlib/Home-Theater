import { useEffect, useMemo, useState } from "react";
import {
  listDownloads,
  pauseDownload,
  resumeDownload,
  deleteDownload,
} from "../../api/downloads";
import { onSseEvent } from "../../api/sse";
import ActionSheet from "../../components/ActionSheet";
import ConfirmDialog from "../../components/ConfirmDialog";
import Fab from "../../components/Fab";
import { toastSuccess } from "../../utils/toast";
import type { DownloadTask } from "../../types";
import type { ActionSheetAction } from "../../components/ActionSheet";

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
  if (!error) return { retryable: false };
  return { retryable: error.startsWith("connection_error") };
}

function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function TaskRow({
  t,
  onMenu,
}: {
  t: DownloadTask;
  onMenu: (id: number) => void;
}) {
  const totalSegments = t.total_segments ?? 0;
  const hasSegmentProgress = totalSegments > 0;
  const progress = hasSegmentProgress
    ? Math.round((t.downloaded_segments / totalSegments) * 100)
    : t.total_bytes && t.total_bytes > 0
    ? Math.round((t.downloaded_bytes / t.total_bytes) * 100)
    : 0;

  return (
    <div
      className="mobile-list-item"
      onClick={() => onMenu(t.id)}
      style={{ marginBottom: 8 }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mobile-list-item-title" title={t.episode_name}>
          {t.episode_name}
        </div>
        <div
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <span
            style={{
              color: statusColor[t.status] || "var(--text-secondary)",
              fontWeight: 500,
            }}
          >
            {statusText[t.status] || t.status}
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            {hasSegmentProgress
              ? `${t.downloaded_segments}/${totalSegments} 片段`
              : `${formatBytes(t.downloaded_bytes)} / ${
                  t.total_bytes != null ? formatBytes(t.total_bytes) : "-"
                }`}
          </span>
        </div>
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
            marginTop: 8,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              borderRadius: 2,
              background: statusColor[t.status] || "var(--primary)",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function MobileDownloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteFile, setDeleteFile] = useState(false);
  const [menuTaskId, setMenuTaskId] = useState<number | null>(null);

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

  const groups = useMemo(() => {
    const map = new Map<string, DownloadTask[]>();
    for (const t of tasks) {
      if (!map.has(t.title)) map.set(t.title, []);
      map.get(t.title)!.push(t);
    }
    return Array.from(map.entries()).map(([title, items]) => ({
      title,
      items,
      stats: {
        total: items.length,
        downloading: items.filter((t) => t.status === "downloading").length,
        paused: items.filter((t) => t.status === "paused").length,
        done: items.filter((t) => t.status === "done").length,
        error: items.filter((t) => t.status === "error").length,
      },
    }));
  }, [tasks]);

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      downloading: tasks.filter((t) => t.status === "downloading").length,
      paused: tasks.filter((t) => t.status === "paused").length,
      done: tasks.filter((t) => t.status === "done").length,
      error: tasks.filter((t) => t.status === "error").length,
    };
  }, [tasks]);

  const activeItem = useMemo(
    () => tasks.find((t) => t.id === confirmingId),
    [tasks, confirmingId]
  );

  const menuTask = useMemo(
    () => tasks.find((t) => t.id === menuTaskId),
    [tasks, menuTaskId]
  );

  const handlePause = (id: number) => pauseDownload(id).then(refresh);
  const handleResume = (id: number) => resumeDownload(id).then(refresh);

  const handleDeleteRequest = (id: number) => {
    setMenuTaskId(null);
    setConfirmingId(id);
    setDeleteFile(false);
  };

  const handleConfirmDelete = () => {
    if (confirmingId == null) return;
    deleteDownload(confirmingId, deleteFile)
      .then((res) => {
        if (res.file_error) alert(res.file_error);
      })
      .catch(() => alert("删除失败"))
      .finally(() => {
        setConfirmingId(null);
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
    const targets = tasks.filter(
      (t) => t.status !== "downloading" && t.status !== "done"
    );
    if (targets.length === 0) return;
    Promise.all(targets.map((t) => resumeDownload(t.id))).then(() => {
      refresh();
      toastSuccess(`已继续 ${targets.length} 个任务`);
    });
  };

  return (
    <div className="mobile-page">
      <div className="mobile-page-header" style={{ justifyContent: "space-between" }}>
        <h1 className="mobile-page-title">下载中心</h1>
        {!loading && tasks.length > 0 && (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {tasks.length} 个任务
          </span>
        )}
      </div>

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
                checked={deleteFile}
                onChange={(e) => setDeleteFile(e.target.checked)}
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
          setDeleteFile(false);
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

      {loading && (
        <div className="col" style={{ gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 80, borderRadius: 10 }}
            />
          ))}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="mobile-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m6 8 4 4-4 4" />
            <line x1="13" y1="16" x2="18" y2="16" />
          </svg>
          <div className="mobile-empty-title">传输队列空闲</div>
          <p>从详情页发起下载后，任务会在这里显示实时进度</p>
        </div>
      )}

      <div className="col" style={{ gap: 16 }}>
        {groups.map((g) => (
          <div
            key={g.title}
            style={{
              borderRadius: 10,
              border: "1px solid var(--glass-border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                background: "var(--bg-elevated)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={g.title}
                >
                  {g.title}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    display: "flex",
                    gap: 8,
                  }}
                >
                  {g.stats.downloading > 0 && (
                    <span style={{ color: "var(--primary)" }}>下载中 {g.stats.downloading}</span>
                  )}
                  {g.stats.paused > 0 && (
                    <span style={{ color: "var(--warning)" }}>暂停 {g.stats.paused}</span>
                  )}
                  {g.stats.done > 0 && (
                    <span style={{ color: "var(--success)" }}>完成 {g.stats.done}</span>
                  )}
                  {g.stats.error > 0 && (
                    <span style={{ color: "var(--danger)" }}>错误 {g.stats.error}</span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {g.items.length} 集
              </span>
            </div>
            <div style={{ padding: 10 }}>
              {g.items.map((t) => (
                <TaskRow key={t.id} t={t} onMenu={setMenuTaskId} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {tasks.length > 0 && (
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
