import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlaybackFeatureSettings from "../PlaybackFeatureSettings";

const mocks = vi.hoisted(() => ({
  getPlaybackFeatures: vi.fn(),
  updatePlaybackFeatures: vi.fn(),
}));

vi.mock("../../api/settings", () => ({
  getPlaybackFeatures: mocks.getPlaybackFeatures,
  updatePlaybackFeatures: mocks.updatePlaybackFeatures,
}));

const features = {
  media_analysis: true,
  playback_guard: true,
  enhancement: false,
  enhancement_available: false,
  algorithm: "Lanczos + Unsharp",
  target_height: 1080,
};

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlaybackFeatureSettings />
    </QueryClientProvider>
  );
}

describe("播放与画质设置", () => {
  beforeEach(() => {
    mocks.getPlaybackFeatures.mockResolvedValue(features);
    mocks.updatePlaybackFeatures.mockImplementation(async (changes) => ({
      ...features,
      ...changes,
    }));
  });

  it("开关修改后只保存变更项", async () => {
    renderSettings();
    const guard = await screen.findByRole("switch", { name: "播放保护" });
    await userEvent.click(guard);
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(mocks.updatePlaybackFeatures.mock.calls[0][0]).toEqual({
        playback_guard: false,
      });
    });
  });

  it("ffmpeg 不可用时禁用增强并说明原因", async () => {
    renderSettings();
    const enhancement = await screen.findByRole("switch", {
      name: "轻量画质增强",
    });
    expect(enhancement).toBeDisabled();
    expect(screen.getByText(/未安装 ffmpeg/)).toBeInTheDocument();
  });
});
