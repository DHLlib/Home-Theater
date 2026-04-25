import { useState } from "react";
import { searchVideos } from "../api/videos";
import VideoCard from "../components/VideoCard";
import type { AggregatedVideo, FailedSource } from "../types";

export default function Search() {
  const [wd, setWd] = useState("");
  const [videos, setVideos] = useState<AggregatedVideo[]>([]);
  const [failed, setFailed] = useState<FailedSource[]>([]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wd.trim()) return;
    searchVideos({ wd: wd.trim() }).then((r) => {
      setVideos(r.items);
      setFailed(r.failed_sources);
    });
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
        <button type="submit" className="btn btn-primary">
          搜索
        </button>
      </form>
      {failed.length > 0 && (
        <div
          style={{
            padding: 8,
            background: "var(--card)",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 12,
          }}
        >
          {failed.length} 个源加载失败
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
