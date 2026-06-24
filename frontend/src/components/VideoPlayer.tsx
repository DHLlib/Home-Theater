import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Player from "xgplayer";
import "xgplayer/dist/index.min.css";
import HlsJsPlugin from "xgplayer-hls.js";

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
}

interface FormatInfo {
  isM3u8: boolean;
  isDirectVideo: boolean;
}

const _UNSUPPORTED_SUFFIXES = new Set([
  "flv",
  "rmvb",
  "rm",
  "avi",
  "wmv",
  "mpeg",
  "mpg",
  "dat",
  "vob",
  "swf",
]);

function analyzeFormat(src: string, suffix: string): FormatInfo {
  const suffixLower = suffix.toLowerCase();
  const urlLower = src.toLowerCase();
  const isM3u8 =
    suffixLower === "m3u8" ||
    suffixLower === "ckplayer" ||
    suffixLower === "ffm3u8" ||
    suffixLower.endsWith("m3u8") ||
    suffixLower.endsWith("yun") ||
    urlLower.endsWith(".m3u8") ||
    urlLower.includes(".m3u8?");
  const isDirectVideo =
    suffixLower === "" ||
    (!isM3u8 && !_UNSUPPORTED_SUFFIXES.has(suffixLower));
  return { isM3u8, isDirectVideo };
}

function lockMaxQuality(player: Player, timerRef: React.MutableRefObject<number | null>) {
  if (timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  const tryLock = () => {
    try {
      const p = player as any;
      const hlsPlugin = p.getPlugin?.("hlsJs") || p.plugins?.hlsJs || p.hls;
      const hls = hlsPlugin?.hls || hlsPlugin?.core || hlsPlugin;
      if (hls && Array.isArray(hls.levels) && hls.levels.length > 1) {
        hls.currentLevel = hls.levels.length - 1;
        return true;
      }
    } catch {
      // 单码率流或插件结构不同，忽略
    }
    return false;
  };

  if (tryLock()) return;

  let attempts = 0;
  timerRef.current = window.setInterval(() => {
    if (tryLock() || ++attempts > 50) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, 100);
}

function seekToStart(player: Player) {
  // 切换源后立即重置一次，若此时新源尚未可播放，
  // 则在 canplay 事件后再重置一次，确保不继承上一集的进度。
  player.seek(0);
  const handleCanPlay = () => {
    player.seek(0);
    (player as any).off?.("canplay", handleCanPlay);
  };
  if (typeof (player as any).once === "function") {
    (player as any).once("canplay", handleCanPlay);
  } else if (typeof (player as any).on === "function") {
    (player as any).on("canplay", handleCanPlay);
  }
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ src, suffix = "", autoplay = true, onError, onReady, onEnded }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<Player | null>(null);
    const qualityTimerRef = useRef<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onErrorRef = useRef(onError);
    const onReadyRef = useRef(onReady);
    const onEndedRef = useRef(onEnded);
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
    onEndedRef.current = onEnded;

    const prevSrcRef = useRef(src);
    const prevSuffixRef = useRef(suffix);
    const prevAutoplayRef = useRef(autoplay);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        playerRef.current?.seek(seconds);
      },
      getCurrentTime: () => playerRef.current?.currentTime || 0,
      getDuration: () => playerRef.current?.duration || 0,
      play: () => {
        playerRef.current?.play();
      },
      pause: () => {
        playerRef.current?.pause();
      },
      togglePlay: () => {
        const p = playerRef.current;
        if (!p) return true;
        if (p.paused) {
          p.play();
          return false;
        } else {
          p.pause();
          return true;
        }
      },
    }));

    // 组件卸载时统一清理
    useEffect(() => {
      return () => {
        if (qualityTimerRef.current) {
          clearInterval(qualityTimerRef.current);
          qualityTimerRef.current = null;
        }
        playerRef.current?.destroy();
        playerRef.current = null;
      };
    }, []);

    // 首次有有效 src 时创建播放器
    // 之前如果 src 为空（加载中），这里会在拿到真实地址后补上初始化
    useEffect(() => {
      const container = containerRef.current;
      if (!container || !src || playerRef.current) return;

      const { isM3u8, isDirectVideo } = analyzeFormat(src, suffix);
      if (!isM3u8 && !isDirectVideo) {
        const msg = `暂不支持播放该格式 (${suffix})`;
        setError(msg);
        onErrorRef.current?.(msg);
        return;
      }

      try {
        const player = new Player({
          el: container,
          url: src,
          plugins: isM3u8 ? [HlsJsPlugin] : [],
          autoplay,
          width: "100%",
          height: "100%",
          videoFillMode: "auto",
          hlsJsPlugin: isM3u8
            ? {
                hlsOpts: {
                  capLevelToPlayerSize: false,
                  // 预加载缓冲上限约 10 分钟，同时放宽缓冲区大小限制
                  maxBufferLength: 600,
                  maxMaxBufferLength: 600,
                  maxBufferSize: 500 * 1024 * 1024,
                },
              }
            : undefined,
          videoAttributes: {
            "x5-video-player-type": "h5",
            "x5-video-player-fullscreen": "true",
            "x5-playsinline": "",
            playsinline: "",
            "webkit-playsinline": "",
          },
          playsinline: true,
          cssFullscreen: false,
        });

        playerRef.current = player;
        prevSrcRef.current = src;
        prevSuffixRef.current = suffix;
        prevAutoplayRef.current = autoplay;
        setError(null);

        if (isM3u8) {
          lockMaxQuality(player, qualityTimerRef);
        }

        player.on("ready", () => {
          onReadyRef.current?.();
        });

        player.on("error", (err: any) => {
          const msg =
            err?.errorType || err?.message || err?.msg || "视频加载失败";
          setError(msg);
          onErrorRef.current?.(msg);
        });

        player.on("ended", () => {
          onEndedRef.current?.();
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "播放器初始化异常";
        setError(msg);
        onErrorRef.current?.(msg);
      }
    }, [src, suffix, autoplay]);

    // 播放器已存在时，src/suffix/autoplay 变化直接复用实例切换
    useEffect(() => {
      const player = playerRef.current;
      if (!player || !src) return;

      const isSameSource =
        src === prevSrcRef.current && suffix === prevSuffixRef.current;
      if (isSameSource) {
        if (autoplay !== prevAutoplayRef.current) {
          if (autoplay) {
            player.play();
          } else {
            player.pause();
          }
          prevAutoplayRef.current = autoplay;
        }
        return;
      }

      const { isM3u8, isDirectVideo } = analyzeFormat(src, suffix);
      if (!isM3u8 && !isDirectVideo) {
        const msg = `暂不支持播放该格式 (${suffix})`;
        setError(msg);
        onErrorRef.current?.(msg);
        player.pause?.();
        return;
      }

      const prevIsM3u8 = analyzeFormat(
        prevSrcRef.current,
        prevSuffixRef.current
      ).isM3u8;

      try {
        setError(null);
        if (isM3u8 === prevIsM3u8) {
          player.switchURL(src);
        } else {
          player.playNext({
            url: src,
            plugins: isM3u8 ? [HlsJsPlugin] : [],
            autoplay,
          });
        }

        seekToStart(player);

        if (isM3u8) {
          lockMaxQuality(player, qualityTimerRef);
        }

        prevSrcRef.current = src;
        prevSuffixRef.current = suffix;
        prevAutoplayRef.current = autoplay;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "播放器切换源失败";
        setError(msg);
        onErrorRef.current?.(msg);
      }
    }, [src, suffix, autoplay]);

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          background: "#000",
        }}
      >
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
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
      </div>
    );
  }
);

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
