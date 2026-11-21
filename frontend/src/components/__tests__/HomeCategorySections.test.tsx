import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeCategorySections from "../HomeCategorySections";
import type { AggregatedVideo, HomeSection } from "../../types";

const movie: AggregatedVideo = {
  id: 1,
  title: "测试电影",
  year: 2026,
  sources: [{ site_id: 1, original_id: "movie-1" }],
};

const series: AggregatedVideo = {
  id: 2,
  title: "测试剧集",
  year: 2025,
  sources: [{ site_id: 1, original_id: "series-1" }],
};

const sections: HomeSection[] = [
  { category: "电影", items: [movie] },
  { category: "综艺", items: [] },
  { category: "连续剧", items: [series] },
];

function renderSections(overrides = {}) {
  const props = {
    sections,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    onViewAll: vi.fn(),
    renderItem: (item: AggregatedVideo) => <span>{item.title}</span>,
    ...overrides,
  };
  return { ...render(<HomeCategorySections {...props} />), props };
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});

describe("HomeCategorySections", () => {
  it("只渲染非空分类，并保留返回顺序和数量", () => {
    renderSections();

    expect(screen.getAllByRole("heading")).toEqual([
      expect.objectContaining({ textContent: "电影" }),
      expect.objectContaining({ textContent: "连续剧" }),
    ]);
    expect(screen.queryByRole("heading", { name: "综艺" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "全部" })).toHaveAttribute(
      "aria-current",
      "location"
    );
    expect(screen.getAllByText("最新 1 部")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("测试电影")).toBeInTheDocument();
    expect(screen.getByText("测试剧集")).toBeInTheDocument();
  });

  it("进入对应分类的完整列表", async () => {
    const user = userEvent.setup();
    const { props } = renderSections();

    await user.click(screen.getByRole("button", { name: "查看全部电影" }));
    expect(props.onViewAll).toHaveBeenCalledWith("电影");
  });

  it("分类锚点支持键盘操作并滚动到对应区块", async () => {
    const user = userEvent.setup();
    renderSections();
    const anchor = screen.getByRole("link", { name: "电影" });

    anchor.focus();
    await user.keyboard("{Enter}");

    expect(anchor).toHaveFocus();
    expect(anchor).toHaveAttribute("aria-current", "location");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("减少动态效果时使用即时滚动", async () => {
    const user = userEvent.setup();
    vi.mocked(window.matchMedia).mockReturnValueOnce({
      matches: true,
    } as MediaQueryList);
    renderSections();

    await user.click(screen.getByRole("link", { name: "连续剧" }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
  });

  it("显示加载骨架、可重试错误和整体空状态", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderSections({
      sections: [],
      isLoading: true,
    });
    expect(document.querySelectorAll(".home-category-sections__skeleton-poster")).toHaveLength(8);

    rerender(
      <HomeCategorySections
        {...props}
        sections={[]}
        isLoading={false}
        isError={true}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("分类视频加载失败");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onRetry).toHaveBeenCalledOnce();

    rerender(
      <HomeCategorySections
        {...props}
        sections={[]}
        isLoading={false}
        isError={false}
      />
    );
    expect(screen.getByText("暂无视频，完成采集后再来看看。")).toBeInTheDocument();
  });
});
