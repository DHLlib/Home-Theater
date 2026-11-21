import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../../pages/Home";
import type { AggregatedVideo } from "../../types";

vi.mock("../../api/favorites", () => ({
  getFavoriteStatus: vi.fn(() =>
    Promise.resolve({ favorited: false, id: null })
  ),
  toggleFavorite: vi.fn(() => Promise.resolve({ favorited: true, id: 1 })),
}));

const movie: AggregatedVideo = {
  id: 1,
  title: "测试电影",
  year: 2026,
  poster_url: null,
  sources: [{ site_id: 1, site_name: "测试站", original_id: "movie-1" }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes("/api/sites")) {
      return jsonResponse([{ id: 1, name: "测试站", enabled: true, sort: 1 }]);
    }
    if (url.includes("/api/videos/home-sections")) {
      return jsonResponse({ sections: [{ category: "电影", items: [movie] }] });
    }
    if (url.includes("/api/videos/crawler/status")) {
      return jsonResponse({ running: false, site_status: {} });
    }
    if (url.includes("/api/system-categories")) {
      return jsonResponse([
        { id: 1, name: "电影", enabled: true, children: [] },
      ]);
    }
    if (url.includes("/api/videos/categories/stats")) {
      return jsonResponse({ counts: { 电影: 1 }, uncategorized: 0, total: 1 });
    }
    if (url.includes("/api/videos?")) {
      return jsonResponse({ items: url.includes("pg=2") ? [] : [movie] });
    }
    return jsonResponse({}, 404);
  });
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Home category sections", () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  const requestedUrls = () =>
    fetchMock.mock.calls.map(([input]) => input.toString());

  beforeEach(() => {
    fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认首页只加载分类分区，不请求推荐或混合视频墙", async () => {
    renderHome();

    expect(await screen.findByRole("heading", { name: "电影" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "测试电影 (2026)" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "首页分类" })).toBeInTheDocument();
    expect(document.querySelector(".category-bar")).not.toBeInTheDocument();
    expect(screen.queryByText("全部视频")).not.toBeInTheDocument();
    expect(requestedUrls().some((url) => url.includes("/api/videos/home-sections"))).toBe(true);
    expect(requestedUrls().some((url) => url.includes("/api/videos/recommended"))).toBe(false);
    expect(requestedUrls().some((url) => url.includes("/api/videos?"))).toBe(false);
  });

  it("查看全部进入现有分类筛选列表并恢复分页查询", async () => {
    renderHome();

    fireEvent.click(await screen.findByRole("button", { name: "查看全部电影" }));

    expect(await screen.findByRole("group", { name: "排序方式" })).toBeInTheDocument();
    expect(document.querySelector(".category-bar")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "首页分类" })).not.toBeInTheDocument();
    await waitFor(() => {
      const listUrl = requestedUrls().find((url) => url.includes("/api/videos?"));
      expect(listUrl).toContain("category=%E7%94%B5%E5%BD%B1");
      expect(listUrl).toContain("mode=aggregated");
    });
  });
});
