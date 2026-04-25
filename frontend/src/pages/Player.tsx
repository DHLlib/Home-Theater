import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getEpisodes } from "../api/play";
import { upsertProgress } from "../api/progress";
import type { Episode } from "../types";

export default function Player() {
  const [searchParams] = useSearchParams();
  const site_id = Number(searchParams.get("site_id"));
  const original_id = searchParams.get("original_id") || "";
  const initialEp = Number(searchParams.get("ep") || "0");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(initialEp);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!site_id || !original_id) return;
    getEpisodes(site_id, original_id).then(setEpisodes);
  }, [site_id, original_id]);

  const current = episodes[currentIndex];

  useEffect(() => {
    if (!current) return;
    progressTimer.current = setInterval(() => {
      const pos = Math.floor(videoRef.current?.currentTime || 0);
      const dur = Math.floor(videoRef.current?.duration || 0);
      upsertProgress({
        title: current.ep_name,
        year: null,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      }).catch(() => {});
    }, 15000);

    const handleBeforeUnload = () => {
      const pos = Math.floor(videoRef.current?.currentTime || 0);
      const dur = Math.floor(videoRef.current?.duration || 0);
      const data = JSON.stringify({
        title: current.ep_name,
        year: null,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      });
      navigator.sendBeacon(
        "/api/progress",
        new Blob([data], { type: "application/json" })
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [current, currentIndex, site_id, original_id]);

  if (!site_id || !original_id) {
    return <div className="empty">参数缺失</div>;
  }

  return (
    <div className="col">
      <div
        style={{
          aspectRatio: "16/9",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          src={current?.url}
          controls
          style={{ width: "100%", height: "100%" }}
          autoPlay
        />
      </div>

      <div
        className="row"
        style={{ justifyContent: "space-between" }}
      >
        <button
          className="btn"
          disabled={currentIndex <= 0}
          onClick={() => setCurrentIndex((i) => i - 1)}
        >
          上一集
        </button>
        <div>
          {current
            ? `${current.ep_name} (${current.suffix})`
            : "加载中..."}
        </div>
        <button
          className="btn"
          disabled={currentIndex >= episodes.length - 1}
          onClick={() => setCurrentIndex((i) => i + 1)}
        >
          下一集
        </button>
      </div>

      <div>
        <h4>选集</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {episodes.map((ep) => (
            <button
              key={ep.index}
              className="btn"
              style={{
                borderColor:
                  ep.index === currentIndex
                    ? "var(--accent)"
                    : undefined,
              }}
              onClick={() => setCurrentIndex(ep.index)}
            >
              {ep.ep_name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
