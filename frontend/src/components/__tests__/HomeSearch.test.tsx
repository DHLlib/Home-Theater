import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
      return new Response(JSON.stringify([{ id: 1, name: "测试站", enabled: true, sort: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/videos/recommended")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/videos/crawler/status")) {
      return new Response(JSON.stringify({ running: false, site_status: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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

describe("Home search", () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("渲染搜索结果且不崩溃", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/?wd=%E7%91%9E%E5%85%8B%E5%92%8C"]}>
          <Home />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      const cards = document.querySelectorAll(".video-card");
      expect(cards.length).toBeGreaterThan(0);
    });
  });
});
