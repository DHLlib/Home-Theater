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

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ src, suffix = "", autoplay = true, onError, onReady, onEnded }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<Player | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onErrorRef = useRef(onError);
    const onReadyRef = useRef(onReady);
    const onEndedRef = useRef(onEnded);
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
    onEndedRef.current = onEnded;

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

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !src) return;

      setError(null);

      const isM3u8 =
        suffix === "m3u8" || suffix === "ckplayer" || suffix === "ffm3u8";
      const isDirectVideo =
        isM3u8 || suffix === "mp4" || suffix === "webm" || suffix === "";

      if (!isDirectVideo) {
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
          hls: isM3u8
            ? {
                capLevelToPlayerSize: false,
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
          cssFullscreen: true,
          // xgplayer 内置手势和 autoHide，无需额外配置
        });

        playerRef.current = player;

        player.on("playing", () => {
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

        return () => {
          // xgplayer.destroy 内部会暂停视频并清理资源
          player.destroy();
          playerRef.current = null;
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "播放器初始化异常";
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
