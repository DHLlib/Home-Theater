import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHomeSections, listVideos } from "../../api/videos";
import type { HomeSectionsResponse } from "../../types";
import { useHomeSections } from "../useHomeSections";
import { useVideosInfinite } from "../useVideos";

vi.mock("../../api/videos", () => ({
  getDetail: vi.fn(),
  getRecommendedVideos: vi.fn(),
  getCrawlerStatus: vi.fn(),
  getHomeSections: vi.fn(),
  listVideos: vi.fn(),
  searchVideos: vi.fn(),
}));

const response: HomeSectionsResponse = {
  sections: [
    {
      category: "电影",
      items: [{ id: 1, title: "测试电影", sources: [] }],
    },
  ],
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("useHomeSections", () => {
  it("禁用时不请求，启用后使用 homeSections 查询键获取数据", async () => {
    vi.mocked(getHomeSections).mockResolvedValue(response);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useHomeSections(enabled),
      {
        initialProps: { enabled: false },
        wrapper: createWrapper(queryClient),
      }
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(getHomeSections).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(queryClient.getQueryData(["homeSections"])).toEqual(response);
    expect(getHomeSections).toHaveBeenCalledOnce();
  });

  it("默认启用", async () => {
    vi.mocked(getHomeSections).mockResolvedValue(response);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useHomeSections(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getHomeSections).toHaveBeenCalledOnce();
  });
});

describe("useVideosInfinite enabled option", () => {
  it("禁用时不会请求旧的混合列表", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => useVideosInfinite({}, { enabled: false }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(listVideos).not.toHaveBeenCalled();
  });

  it("省略选项时维持原有自动查询行为", async () => {
    vi.mocked(listVideos).mockResolvedValue({ items: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => useVideosInfinite({ category: "电影" }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listVideos).toHaveBeenCalledWith({
      pg: 1,
      mode: "aggregated",
      category: "电影",
    });
  });
});
