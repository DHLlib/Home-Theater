import { useState } from "react";
import { searchVideos } from "../api/videos";
import FailedSourcesPanel from "../components/FailedSourcesPanel";
import VideoCard from "../components/VideoCard";
import type { AggregatedVideo, FailedSource } from "../types";

export default function Search() {
  const [wd, setWd] = useState("");
  const [videos, setVideos] = useState<AggregatedVideo[]>([]);
  const [failed, setFailed] = useState<FailedSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = wd.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    searchVideos({ wd: q })
      .then((r) => {
        setVideos(r.items);
        setFailed(r.failed_sources);
      })
      .catch((err) => {
        setVideos([]);
        setFailed([]);
        setError(err instanceof Error ? err.message : "搜索失败");
      })
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <form
        onSubmit={handleSearch}
        className="row"
        style={{ marginBottom: 16 }}
      >
        <input
          type="text"
          value={wd}
          onChange={(e) => setWd(e.target.value)}
          placeholder="输入关键字搜索..."
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--fg)",
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "搜索中..." : "搜索"}
        </button>
      </form>

      {error && (
        <div
          style={{
            padding: 12,
            background: "rgba(255,0,0,0.08)",
            border: "1px solid var(--danger)",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      <FailedSourcesPanel failed={failed} />

      {!loading && searched && videos.length === 0 && !error && (
        <div className="empty" style={{ padding: 40 }}>
          未找到相关视频
        </div>
      )}

      <div className="grid">
        {videos.map((v) => (
          <VideoCard key={`${v.title}-${v.year}`} item={v} />
        ))}
      </div>
    </div>
  );
}
