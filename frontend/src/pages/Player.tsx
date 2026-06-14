import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getEpisodes, getSources } from "../api/play";
import { getProgress, upsertProgress } from "../api/progress";
import VideoPlayer from "../components/VideoPlayer";
import type { VideoPlayerHandle } from "../components/VideoPlayer";
import { getCachedEpisodes, setCachedEpisodes } from "../utils/cache";
import { useFullscreen } from "../hooks/useFullscreen";
import { useIsMobile } from "../hooks/useViewport";
import OnboardingHint from "../components/OnboardingHint";
import type { Episode, PlayProgress, PlaySource } from "../types";

export default function Player() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sources, setSources] = useState<PlaySource[]>([]);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const keyDownTime = useRef<Record<string, number>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const passedConsumedRef = useRef(false);

  const { isFullscreen, isFakeLandscape, isSimulatedFullscreen, toggleFullscreen } = useFullscreen();
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  // 进入移动端时自动收起选集，避免全屏方向变化导致选集被重新打开后遮挡视频
  useEffect(() => {
    if (isMobile && sidebarOpenRef.current) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!site_id || !original_id) return;

    // 优先使用 Detail 页传递过来的 episodes（避免重复请求）
    // 用 ref 保证只消费一次，换源后不再复用旧源的 passedEpisodes
    if (passedEpisodes && passedEpisodes.length > 0 && !passedConsumedRef.current) {
      passedConsumedRef.current = true;
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

  // 加载该视频的所有可用源
  useEffect(() => {
    if (!title) return;
    getSources(title, year)
      .then((res) => setSources(res.sources))
      .catch(() => {});
  }, [title, year]);

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

    // 用户从详情页明确选择了集数（ep > 0），跳过进度恢复
    if (initialEp > 0) {
      setProgressRestored(true);
      return;
    }

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
  }, [title, year, site_id, original_id, episodes, progressRestored, initialEp]);

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
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (repeatInterval.current) clearInterval(repeatInterval.current);
    };
  }, []);

  const handleEnded = () => {
    if (currentIndex < episodes.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleToggleFullscreen = useCallback(() => {
    toggleFullscreen(playerContainerRef.current);
  }, [toggleFullscreen]);

  const handleSwitchSource = useCallback(
    (source: PlaySource) => {
      setCurrentIndex(0);
      setSearchParams(
        (prev) => {
          prev.set("site_id", String(source.site_id));
          prev.set("original_id", source.original_id);
          prev.delete("ep");
          return prev;
        },
        { replace: true }
      );
      setSourcePanelOpen(false);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [setSearchParams, isMobile]
  );

  const handleEpisodeClick = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile]
  );

  if (!site_id || !original_id) {
    return <div className="empty">参数缺失</div>;
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="player-layout"
      style={{
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* 返回按钮 */}
      <button
        className="btn"
        onClick={() => navigate("/")}
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 10,
          padding: "4px 12px",
          fontSize: 13,
          background: "var(--glass-bg)",
          backdropFilter: "blur(12px)",
        }}
        aria-label="返回首页"
      >
        ← 返回
      </button>

      {/* 左侧：播放器 + 控制条 */}
      <div className="player-main" ref={playerContainerRef}>
        <div className={`player-video-wrap ${isSimulatedFullscreen ? "simulated-fullscreen" : ""} ${isFakeLandscape ? "fake-landscape" : ""}`}>
          <VideoPlayer
            ref={playerRef}
            src={current?.url || ""}
            suffix={current?.suffix || ""}
            autoplay
            onError={() => {}}
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
          <div className="row" style={{ gap: 8 }}>
            {/* 移动端选集按钮 */}
            {isMobile && (
              <button
                className="btn"
                onClick={() => setSidebarOpen(true)}
                style={{ padding: "4px 12px", minHeight: 44, fontSize: 13 }}
              >
                选集
              </button>
            )}
            <button
              className="btn"
              onClick={handleToggleFullscreen}
              style={{ padding: "4px 12px", minHeight: 44, fontSize: 13 }}
              aria-label={isFullscreen || isSimulatedFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen || isSimulatedFullscreen ? "退出全屏" : "全屏"}
            </button>
            <button
              className="btn"
              disabled={currentIndex >= episodes.length - 1}
              onClick={() => setCurrentIndex((i) => i + 1)}
            >
              下一集
            </button>
          </div>
        </div>
      </div>

      {/* 桌面端：右侧 sidebar */}
      {!isMobile && sidebarOpen && (
        <div className="episode-sidebar">
          <div
            className="row"
            style={{ justifyContent: "space-between", flexShrink: 0 }}
          >
            <h4 style={{ margin: 0, fontSize: 14 }}>
              {sourcePanelOpen ? "选择来源" : "选集"}
            </h4>
            <div className="row" style={{ gap: 6 }}>
              {!sourcePanelOpen && sources.length > 1 && (
                <button
                  className="btn"
                  onClick={() => setSourcePanelOpen(true)}
                  style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                >
                  换源 ({sources.length})
                </button>
              )}
              {sourcePanelOpen && (
                <button
                  className="btn"
                  onClick={() => setSourcePanelOpen(false)}
                  style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                >
                  返回
                </button>
              )}
              <button
                className="btn"
                onClick={() => setSidebarOpen(false)}
                style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                aria-label="收起选集"
              >
                收起
              </button>
            </div>
          </div>
          <div className="episode-list">
            {sourcePanelOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sources.map((src) => {
                  const isCurrent =
                    src.site_id === site_id && src.original_id === original_id;
                  return (
                    <button
                      key={`${src.site_id}-${src.original_id}`}
                      className="btn"
                      style={{
                        justifyContent: "flex-start",
                        borderColor: isCurrent ? "var(--primary)" : undefined,
                        fontSize: 13,
                        padding: "6px 10px",
                        minHeight: 36,
                      }}
                      onClick={() => handleSwitchSource(src)}
                    >
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                        <span>{src.site_name}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {src.episode_count}集 · {src.suffix}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                {groupedEpisodes.length > 1 && (
                  <OnboardingHint storageKey="player-lines">
                    同一视频可能有多个播放线路，切换线路可尝试不同播放地址
                  </OnboardingHint>
                )}
                {groupedEpisodes.map((group, gi) => (
                  <div key={gi} style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--text-muted)",
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
                                ? "var(--primary)"
                                : undefined,
                            fontSize: 13,
                            padding: "6px 10px",
                            minHeight: 36,
                          }}
                          onClick={() => handleEpisodeClick(ep.index)}
                        >
                          {ep.ep_name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* 桌面端收起状态 */}
      {!isMobile && !sidebarOpen && (
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

      {/* 移动端：底部抽屉 */}
      {isMobile && (
        <>
          {/* 遮罩层 */}
          {sidebarOpen && (
            <div
              className="episode-drawer-backdrop"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {/* 抽屉 */}
          <div className={`episode-drawer ${sidebarOpen ? "open" : ""}`}>
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                flexShrink: 0,
                padding: "12px 16px",
                borderBottom: "1px solid var(--glass-border)",
              }}
            >
              <h4 style={{ margin: 0, fontSize: 15 }}>
                {sourcePanelOpen ? "选择来源" : "选集"}
              </h4>
              <div className="row" style={{ gap: 6 }}>
                {!sourcePanelOpen && sources.length > 1 && (
                  <button
                    className="btn"
                    onClick={() => setSourcePanelOpen(true)}
                    style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                  >
                    换源
                  </button>
                )}
                {sourcePanelOpen && (
                  <button
                    className="btn"
                    onClick={() => setSourcePanelOpen(false)}
                    style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                  >
                    返回
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => setSidebarOpen(false)}
                  style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                  aria-label="关闭选集"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="episode-list" style={{ padding: "12px 16px" }}>
              {sourcePanelOpen ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sources.map((src) => {
                    const isCurrent =
                      src.site_id === site_id && src.original_id === original_id;
                    return (
                      <button
                        key={`${src.site_id}-${src.original_id}`}
                        className="btn"
                        style={{
                          justifyContent: "flex-start",
                          borderColor: isCurrent ? "var(--primary)" : undefined,
                          fontSize: 13,
                          padding: "10px 12px",
                          minHeight: 44,
                        }}
                        onClick={() => handleSwitchSource(src)}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 2,
                          }}
                        >
                          <span>{src.site_name}</span>
                          <span
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            {src.episode_count}集 · {src.suffix}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  {groupedEpisodes.length > 1 && (
                    <OnboardingHint storageKey="player-lines">
                      同一视频可能有多个播放线路，切换线路可尝试不同播放地址
                    </OnboardingHint>
                  )}
                  {groupedEpisodes.map((group, gi) => (
                    <div key={gi} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--text-muted)",
                          marginBottom: 6,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {group.label}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, 1fr)",
                          gap: 8,
                        }}
                      >
                        {group.eps.map((ep) => (
                          <button
                            key={ep.index}
                            className="btn"
                            style={{
                              borderColor:
                                ep.index === currentIndex
                                  ? "var(--primary)"
                                  : undefined,
                              fontSize: 12,
                              padding: "8px 4px",
                              minHeight: 44,
                            }}
                            onClick={() => handleEpisodeClick(ep.index)}
                          >
                            {ep.ep_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
