import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoMediaAnalysis } from "../usePlaySources";

const mocks = vi.hoisted(() => ({
  analyzeSources: vi.fn(),
  getSources: vi.fn(),
}));

vi.mock("../../api/play", () => ({
  analyzeSources: mocks.analyzeSources,
  getSources: mocks.getSources,
}));

function AutoAnalysis({ enabled }: { enabled: boolean }) {
  const { analyzing } = useAutoMediaAnalysis("示例", 2026, enabled);
  return <span>{analyzing ? "分析中" : "完成"}</span>;
}

function renderAuto(enabled = true, strict = false) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {strict ? (
        <StrictMode>
          <AutoAnalysis enabled={enabled} />
        </StrictMode>
      ) : (
        <AutoAnalysis enabled={enabled} />
      )}
    </QueryClientProvider>
  );
}

describe("详情自动媒体分析", () => {
  beforeEach(() => {
    mocks.analyzeSources.mockReset();
  });

  it("自动逐批处理直到完成，StrictMode 下也不会失控重复", async () => {
    mocks.analyzeSources
      .mockResolvedValueOnce({
        sources: [], analyzed: 2, next_offset: 2, total: 3, remaining: 1,
      })
      .mockResolvedValueOnce({
        sources: [], analyzed: 2, next_offset: 3, total: 3, remaining: 0,
      });

    renderAuto(true, true);

    await waitFor(() => {
      expect(mocks.analyzeSources).toHaveBeenCalledTimes(2);
      expect(screen.getByText("完成")).toBeInTheDocument();
    });
    expect(mocks.analyzeSources.mock.calls.map((call) => call[2])).toEqual([0, 2]);
  });

  it("设置关闭时不发起分析", () => {
    renderAuto(false);
    expect(screen.getByText("完成")).toBeInTheDocument();
    expect(mocks.analyzeSources).not.toHaveBeenCalled();
  });

  it("关闭详情后不继续下一批", async () => {
    let resolveFirst: ((value: object) => void) | undefined;
    mocks.analyzeSources.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );
    const view = renderAuto();
    await waitFor(() => expect(mocks.analyzeSources).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      resolveFirst?.({ sources: [], analyzed: 2, remaining: 3 });
      await Promise.resolve();
    });

    expect(mocks.analyzeSources).toHaveBeenCalledTimes(1);
  });

  it("游标不前进时停止，不持续发送相同请求", async () => {
    mocks.analyzeSources.mockResolvedValue({
      sources: [],
      analyzed: 0,
      next_offset: 0,
      total: 2,
      remaining: 2,
    });
    renderAuto();

    await waitFor(() => {
      expect(mocks.analyzeSources).toHaveBeenCalledTimes(1);
      expect(screen.getByText("完成")).toBeInTheDocument();
    });
  });
});
