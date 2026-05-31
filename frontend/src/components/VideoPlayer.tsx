import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import CKPlayer from "ckplayer";
import "ckplayer/css/ckplayer.css";
import Hls from "hls.js";
import GestureOverlay from "./GestureOverlay";
import SeekFeedback from "./SeekFeedback";
import { usePlayerGestures } from "../hooks/usePlayerGestures";
import { useAutoHide } from "../hooks/useAutoHide";

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  play: () => void;
  pause: () => void;
  togglePlay: () => boolean;
}

interface VideoPlayerProps {
  src: string;
  suffix?: string;
  autoplay?: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
  onEnded?: () => void;
  /** 外部控制控制栏显隐（ckplayer 自带控制栏通过 CSS opacity 控制） */
  controlsVisible?: boolean;
  /** 是否禁用手势（如选集抽屉打开时） */
  gesturesDisabled?: boolean;
  /** 全屏状态，用于 autoHide 延迟 */
  isFullscreen?: boolean;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  (
    {
      src,
      suffix = "",
      autoplay = true,
      onError,
      onReady,
      onEnded,
      controlsVisible: externalControlsVisible,
      gesturesDisabled,
      isFullscreen = false,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const hlsRef = useRef<Hls | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [buffering, setBuffering] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [seekDirection, setSeekDirection] = useState<"left" | "right" | null>(null);
    const [seekVisible, setSeekVisible] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);

    const onErrorRef = useRef(onError);
    const onReadyRef = useRef(onReady);
    const onEndedRef = useRef(onEnded);
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
    onEndedRef.current = onEnded;

    // 外部控制栏显隐优先
    const effectiveControlsVisible =
      externalControlsVisible !== undefined ? externalControlsVisible : controlsVisible;

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        playerRef.current?.seek(seconds);
      },
      getCurrentTime: () => playerRef.current?.time() || 0,
      getDuration: () => playerRef.current?.duration() || 0,
      play: () => {
        videoRef.current?.play().catch(() => {});
      },
      pause: () => {
        videoRef.current?.pause();
      },
      togglePlay: () => {
        const video = videoRef.current;
        if (!video) return true;
        if (video.paused) {
          video.play().catch(() => {});
          return false;
        } else {
          video.pause();
          return true;
        }
      },
    }));

    // 控制栏 autoHide
    const autoHide = useAutoHide({
      isFullscreen,
      onShow: () => setControlsVisible(true),
      onHide: () => setControlsVisible(false),
    });

    // 手势识别
    const gestureHandlers = usePlayerGestures({
      disabled: gesturesDisabled,
      onDoubleTap: () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
        autoHide.showControls();
      },
      onSwipe: (direction) => {
        const video = videoRef.current;
        if (!video) return;
        const delta = direction === "right" ? 10 : -10;
        const next = Math.max(
          0,
          Math.min(video.currentTime + delta, video.duration || 0)
        );
        playerRef.current?.seek(next);
        setSeekDirection(direction);
        setSeekVisible(true);
        setTimeout(() => setSeekVisible(false), 800);
        autoHide.showControls();
      },
      onSingleTap: () => {
        if (effectiveControlsVisible) {
          autoHide.hideControls();
        } else {
          autoHide.showControls();
        }
      },
    });

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !src) {
        console.log("[VideoPlayer] skip init: no container or no src");
        return;
      }

      console.log("[VideoPlayer] init start", { src, suffix, autoplay });
      setError(null);
      setBuffering(true);

      try {
        const isM3u8 =
          suffix === "m3u8" || suffix === "ckplayer" || suffix === "ffm3u8";
        const isDirectVideo =
          isM3u8 || suffix === "mp4" || suffix === "webm" || suffix === "";

        if (!isDirectVideo) {
          console.log("[VideoPlayer] unsupported suffix:", suffix);
          const msg = `暂不支持播放该格式 (${suffix})`;
          setError(msg);
          onErrorRef.current?.(msg);
          setBuffering(false);
          return;
        }

        const player = new CKPlayer({
          container,
          video: isM3u8 ? "" : src,
          autoplay,
        });
        playerRef.current = player;
        console.log("[VideoPlayer] ckplayer created");

        const video = container.querySelector("video") as HTMLVideoElement | null;
        console.log("[VideoPlayer] video element:", video ? "found" : "NOT FOUND");
        if (!video) {
          setError("播放器初始化失败");
          onErrorRef.current?.("播放器初始化失败");
          setBuffering(false);
          player.remove();
          playerRef.current = null;
          return;
        }
        videoRef.current = video;

        if (isM3u8) {
          video.preload = "auto";
          if (Hls.isSupported()) {
            console.log("[VideoPlayer] Hls.js supported, attaching...");
            const hls = new Hls({
              debug: false,
              autoStartLoad: true,
              maxBufferLength: 60,
              maxMaxBufferLength: 120,
              maxBufferSize: 60 * 1000 * 1000,
              backBufferLength: 30,
              maxBufferHole: 2.0,
              highBufferWatchdogPeriod: 2,
              nudgeOffset: 0.3,
              nudgeMaxRetry: 10,
              fragLoadingMaxRetry: 6,
              fragLoadingRetryDelay: 500,
              levelLoadingMaxRetry: 4,
              levelLoadingRetryDelay: 500,
              manifestLoadingMaxRetry: 4,
              manifestLoadingRetryDelay: 500,
              startFragPrefetch: true,
              enableWorker: true,
            });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
              console.log("[VideoPlayer] HLS manifest parsed, levels:", data.levels.length);
              video.play().catch((e) => {
                console.log("[VideoPlayer] autoplay blocked:", e.message);
              });
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              console.log("[VideoPlayer] HLS error:", data.type, data.details, "fatal:", data.fatal);
              if (data.fatal) {
                const msg = "视频加载失败 (HLS)";
                setError(msg);
                onErrorRef.current?.(msg);
                setBuffering(false);
              }
            });
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            console.log("[VideoPlayer] native HLS support detected");
            video.src = src;
            video.play().catch(() => {});
          } else {
            console.log("[VideoPlayer] HLS not supported");
            const msg = "当前浏览器不支持播放该视频格式";
            setError(msg);
            onErrorRef.current?.(msg);
            setBuffering(false);
          }
        }

        const handleWaiting = () => {
          console.log("[VideoPlayer] event: waiting");
          setBuffering(true);
        };
        const handlePlaying = () => {
          console.log("[VideoPlayer] event: playing");
          setBuffering(false);
          onReadyRef.current?.();
        };
        const handleCanPlay = () => {
          console.log("[VideoPlayer] event: canplay");
          setBuffering(false);
        };
        const handleLoadStart = () => {
          console.log("[VideoPlayer] event: loadstart");
        };
        const handleLoadedMetadata = () => {
          console.log("[VideoPlayer] event: loadedmetadata, duration:", video.duration);
        };
        const handleError = () => {
          const ve = video.error;
          console.log("[VideoPlayer] event: error, code:", ve?.code, "message:", ve?.message);
          const msg = "视频加载失败";
          setError(msg);
          onErrorRef.current?.(msg);
          setBuffering(false);
        };
        const handleStalled = () => {
          console.log("[VideoPlayer] event: stalled");
          setBuffering(true);
        };
        const handleEnded = () => {
          console.log("[VideoPlayer] event: ended");
          onEndedRef.current?.();
        };
        const handleTimeUpdate = () => {
          // 只在开发环境偶尔输出，避免刷屏
        };

        video.addEventListener("waiting", handleWaiting);
        video.addEventListener("playing", handlePlaying);
        video.addEventListener("canplay", handleCanPlay);
        video.addEventListener("loadstart", handleLoadStart);
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("error", handleError);
        video.addEventListener("stalled", handleStalled);
        video.addEventListener("ended", handleEnded);
        video.addEventListener("timeupdate", handleTimeUpdate);

        return () => {
          console.log("[VideoPlayer] cleanup");
          video.removeEventListener("waiting", handleWaiting);
          video.removeEventListener("playing", handlePlaying);
          video.removeEventListener("canplay", handleCanPlay);
          video.removeEventListener("loadstart", handleLoadStart);
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          video.removeEventListener("error", handleError);
          video.removeEventListener("stalled", handleStalled);
          video.removeEventListener("ended", handleEnded);
          video.removeEventListener("timeupdate", handleTimeUpdate);
          // 先暂停并释放 video，避免后台继续播放音频
          try {
            video.pause();
            video.src = "";
            video.load();
          } catch {
            // 忽略
          }
          hlsRef.current?.destroy();
          hlsRef.current = null;
          player.remove();
          playerRef.current = null;
          videoRef.current = null;
        };
      } catch (err) {
        console.error("[VideoPlayer] init error:", err);
        const msg = err instanceof Error ? err.message : "播放器初始化异常";
        setError(msg);
        onErrorRef.current?.(msg);
        setBuffering(false);
      }
    }, [src, suffix, autoplay]);

    // 同步控制栏显隐到 ckplayer 控制栏
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const controls = container.querySelector(
        ".ckplayer-controls, .ck-control-bar, .ck-controls"
      ) as HTMLElement | null;
      if (controls) {
        controls.style.opacity = effectiveControlsVisible ? "1" : "0";
        controls.style.pointerEvents = effectiveControlsVisible ? "auto" : "none";
        controls.style.transition = "opacity 300ms ease";
      }
    }, [effectiveControlsVisible]);

    return (
      <GestureOverlay gestureHandlers={gestureHandlers}>
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            background: "#000",
          }}
        >
          {/* ckplayer 独占此容器，React 不往里面渲染任何内容 */}
          <div
            ref={containerRef}
            style={{ width: "100%", height: "100%" }}
          />
          {/* React 管理的 overlay 作为 sibling，避免与 ckplayer DOM 冲突 */}
          {buffering && !error && (
            <div className="spinner-overlay">
              <div className="spinner" />
            </div>
          )}
          {error && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--danger)",
                fontSize: 14,
                padding: 16,
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}
          <SeekFeedback direction={seekDirection} visible={seekVisible} />
        </div>
      </GestureOverlay>
    );
  }
);

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
