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
      if (!container || !src) return;

      setError(null);
      setBuffering(true);

      try {
        const isM3u8 =
          suffix === "m3u8" || suffix === "ckplayer" || suffix === "ffm3u8";

        const player = new CKPlayer({
          container,
          video: isM3u8 ? "" : src,
          autoplay,
        });
        playerRef.current = player;

        const video = container.querySelector("video") as HTMLVideoElement | null;
        if (!video) {
          setError("播放器初始化失败");
          onErrorRef.current?.("播放器初始化失败");
          setBuffering(false);
          player.remove();
          playerRef.current = null;
          return;
        }

        if (isM3u8 && Hls.isSupported()) {
          const hls = new Hls();
          hlsRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              const msg = "视频加载失败 (HLS)";
              setError(msg);
              onErrorRef.current?.(msg);
              setBuffering(false);
            }
          });
        }

        const handleWaiting = () => setBuffering(true);
        const handlePlaying = () => {
          setBuffering(false);
          onReadyRef.current?.();
        };
        const handleCanPlay = () => setBuffering(false);
        const handleError = () => {
          const msg = "视频加载失败";
          setError(msg);
          onErrorRef.current?.(msg);
          setBuffering(false);
        };
        const handleStalled = () => setBuffering(true);
        const handleEnded = () => onEndedRef.current?.();

        video.addEventListener("waiting", handleWaiting);
        video.addEventListener("playing", handlePlaying);
        video.addEventListener("canplay", handleCanPlay);
        video.addEventListener("error", handleError);
        video.addEventListener("stalled", handleStalled);
        video.addEventListener("ended", handleEnded);

        return () => {
          video.removeEventListener("waiting", handleWaiting);
          video.removeEventListener("playing", handlePlaying);
          video.removeEventListener("canplay", handleCanPlay);
          video.removeEventListener("error", handleError);
          video.removeEventListener("stalled", handleStalled);
          video.removeEventListener("ended", handleEnded);
          hlsRef.current?.destroy();
          hlsRef.current = null;
          player.remove();
          playerRef.current = null;
        };
      } catch (err) {
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
