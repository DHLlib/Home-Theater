import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getEpisodes } from "../api/play";
import { getProgress, upsertProgress } from "../api/progress";
import VideoPlayer from "../components/VideoPlayer";
import {
  getCachedEpisodes,
  setCachedEpisodes,
} from "../utils/cache";
import type { Episode, PlayProgress } from "../types";

export default function Player() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const site_id = Number(searchParams.get("site_id"));
  const original_id = searchParams.get("original_id") || "";
  const title = searchParams.get("title") || "";
  const yearRaw = searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : null;
  const initialEp = Number(searchParams.get("ep") || "0");
  const passedEpisodes = (location.state as { episodes?: Episode[] } | null)
    ?.episodes;

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(initialEp);
  const [progressRestored, setProgressRestored] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

    // 优先使用 Detail 页传递过来的 episodes（避免重复请求）
    if (passedEpisodes && passedEpisodes.length > 0) {
      setEpisodes(passedEpisodes);
      setCachedEpisodes(site_id, original_id, passedEpisodes);
      return;
    }

    // 先读缓存立即渲染
    getCachedEpisodes<Episode[]>(site_id, original_id).then((cached) => {
      if (cached) {
        setEpisodes(cached);
      }
    });

    // 再调 API 刷新并写入缓存
    getEpisodes(site_id, original_id).then((eps) => {
      setEpisodes(eps);
      setCachedEpisodes(site_id, original_id, eps);
    });
  }, [site_id, original_id, passedEpisodes]);

  const current = episodes[currentIndex];

  /* 按 suffix 分组；若 suffix 全相同且集名重复，则按连续块切分 */
  const groupedEpisodes = useMemo(() => {
    if (episodes.length === 0) return [] as { label: string; eps: Episode[] }[];

    const bySuffix: Record<string, Episode[]> = {};
    for (const ep of episodes) {
      if (!bySuffix[ep.suffix]) bySuffix[ep.suffix] = [];
      bySuffix[ep.suffix].push(ep);
    }
    const suffixes = Object.keys(bySuffix);

    if (suffixes.length > 1) {
      return suffixes.map((s) => ({ label: s.toUpperCase(), eps: bySuffix[s] }));
    }

    // 只有一种 suffix，检查是否有重复的集名（说明是多线路）
    const groups: Episode[][] = [];
    let currentGroup: Episode[] = [];
    const seen = new Set<string>();

    for (const ep of episodes) {
      if (seen.has(ep.ep_name)) {
        groups.push(currentGroup);
        currentGroup = [];
        seen.clear();
      }
      currentGroup.push(ep);
      seen.add(ep.ep_name);
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    if (groups.length > 1) {
      return groups.map((g, i) => ({ label: `线路 ${i + 1}`, eps: g }));
    }

    return [{ label: suffixes[0]?.toUpperCase() || "选集", eps: episodes }];
  }, [episodes]);

  useEffect(() => {
    if (!title || episodes.length === 0 || progressRestored) return;

    getProgress(title, year)
      .then((res: PlayProgress | null) => {
        if (
          res &&
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

      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      if (repeatInterval.current) {
        clearInterval(repeatInterval.current);
        repeatInterval.current = null;
        return;
      }

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
    <div
      ref={containerRef}
      tabIndex={0}
      className="row"
      style={{
        height: "calc(100dvh - 80px)",
        minHeight: 0,
        gap: 12,
        alignItems: "stretch",
      }}
    >
      {/* 左侧：播放器 + 控制条 */}
      <div className="col" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            flex: 1,
            minHeight: 0,
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
          style={{ justifyContent: "space-between", padding: "10px 0", flexShrink: 0 }}
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
      </div>

      {/* 右侧：选集面板 */}
      {sidebarOpen ? (
        <div
          className="col"
          style={{
            width: 220,
            flexShrink: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            className="row"
            style={{ justifyContent: "space-between", flexShrink: 0 }}
          >
            <h4 style={{ margin: 0, fontSize: 14 }}>选集</h4>
            <button
              className="btn"
              onClick={() => setSidebarOpen(false)}
              style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
              aria-label="收起选集"
            >
              收起
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 8 }}>
            {groupedEpisodes.map((group, gi) => (
              <div key={gi} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    opacity: 0.6,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {group.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {group.eps.map((ep) => (
                    <button
                      key={ep.index}
                      className="btn"
                      style={{
                        justifyContent: "flex-start",
                        borderColor:
                          ep.index === currentIndex
                            ? "var(--accent)"
                            : undefined,
                        fontSize: 13,
                        padding: "6px 10px",
                        minHeight: 36,
                      }}
                      onClick={() => setCurrentIndex(ep.index)}
                    >
                      {ep.ep_name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          className="btn"
          onClick={() => setSidebarOpen(true)}
          style={{
            writingMode: "vertical-lr",
            padding: "12px 4px",
            alignSelf: "flex-start",
            fontSize: 12,
          }}
          aria-label="展开选集"
        >
          选集
        </button>
      )}
    </div>
  );
}
