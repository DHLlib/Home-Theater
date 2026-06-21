import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useVideosInfinite } from "../hooks/useVideos";
import VideoCard from "../components/VideoCard";

export default function Search() {
  const navigate = useNavigate();
  const [wd, setWd] = useState("");
  const [submittedWd, setSubmittedWd] = useState("");

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useVideosInfinite({ wd: submittedWd });

  const videos = useMemo(() => data?.pages.flat() ?? [], [data]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = wd.trim();
    setSubmittedWd(q);
  };

  const hasSearched = submittedWd.length > 0;

  return (
    <div>
      <button
        className="btn"
        onClick={() => navigate("/")}
        style={{ alignSelf: "flex-start", padding: "4px 12px", fontSize: 13, marginBottom: 8 }}
        aria-label="返回首页"
      >
        ← 返回
      </button>
      <form
        onSubmit={handleSearch}
        className="row search-page"
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
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.06)",
            color: "var(--text-primary)",
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? "搜索中..." : "搜索"}
        </button>
      </form>

      {error && (
        <div
          style={{
            padding: 12,
            background: "rgba(255,0,0,0.08)",
            border: "1px solid var(--danger)",
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 13,
            color: "var(--danger)",
          }}
        >
          {error instanceof Error ? error.message : "搜索失败"}
        </div>
      )}

      {!isLoading && hasSearched && videos.length === 0 && !error && (
        <div className="empty" style={{ padding: 40 }}>
          未找到相关视频
        </div>
      )}

      <div className="grid">
        {videos.map((v) => (
          <VideoCard key={`${v.title}-${v.year}`} item={v} />
        ))}
      </div>

      {hasSearched && hasNextPage && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <button
            className="btn"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "加载中..." : "加载更多"}
          </button>
        </div>
      )}
    </div>
  );
}
