import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listSites } from "../api/sites";
import { listVideos } from "../api/videos";
import CategoryBar from "../components/CategoryBar";
import VideoCard from "../components/VideoCard";
import type { AggregatedVideo, Site, FailedSource } from "../types";

export default function Home() {
  const [sites, setSites] = useState<Site[]>([]);
  const [videos, setVideos] = useState<AggregatedVideo[]>([]);
  const [failed, setFailed] = useState<FailedSource[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadVideos = (category?: string) => {
    listVideos(category ? { category } : {}).then((r) => {
      setVideos(r.items);
      setFailed(r.failed_sources);
    });
  };

  useEffect(() => {
    listSites().then((s) => {
      setSites(s);
      if (s.length > 0) {
        loadVideos();
      }
    });
  }, []);

  useEffect(() => {
    if (sites.length > 0) {
      loadVideos(activeCategory || undefined);
    }
  }, [activeCategory]);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>暂无采集站</h2>
        <p>请先去「设置」页添加资源站点。</p>
        <button
          className="btn btn-primary"
          onClick={() => navigate("/settings")}
        >
          去设置
        </button>
      </div>
    );
  }

  return (
    <div>
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
      <CategoryBar
        sites={sites}
        activeCategory={activeCategory}
        onSelect={(cat) => setActiveCategory(cat)}
      />
      <div className="grid">
        {videos.map((v) => (
          <VideoCard key={`${v.title}-${v.year}`} item={v} />
        ))}
      </div>
    </div>
  );
}
