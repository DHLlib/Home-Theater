import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../Home";
import type { AggregatedVideo } from "../../types";

const mocks = vi.hoisted(() => ({
  useCrawlerStatusQuery: vi.fn(),
  useHomeSections: vi.fn(),
  useIsMobile: vi.fn(),
  useScrollRestoration: vi.fn(),
  useSitesQuery: vi.fn(),
  useVideosInfinite: vi.fn(),
}));

vi.mock("../../hooks/useVideos", () => ({
  useCrawlerStatusQuery: mocks.useCrawlerStatusQuery,
  useSitesQuery: mocks.useSitesQuery,
  useVideosInfinite: mocks.useVideosInfinite,
}));

vi.mock("../../hooks/useHomeSections", () => ({
  useHomeSections: mocks.useHomeSections,
}));

vi.mock("../../hooks/useViewport", () => ({
  useIsMobile: mocks.useIsMobile,
}));

vi.mock("../../hooks/useScrollRestoration", () => ({
  useScrollRestoration: mocks.useScrollRestoration,
}));

vi.mock("../../components/CategoryBar", () => ({
  default: () => <div data-testid="category-bar" />,
}));

vi.mock("../../components/HomeCategorySections", () => ({
  default: () => <div data-testid="home-category-sections" />,
}));

vi.mock("../../components/MobileSearchBar", () => ({
  default: () => <div data-testid="mobile-search-bar" />,
}));

vi.mock("../../components/VideoCard", () => ({
  default: ({ item }: { item: AggregatedVideo }) => (
    <div data-testid="desktop-video-card">{item.title}</div>
  ),
}));

vi.mock("../../components/VirtualGrid", () => ({
  default: ({
    items,
    itemKey,
    renderItem,
  }: {
    items: AggregatedVideo[];
    itemKey: (item: AggregatedVideo) => string;
    renderItem: (item: AggregatedVideo) => ReactNode;
  }) => (
    <div data-testid="virtual-grid">
      {items.map((item) => (
        <div
          key={itemKey(item)}
          data-testid="desktop-grid-item"
          data-item-key={itemKey(item)}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  ),
}));

function makeVideo(
  id: number,
  title: string,
  year: number,
  updatedAt: string
): AggregatedVideo {
  return {
    id,
    title,
    year,
    poster_url: null,
    sources: [{ site_id: 1, original_id: String(id), updated_at: updatedAt }],
  };
}

const a = makeVideo(1, "A", 2020, "2026-03-01T00:00:00Z");
const b = makeVideo(2, "B", 2021, "2026-02-01T00:00:00Z");
const c = makeVideo(3, "C", 2030, "2026-04-01T00:00:00Z");

function videosResult(pages: AggregatedVideo[][]) {
  return {
    data: { pages, pageParams: pages.map((_, index) => index + 1) },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    isCapped: false,
    pagesRestored: true,
  };
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/?category=电影"]}>
      <Home />
    </MemoryRouter>
  );
}

describe("Home pagination order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSitesQuery.mockReturnValue({
      data: [{ id: 1, name: "测试站" }],
      isLoading: false,
    });
    mocks.useCrawlerStatusQuery.mockReturnValue({
      data: { running: false, site_status: {} },
    });
    mocks.useHomeSections.mockReturnValue({
      data: { sections: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useIsMobile.mockReturnValue(false);
    mocks.useVideosInfinite.mockReturnValue(videosResult([[a, b]]));
  });

  it("追加新页时严格保留后端页序及既有卡片位置", () => {
    const view = renderHome();
    const initialItems = screen.getAllByTestId("desktop-grid-item");

    expect(initialItems.map((item) => item.textContent)).toEqual(["A", "B"]);
    expect(initialItems.map((item) => item.getAttribute("data-item-key"))).toEqual([
      "v-1",
      "v-2",
    ]);

    mocks.useVideosInfinite.mockReturnValue(videosResult([[a, b], [c]]));
    view.rerender(
      <MemoryRouter initialEntries={["/?category=电影"]}>
        <Home />
      </MemoryRouter>
    );

    const appendedItems = screen.getAllByTestId("desktop-grid-item");
    expect(appendedItems.map((item) => item.textContent)).toEqual(["A", "B", "C"]);
    expect(appendedItems.map((item) => item.getAttribute("data-item-key"))).toEqual([
      "v-1",
      "v-2",
      "v-3",
    ]);
    expect(appendedItems[0]).toBe(initialItems[0]);
    expect(appendedItems[1]).toBe(initialItems[1]);
  });

  it("排序切换继续向分页查询传递 sort 参数", () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "年份" }));
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: "电影", wd: "", sort: "year" },
      { enabled: true }
    );

    fireEvent.click(screen.getByRole("button", { name: "最近更新" }));
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: "电影", wd: "", sort: "updated" },
      { enabled: true }
    );
  });
});
