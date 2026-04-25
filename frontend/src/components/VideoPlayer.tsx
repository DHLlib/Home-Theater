import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import CKPlayer from "ckplayer";

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}

interface VideoPlayerProps {
  src: string;
  autoplay?: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
  onEnded?: () => void;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ src, autoplay = true, onError, onReady, onEnded }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<CKPlayer | null>(null);
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
        const video = playerRef.current?.video;
        if (video) {
          video.currentTime = Math.max(
            0,
            Math.min(seconds, video.duration || seconds)
          );
        }
      },
      getCurrentTime: () => playerRef.current?.video?.currentTime || 0,
      getDuration: () => playerRef.current?.video?.duration || 0,
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      setError(null);
      setBuffering(true);

      try {
        const player = new CKPlayer({
          container,
          video: src,
          autoplay,
          html5m3u8: true,
        });
        playerRef.current = player;

        const video = player.video;
        if (!video) {
          setError("播放器初始化失败");
          onError?.("播放器初始化失败");
          setBuffering(false);
          return;
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
          player.remove();
          playerRef.current = null;
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "播放器初始化异常";
        setError(msg);
        onErrorRef.current?.(msg);
        setBuffering(false);
      }
    }, [src, autoplay]);

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
