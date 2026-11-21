import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Player from "../Player";
import { queuePlaybackEvent } from "../../utils/playbackTelemetry";

const episodes = vi.hoisted(() => [
  {
    ep_name: "第1集",
    url: "https://example.test/1.m3u8",
    suffix: "ffm3u8",
    index: 0,
  },
]);

vi.mock("../../api/play", () => ({
  getEpisodes: vi.fn().mockResolvedValue(episodes),
}));

vi.mock("../../api/settings", () => ({
  getStreamAccel: vi.fn().mockResolvedValue({ enabled: false }),
}));

vi.mock("../../api/progress", () => ({
  getProgress: vi.fn().mockResolvedValue(null),
  upsertProgress: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../utils/cache", () => ({
  getCachedEpisodes: vi.fn().mockResolvedValue(null),
  setCachedEpisodes: vi.fn(),
}));

vi.mock("../../hooks/usePlaySources", () => ({
  usePlaySources: () => ({ data: { sources: [] } }),
}));

vi.mock("../../hooks/useFullscreen", () => ({
  useFullscreen: () => ({
    isFullscreen: false,
    isFakeLandscape: false,
    isSimulatedFullscreen: false,
    toggleFullscreen: vi.fn(),
  }),
}));

vi.mock("../../hooks/useViewport", () => ({
  useIsMobile: () => false,
}));

vi.mock("../../utils/playbackTelemetry", () => ({
  createPlaybackId: vi.fn(() => "test-id"),
  flushPlaybackEvents: vi.fn(),
  queuePlaybackEvent: vi.fn(),
}));

vi.mock("../../components/VideoPlayer", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({
        seekTo: vi.fn(),
        getCurrentTime: () => 0,
        getDuration: () => 0,
        play: vi.fn(),
        pause: vi.fn(),
        togglePlay: () => true,
        getPaused: () => true,
      }));
      return <div data-testid="video-player" />;
    }),
  };
});

describe("Player playback telemetry", () => {
  beforeEach(() => {
    vi.mocked(queuePlaybackEvent).mockClear();
  });

  it("严格模式下同一来源同一集只记录一次播放尝试", async () => {
    render(
      <StrictMode>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/player",
              search: "?site_id=1&original_id=good-1&title=示例作品&year=2024&ep=0",
              state: { episodes },
            },
          ]}
        >
          <Routes>
            <Route path="/player" element={<Player />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>
    );

    await screen.findByTestId("video-player");
    await waitFor(() => {
      expect(queuePlaybackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: "attempt" })
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const attempts = vi
      .mocked(queuePlaybackEvent)
      .mock.calls.filter(([event]) => event.event_type === "attempt");
    expect(attempts).toHaveLength(1);
  });
});
