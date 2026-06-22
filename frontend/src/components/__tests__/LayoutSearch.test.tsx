import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import Layout from "../Layout";
import Home from "../../pages/Home";
import rawResponse from "./fixtures/search-response.json";
import type { AggregatedListResponse } from "../../types";

vi.mock("../../api/favorites", () => ({
  getFavoriteStatus: vi.fn(() =>
    Promise.resolve({ favorited: false, id: null })
  ),
  toggleFavorite: vi.fn(() => Promise.resolve({ favorited: true, id: 1 })),
}));

const searchItems = (rawResponse as unknown as AggregatedListResponse).items;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes("/api/sites")) {
      return new Response(
        JSON.stringify([{ id: 1, name: "测试站", enabled: true, sort: 1 }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/system-categories")) {
      return new Response(
        JSON.stringify([
          {
            id: 1,
            parent_id: null,
            name: "电影",
            sort: 1,
            enabled: true,
            children: [],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/videos/recommended")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/videos/crawler/status")) {
      return new Response(
        JSON.stringify({ running: false, site_status: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/videos/search")) {
      return new Response(JSON.stringify({ items: searchItems.slice(0, 4) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

describe("Layout + Home search", () => {
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      }
    );
    // 刻意不 stub ResizeObserver，验证 VirtualGrid 在缺失该 API 时不会导致白屏
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderWithRouter(initialEntries: string[]) {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Layout />,
          children: [{ index: true, element: <Home /> }],
        },
      ],
      { initialEntries }
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    return router;
  }

  it("默认首页在缺少 ResizeObserver 时仍能渲染（不会整页白屏）", async () => {
    renderWithRouter(["/"]);
    await waitFor(() => {
      expect(screen.getByText("全部视频")).toBeInTheDocument();
    });
  });

  it("搜索时不崩溃且渲染结果", async () => {
    renderWithRouter(["/?wd=%E7%91%9E%E5%85%8B%E5%92%8C"]);
    await waitFor(() => {
      const cards = document.querySelectorAll(".video-card");
      expect(cards.length).toBeGreaterThan(0);
    });
  });
});
