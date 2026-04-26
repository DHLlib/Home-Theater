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

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
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
    const playerRef = useRef<any>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [buffering, setBuffering] = useState(false);
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
      getCurrentTime: () => playerRef.current?.time() || 0,
      getDuration: () => playerRef.current?.duration() || 0,
    }));

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

        if (isM3u8) {
          if (Hls.isSupported()) {
            console.log("[VideoPlayer] Hls.js supported, attaching...");
            const hls = new Hls({ debug: false });
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
          hlsRef.current?.destroy();
          hlsRef.current = null;
          player.remove();
          playerRef.current = null;
        };
      } catch (err) {
        console.error("[VideoPlayer] init error:", err);
        const msg = err instanceof Error ? err.message : "播放器初始化异常";
        setError(msg);
        onErrorRef.current?.(msg);
        setBuffering(false);
      }
    }, [src, suffix, autoplay]);

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          background: "#000",
        }}
      >
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
      </div>
    );
  }
);

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
