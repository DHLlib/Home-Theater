import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import VideoPlayer from "../VideoPlayer";
import type { VideoPlayerHandle } from "../VideoPlayer";

const mockSeek = vi.fn();
const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockDestroy = vi.fn();
const mockSwitchURL = vi.fn();
const mockPlayNext = vi.fn();
const mockOnce = vi.fn();

function createMockPlayer() {
  return {
    seek: mockSeek,
    currentTime: 42,
    duration: 120,
    paused: false,
    play: mockPlay,
    pause: mockPause,
    destroy: mockDestroy,
    switchURL: mockSwitchURL,
    playNext: mockPlayNext,
    on: vi.fn(),
    once: mockOnce,
    off: vi.fn(),
  };
}

vi.mock("xgplayer", () => ({
  default: vi.fn(function () {
    return createMockPlayer();
  }),
}));

vi.mock("xgplayer-hls.js", () => ({
  default: vi.fn(),
}));

describe("VideoPlayer (xgplayer)", () => {
  beforeEach(() => {
    mockSeek.mockClear();
    mockPlay.mockClear();
    mockPause.mockClear();
    mockDestroy.mockClear();
    mockSwitchURL.mockClear();
    mockPlayNext.mockClear();
    mockOnce.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ref 暴露 seekTo / getCurrentTime / getDuration", () => {
    const ref = createRef<VideoPlayerHandle>();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(<VideoPlayer ref={ref} src="http://example.com/video.mp4" suffix="mp4" />, {
      container,
    });

    expect(ref.current).toBeTruthy();
    expect(ref.current!.getCurrentTime()).toBe(42);
    expect(ref.current!.getDuration()).toBe(120);

    ref.current!.seekTo(30);
    expect(mockSeek).toHaveBeenCalledWith(30);

    document.body.removeChild(container);
  });

  it("不支持格式时触发 onError", () => {
    const onError = vi.fn();
    render(
      <VideoPlayer src="http://example.com/video.flv" suffix="flv" onError={onError} />
    );

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("暂不支持"));
  });

  it("错误消息渲染在 DOM 中", () => {
    render(
      <VideoPlayer src="http://example.com/video.flv" suffix="flv" />
    );
    expect(screen.getByText(/暂不支持/)).toBeInTheDocument();
  });

  it("切换 src 时重置播放进度到 0", () => {
    const { rerender } = render(
      <VideoPlayer src="http://example.com/a.mp4" suffix="mp4" />
    );
    rerender(
      <VideoPlayer src="http://example.com/b.mp4" suffix="mp4" />
    );

    expect(mockSwitchURL).toHaveBeenCalledWith("http://example.com/b.mp4");
    expect(mockSeek).toHaveBeenCalledWith(0);
    expect(mockOnce).toHaveBeenCalledWith("canplay", expect.any(Function));
  });
});
