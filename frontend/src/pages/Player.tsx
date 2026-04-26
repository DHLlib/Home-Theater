import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getEpisodes } from "../api/play";
import { getProgress, upsertProgress } from "../api/progress";
import VideoPlayer from "../components/VideoPlayer";
import type { Episode, PlayProgress } from "../types";

export default function Player() {
  const [searchParams, setSearchParams] = useSearchParams();
  const site_id = Number(searchParams.get("site_id"));
  const original_id = searchParams.get("original_id") || "";
  const title = searchParams.get("title") || "";
  const yearRaw = searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : null;
  const initialEp = Number(searchParams.get("ep") || "0");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(initialEp);
  const [progressRestored, setProgressRestored] = useState(false);
  const playerRef = useRef<{
    seekTo: (seconds: number) => void;
    getCurrentTime: () => number;
    getDuration: () => number;
  } | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const keyDownTime = useRef<Record<string, number>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!site_id || !original_id) return;
    getEpisodes(site_id, original_id).then(setEpisodes);
  }, [site_id, original_id]);

  const current = episodes[currentIndex];

  useEffect(() => {
    if (!title || episodes.length === 0 || progressRestored) return;

    getProgress(title, year)
      .then((res: PlayProgress) => {
        if (
          res.source_site_id === site_id &&
          res.source_video_id === original_id &&
          res.episode_index >= 0 &&
          res.episode_index < episodes.length
        ) {
          setCurrentIndex(res.episode_index);
          setTimeout(() => {
            playerRef.current?.seekTo(res.position_seconds);
          }, 500);
        }
      })
      .catch(() => {})
      .finally(() => setProgressRestored(true));
  }, [title, year, site_id, original_id, episodes, progressRestored]);

  useEffect(() => {
    if (!current) return;

    progressTimer.current = setInterval(() => {
      const pos = Math.floor(playerRef.current?.getCurrentTime() || 0);
      const dur = Math.floor(playerRef.current?.getDuration() || 0);
      upsertProgress({
        title,
        year,
        source_site_id: site_id,
        source_video_id: original_id,
        episode_index: currentIndex,
        episode_name: current.ep_name,
        position_seconds: pos,
        duration_seconds: dur || null,
      }).catch(() => {});
    }, 15000);

    const handleBeforeUnload = () => {
      const pos = Math.floor(playerRef.current?.getCurrentTime() || 0);
      const dur = Math.floor(playerRef.current?.getDuration() || 0);
      const data = JSON.stringify({
        title,
        year,
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
  }, [current, currentIndex, site_id, original_id, title, year]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        prev.set("ep", String(currentIndex));
        return prev;
      },
      { replace: true }
    );
  }, [currentIndex, setSearchParams]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const LONG_PRESS_THRESHOLD = 2000;
    const CONTINUOUS_INTERVAL = 200;
    const SHORT_JUMP = 15;
    const CONTINUOUS_JUMP = 5;

    const clamp = (val: number, min: number, max: number) =>
      Math.max(min, Math.min(max, val));

    const seek = (delta: number) => {
      const video = playerRef.current;
      if (!video) return;
      const next = clamp(
        video.getCurrentTime() + delta,
        0,
        video.getDuration() || 0
      );
      video.seekTo(next);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();

      const key = e.key;
      const now = Date.now();
      if (keyDownTime.current[key]) return;
      keyDownTime.current[key] = now;

      // 2s 后进入连续控制模式（不再执行初始 15s）
      longPressTimer.current = setTimeout(() => {
        const continuousDelta =
          key === "ArrowLeft" ? -CONTINUOUS_JUMP : CONTINUOUS_JUMP;
        repeatInterval.current = setInterval(() => {
          seek(continuousDelta);
        }, CONTINUOUS_INTERVAL);
      }, LONG_PRESS_THRESHOLD);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      const downAt = keyDownTime.current[e.key];
      delete keyDownTime.current[e.key];

      // 清除 2s 定时器
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      // 若连续模式已启动，只停止 interval（不执行初始 15s）
      if (repeatInterval.current) {
        clearInterval(repeatInterval.current);
        repeatInterval.current = null;
        return;
      }

      // 短按（< 2s）执行一次 15s 跳转
      if (downAt) {
        const held = Date.now() - downAt;
        if (held < LONG_PRESS_THRESHOLD) {
          const delta = e.key === "ArrowLeft" ? -SHORT_JUMP : SHORT_JUMP;
          seek(delta);
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("keyup", handleKeyUp);
    container.focus();

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("keyup", handleKeyUp);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (repeatInterval.current) clearInterval(repeatInterval.current);
    };
  }, []);

  const handleEnded = () => {
    if (currentIndex < episodes.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  if (!site_id || !original_id) {
    return <div className="empty">参数缺失</div>;
  }

  return (
    <div className="col" ref={containerRef} tabIndex={0}>
      <div
        style={{
          aspectRatio: "16/9",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <VideoPlayer
          ref={playerRef}
          src={current?.url || ""}
          suffix={current?.suffix || ""}
          autoplay
          onError={(msg) => console.error("播放错误:", msg)}
          onEnded={handleEnded}
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
              {ep.suffix ? ` (${ep.suffix})` : ""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
