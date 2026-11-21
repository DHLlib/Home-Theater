import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MobileHome from "./MobileHome";
import type { AggregatedVideo } from "../../types";

const mocks = vi.hoisted(() => ({
  useCrawlerStatusQuery: vi.fn(),
  useHomeSections: vi.fn(),
  useSitesQuery: vi.fn(),
  useVideosInfinite: vi.fn(),
  homeSectionsProps: vi.fn(),
}));

vi.mock("../../hooks/useVideos", () => ({
  useCrawlerStatusQuery: mocks.useCrawlerStatusQuery,
  useSitesQuery: mocks.useSitesQuery,
  useVideosInfinite: mocks.useVideosInfinite,
}));

vi.mock("../../hooks/useHomeSections", () => ({
  useHomeSections: mocks.useHomeSections,
}));

vi.mock("../../api/system-categories", () => ({
  listSystemCategories: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: "电影",
      enabled: true,
      children: [{ id: 2, name: "剧情片", enabled: true }],
    },
  ]),
}));

vi.mock("../components/MobileVideoCard", () => ({
  default: ({ item }: { item: AggregatedVideo }) => (
    <div data-testid="mobile-video-card">{item.title}</div>
  ),
}));

vi.mock("../../components/HomeCategorySections", () => ({
  default: (props: {
    sections: { category: string; items: AggregatedVideo[] }[];
    onViewAll: (category: string) => void;
    renderItem: (item: AggregatedVideo) => ReactNode;
  }) => {
    mocks.homeSectionsProps(props);
    return (
      <div data-testid="home-category-sections">
        {props.sections.map((section) => (
          <section key={section.category}>
            <h2>{section.category}</h2>
            <button onClick={() => props.onViewAll(section.category)}>
              查看全部 {section.category}
            </button>
            {section.items.map((item) => (
              <div key={item.id}>{props.renderItem(item)}</div>
            ))}
          </section>
        ))}
      </div>
    );
  },
}));

const video = {
  id: 1,
  title: "测试电影",
  year: 2026,
  poster_url: null,
  sources: [],
} as AggregatedVideo;

function renderHome(entry = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <MobileHome />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...view, queryClient };
}

describe("MobileHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      }
    );
    mocks.useSitesQuery.mockReturnValue({ data: [{ id: 1, name: "测试站" }] });
    mocks.useCrawlerStatusQuery.mockReturnValue({
      data: { running: false, site_status: {} },
    });
    mocks.useHomeSections.mockReturnValue({
      data: { sections: [{ category: "电影", items: [video] }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useVideosInfinite.mockReturnValue({
      data: { pages: [[video]], pageParams: [1] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      isCapped: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认展示分类区块并禁用混合视频查询", () => {
    renderHome();

    expect(screen.getByText("HOME THEATER")).toBeInTheDocument();
    expect(screen.getByText("搜索片名、演员、年份")).toBeInTheDocument();
    expect(screen.getByTestId("home-category-sections")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-video-card")).toHaveTextContent("测试电影");
    expect(screen.queryByText("推荐")).not.toBeInTheDocument();
    expect(screen.queryByText("最新更新")).not.toBeInTheDocument();
    expect(screen.queryByText("全部视频")).not.toBeInTheDocument();
    expect(document.querySelector(".mobile-category-tabs")).not.toBeInTheDocument();
    expect(mocks.useHomeSections).toHaveBeenLastCalledWith(true);
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: null, wd: "", sort: "updated" },
      { enabled: false }
    );
  });

  it("查看全部进入保留 Tabs、排序和网格的分类列表", async () => {
    renderHome();

    fireEvent.click(screen.getByRole("button", { name: "查看全部 电影" }));

    expect(await screen.findByRole("heading", { name: "电影" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "剧情片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "年份" })).toBeInTheDocument();
    expect(document.querySelector(".mobile-poster-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("home-category-sections")).not.toBeInTheDocument();
    expect(mocks.useHomeSections).toHaveBeenLastCalledWith(false);
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: "电影", wd: "", sort: "updated" },
      { enabled: true }
    );
  });

  it("追加下一页时保持后端顺序和已有卡片位置", () => {
    const a = {
      ...video,
      id: 101,
      title: "A",
      year: 2020,
      sources: [{ updated_at: "2024-01-01T00:00:00Z" }],
    } as AggregatedVideo;
    const b = {
      ...video,
      id: 102,
      title: "B",
      year: 2021,
      sources: [{ updated_at: "2025-01-01T00:00:00Z" }],
    } as AggregatedVideo;
    const c = {
      ...video,
      id: 103,
      title: "C",
      year: 2026,
      sources: [{ updated_at: "2026-01-01T00:00:00Z" }],
    } as AggregatedVideo;
    const queryState = {
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      isCapped: false,
    };
    mocks.useVideosInfinite.mockReturnValue({
      ...queryState,
      data: { pages: [[a, b]], pageParams: [1] },
      hasNextPage: true,
    });

    const { queryClient, rerender } = renderHome("/?category=电影");
    const oldCards = screen.getAllByTestId("mobile-video-card");
    expect(oldCards.map((card) => card.textContent)).toEqual(["A", "B"]);

    mocks.useVideosInfinite.mockReturnValue({
      ...queryState,
      data: { pages: [[a, b], [c]], pageParams: [1, 2] },
      hasNextPage: false,
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/?category=电影"]}>
          <MobileHome />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const cards = screen.getAllByTestId("mobile-video-card");
    expect(cards.map((card) => card.textContent)).toEqual(["A", "B", "C"]);
    expect(cards[0]).toBe(oldCards[0]);
    expect(cards[1]).toBe(oldCards[1]);
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: "电影", wd: "", sort: "updated" },
      { enabled: true }
    );
  });

  it("排序切换仍传递查询参数", () => {
    renderHome("/?category=电影");

    fireEvent.click(screen.getByRole("button", { name: "年份" }));
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: "电影", wd: "", sort: "year" },
      { enabled: true }
    );

    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(mocks.useVideosInfinite).toHaveBeenLastCalledWith(
      { category: "电影", wd: "", sort: "updated" },
      { enabled: true }
    );
  });

  it("首次同步且没有分类内容时保留同步状态", () => {
    mocks.useCrawlerStatusQuery.mockReturnValue({
      data: { running: true, site_status: { "1": "full_crawling" } },
    });
    mocks.useHomeSections.mockReturnValue({
      data: { sections: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderHome();

    expect(screen.getByText("正在同步数据")).toBeInTheDocument();
    expect(screen.queryByTestId("home-category-sections")).not.toBeInTheDocument();
  });
});
