import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Drawer } from "vaul";
import { getEpisodes, getSources } from "../api/play";
import { getProgress, upsertProgress } from "../api/progress";
import type { VideoPlayerHandle } from "../components/VideoPlayer";
import { getCachedEpisodes, setCachedEpisodes } from "../utils/cache";
import { useFullscreen } from "../hooks/useFullscreen";
import { useIsMobile } from "../hooks/useViewport";
import OnboardingHint from "../components/OnboardingHint";
import {
  ArrowLeftIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  ListIcon,
} from "../components/icons";
import type { Episode, PlayProgress, PlaySource } from "../types";

// 按需加载播放器：xgplayer + xgplayer-hls.js 体积较大，仅进播放页时才加载
const VideoPlayer = lazy(() => import("../components/VideoPlayer"));

const DOUBLE_TAP_THRESHOLD = 300;
const SWIPE_UP_THRESHOLD = 60;
const TAP_MAX_MOVE = 10;
const SEEK_SECONDS = 10;
const CONTROLS_HIDE_DELAY = 3000;

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
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyDownTime = useRef<Record<string, number>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const passedConsumedRef = useRef(false);
  const userPickedRef = useRef(false);

  // 手势触摸记录
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const { isFullscreen, isFakeLandscape, isSimulatedFullscreen, toggleFullscreen } = useFullscreen();
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  // 自动隐藏控制层
  const resetControlsTimer = useCallback(() => {
    if (controlsTimer.current) {
      clearTimeout(controlsTimer.current);
    }
    setControlsVisible(true);
    controlsTimer.current = setTimeout(() => {
      if (!sidebarOpenRef.current) {
        setControlsVisible(false);
      }
    }, CONTROLS_HIDE_DELAY);
  }, []);

  // 进入移动端时自动收起选集，避免全屏方向变化导致选集被重新打开后遮挡视频
  useEffect(() => {
    if (isMobile && sidebarOpenRef.current) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  // 初始化控制层定时器
  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
    };
  }, [resetControlsTimer]);

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
    getEpisodes(site_id, original_id)
      .then((eps) => {
        setEpisodes(eps);
        setCachedEpisodes(site_id, original_id, eps);
      })
      .catch(() => {
        // API 失败时保持已有缓存/传入数据，不阻断播放
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

  // 切换视频/来源时重置进度恢复标记，避免跨视频保留 true
  useEffect(() => {
    setProgressRestored(false);
  }, [title, year, site_id, original_id]);

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
      userPickedRef.current = true;
      setProgressRestored(true);
      return;
    }

    getProgress(title, year)
      .then((res: PlayProgress | null) => {
        if (userPickedRef.current) {
          setProgressRestored(true);
          return;
        }
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
        setProgressRestored(true);
      })
      .catch(() => {
        setProgressRestored(true);
      });
  }, [title, year, site_id, original_id, episodes, progressRestored, initialEp]);

  useEffect(() => {
    if (!current) return;

    const saveProgress = (beacon = false) => {
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
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/progress",
          new Blob([data], { type: "application/json" })
        );
      } else {
        upsertProgress(JSON.parse(data)).catch(() => {});
      }
    };

    progressTimer.current = setInterval(() => saveProgress(false), 15000);

    const handleBeforeUnload = () => saveProgress(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveProgress(true);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // 正常路由跳转（如点击返回）时强制保存最终进度
      saveProgress(true);
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

  // 键盘控制
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
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON" ||
        target.tagName === "A" ||
        target.isContentEditable
      )
        return;

      // 空格键：播放/暂停
      if (e.key === " ") {
        e.preventDefault();
        const video = playerRef.current;
        if (video) {
          if (video.getPaused()) {
            video.play();
          } else {
            video.pause();
          }
        }
        resetControlsTimer();
        return;
      }

      // F 键：全屏
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen(playerContainerRef.current);
        resetControlsTimer();
        return;
      }

      // Esc 键：退出全屏或关闭面板
      if (e.key === "Escape") {
        if (sidebarOpen) {
          setSidebarOpen(false);
        }
        resetControlsTimer();
        return;
      }

      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      // 仅当焦点在播放器容器内或为 body 时拦截，避免劫持页面其他焦点元素
      if (target !== document.body && !containerRef.current?.contains(target))
        return;
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

      resetControlsTimer();
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
  }, [sidebarOpen, toggleFullscreen, resetControlsTimer]);

  const handleEnded = () => {
    if (currentIndex < episodes.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleToggleFullscreen = useCallback(() => {
    toggleFullscreen(playerContainerRef.current);
    resetControlsTimer();
  }, [toggleFullscreen, resetControlsTimer]);

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
      userPickedRef.current = true;
      setCurrentIndex(index);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile]
  );

  // 移动端手势：双击快进/快退，上滑打开选集
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || !touchStartRef.current) return;
    const start = touchStartRef.current;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    touchStartRef.current = null;

    // 滑动：上滑打开选集
    if (dy < -SWIPE_UP_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      setSidebarOpen(true);
      return;
    }

    // 点击：检测双击
    if (Math.abs(dx) < TAP_MAX_MOVE && Math.abs(dy) < TAP_MAX_MOVE && dt < 400) {
      const now = Date.now();
      const width = (e.currentTarget as HTMLElement).clientWidth;
      const xRatio = t.clientX / width;
      if (
        lastTapRef.current &&
        now - lastTapRef.current.t < DOUBLE_TAP_THRESHOLD &&
        Math.abs(t.clientX - lastTapRef.current.x) < TAP_MAX_MOVE &&
        Math.abs(t.clientY - lastTapRef.current.y) < TAP_MAX_MOVE
      ) {
        lastTapRef.current = null;
        const delta = xRatio < 0.5 ? -SEEK_SECONDS : SEEK_SECONDS;
        const video = playerRef.current;
        if (!video) return;
        const next = Math.max(
          0,
          Math.min(
            video.getCurrentTime() + delta,
            video.getDuration() || 0
          )
        );
        video.seekTo(next);
      } else {
        lastTapRef.current = { x: t.clientX, y: t.clientY, t: now };
      }
    }
    resetControlsTimer();
  };

  // 鼠标移动显示控制层
  const handleMouseMove = () => {
    resetControlsTimer();
  };

  if (!site_id || !original_id) {
    return <div className="empty">参数缺失</div>;
  }

  const showControls = controlsVisible || sidebarOpen;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="player-layout"
      style={{
        minHeight: 0,
        position: "relative",
      }}
      onMouseMove={handleMouseMove}
      onClick={resetControlsTimer}
    >
      {/* 返回按钮 - 控制层显示时可见 */}
      <button
        className="btn"
        onClick={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else {
            navigate("/");
          }
        }}
        style={{
          position: "absolute",
          top: "max(8px, env(safe-area-inset-top))",
          left: "max(8px, env(safe-area-inset-left))",
          zIndex: 10,
          padding: "8px 12px",
          fontSize: 13,
          background: "rgba(0,0,0,0.7)",
          border: "1px solid var(--border)",
          opacity: showControls ? 1 : 0,
          transform: showControls ? "translateY(0)" : "translateY(-8px)",
          transition: "opacity var(--transition-base), transform var(--transition-base)",
          pointerEvents: showControls ? "auto" : "none",
          gap: 4,
        }}
        aria-label="返回"
      >
        <ArrowLeftIcon size={16} />
        返回
      </button>

      {/* 左侧：播放器 + 控制条 */}
      <div className="player-main" ref={playerContainerRef}>
        <div
          className={`player-video-wrap ${isSimulatedFullscreen ? "simulated-fullscreen" : ""} ${isFakeLandscape ? "fake-landscape" : ""}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: "manipulation" }}
        >
          <Suspense fallback={<div className="spinner" style={{ margin: "auto" }} />}>
            <VideoPlayer
              ref={playerRef}
              src={current?.url || ""}
              suffix={current?.suffix || ""}
              autoplay
              onError={() => {}}
              onEnded={handleEnded}
            />
          </Suspense>

          {/* 中央播放/暂停大按钮 */}
          {showControls && (
            <button
              onClick={() => {
                const video = playerRef.current;
                if (video) {
                  if (video.getPaused()) {
                    video.play();
                    setIsPlaying(true);
                  } else {
                    video.pause();
                    setIsPlaying(false);
                  }
                }
                resetControlsTimer();
              }}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                border: "1px solid var(--border-hover)",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                opacity: showControls ? 1 : 0,
                transition: "opacity var(--transition-base)",
                zIndex: 5,
              }}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <PauseIcon size={28} />
              ) : (
                <PlayIcon size={28} style={{ marginLeft: 2 }} />
              )}
            </button>
          )}
        </div>

        {/* 底部控制条 */}
        <div
          className="row player-controls-bar"
          style={{
            justifyContent: "space-between",
            padding: "10px 0",
            flexShrink: 0,
            flexWrap: "wrap",
            rowGap: 8,
            opacity: showControls ? 1 : 0,
            transform: showControls ? "translateY(0)" : "translateY(8px)",
            transition: "opacity var(--transition-base), transform var(--transition-base)",
            pointerEvents: showControls ? "auto" : "none",
          }}
        >
          <button
            className="btn"
            disabled={currentIndex <= 0}
            onClick={() => {
              userPickedRef.current = true;
              setCurrentIndex((i) => i - 1);
            }}
            style={{
              minHeight: isMobile ? 48 : 40,
              minWidth: isMobile ? 48 : 40,
              padding: "8px 12px",
              gap: 4,
            }}
          >
            <SkipBackIcon size={16} />
            上一集
          </button>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {current
              ? `${current.ep_name} (${current.suffix})`
              : "加载中..."}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {/* 移动端选集按钮 */}
            {isMobile && (
              <button
                className="btn"
                onClick={() => setSidebarOpen(true)}
                style={{ minHeight: 48, minWidth: 48, padding: "8px 12px", fontSize: 13, gap: 4 }}
              >
                <ListIcon size={16} />
                选集
              </button>
            )}
            <button
              className="btn"
              onClick={handleToggleFullscreen}
              style={{ minHeight: 48, minWidth: 48, padding: "8px 12px", fontSize: 13, gap: 4 }}
              aria-label={isFullscreen || isSimulatedFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen || isSimulatedFullscreen ? (
                <>
                  <MinimizeIcon size={16} />
                  退出全屏
                </>
              ) : (
                <>
                  <MaximizeIcon size={16} />
                  全屏
                </>
              )}
            </button>
            <button
              className="btn"
              disabled={currentIndex >= episodes.length - 1}
              onClick={() => {
                userPickedRef.current = true;
                setCurrentIndex((i) => i + 1);
              }}
              style={{
                minHeight: isMobile ? 48 : 40,
                minWidth: isMobile ? 48 : 40,
                padding: "8px 12px",
                gap: 4,
              }}
            >
              下一集
              <SkipForwardIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 桌面端：右侧 sidebar */}
      {!isMobile && sidebarOpen && (
        <div className="episode-sidebar" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 12,
        }}>
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
            opacity: showControls ? 1 : 0,
            transition: "opacity var(--transition-base)",
          }}
          aria-label="展开选集"
        >
          选集
        </button>
      )}

      {/* 移动端：vaul 底部选集抽屉 */}
      {isMobile && (
        <Drawer.Root
          open={sidebarOpen}
          onOpenChange={(nextOpen) => setSidebarOpen(nextOpen)}
          direction="bottom"
        >
          <Drawer.Portal>
            <Drawer.Overlay
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.8)",
                zIndex: 999,
              }}
              onClick={() => setSidebarOpen(false)}
            />
            <Drawer.Content
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                maxHeight: "70vh",
                background: "var(--bg-elevated)",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                border: "1px solid var(--border)",
                borderBottom: "none",
              }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  flexShrink: 0,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
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
                      style={{ padding: "4px 8px", minHeight: 44, fontSize: 12 }}
                    >
                      换源
                    </button>
                  )}
                  {sourcePanelOpen && (
                    <button
                      className="btn"
                      onClick={() => setSourcePanelOpen(false)}
                      style={{ padding: "4px 8px", minHeight: 44, fontSize: 12 }}
                    >
                      返回
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => setSidebarOpen(false)}
                    style={{ padding: "4px 8px", minHeight: 44, fontSize: 12 }}
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
                            minHeight: 48,
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
                                minHeight: 48,
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
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </div>
  );
}
