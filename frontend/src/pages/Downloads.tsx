import { useEffect, useState } from "react";
import {
  listDownloads,
  pauseDownload,
  resumeDownload,
  deleteDownload,
} from "../api/downloads";
import type { DownloadTask } from "../types";

export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  const refresh = () => listDownloads().then(setTasks);

  useEffect(() => {
    refresh();
  }, []);

  const statusText: Record<string, string> = {
    queued: "排队中",
    downloading: "下载中",
    paused: "已暂停",
    done: "完成",
    error: "错误",
  };

  return (
    <div className="col">
      <h2>下载任务</h2>
      {tasks.map((t) => (
        <div
          key={t.id}
          className="row"
          style={{
            justifyContent: "space-between",
            padding: 10,
            background: "var(--card)",
            borderRadius: 6,
          }}
        >
          <div>
            <div style={{ fontWeight: 500 }}>
              {t.title} · {t.episode_name}
            </div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {statusText[t.status] || t.status} · {t.downloaded_bytes} /{" "}
              {t.total_bytes ?? "-"} bytes
            </div>
          </div>
          <div className="row">
            {t.status === "downloading" && (
              <button
                className="btn"
                onClick={() => pauseDownload(t.id).then(refresh)}
              >
                暂停
              </button>
            )}
            {t.status === "paused" && (
              <button
                className="btn"
                onClick={() => resumeDownload(t.id).then(refresh)}
              >
                继续
              </button>
            )}
            <button
              className="btn"
              onClick={() => deleteDownload(t.id).then(refresh)}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      {tasks.length === 0 && (
        <div className="empty">暂无下载任务</div>
      )}
    </div>
  );
}
