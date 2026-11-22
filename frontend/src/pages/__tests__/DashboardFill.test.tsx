import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../Dashboard";
import type { CrawlerStatsResponse, FillStatus, FillVideolistResponse } from "../../types";

const mocks = vi.hoisted(() => ({
  fillMissingVideolist: vi.fn(),
  getCrawlerStats: vi.fn(),
  getFillVideolistStatus: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("../../api/videos", () => ({
  fillMissingVideolist: mocks.fillMissingVideolist,
  getCrawlerStats: mocks.getCrawlerStats,
  getFillVideolistStatus: mocks.getFillVideolistStatus,
}));

vi.mock("../../utils/toast", () => ({
  toast: mocks.toast,
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));

const stats: CrawlerStatsResponse = {
  total: 100,
  by_site: [
    { site_id: 2, site_name: "非凡", count: 40, with_detail: 40, without_detail: 0 },
    { site_id: 1, site_name: "无尽ME", count: 60, with_detail: 20, without_detail: 40 },
  ],
  with_detail: 60,
  without_detail: 40,
  aggregated_count: 90,
  last_updated_at: null,
  history: [],
  computed_at: "2026-03-01T00:00:00Z",
};

function fillStatus(patch: Partial<FillStatus> = {}): FillStatus {
  return {
    state: "running",
    current_site_id: 1,
    current_site_name: "无尽ME",
    completed_sites: 0,
    total_sites: 2,
    missing: 40,
    filled: 5,
    failed: 0,
    skipped: 0,
    started_at: 1_777_777_777,
    finished_at: null,
    error: null,
    sites: [
      {
        site_id: 1,
        site_name: "无尽ME",
        state: "running",
        missing: 40,
        filled: 5,
        failed: 0,
        skipped: 0,
        error: null,
      },
      {
        site_id: 2,
        site_name: "非凡",
        state: "pending",
        missing: 0,
        filled: 0,
        failed: 0,
        skipped: 0,
        error: null,
      },
    ],
    ...patch,
  };
}

function startedResponse(status: FillStatus): FillVideolistResponse {
  return { message: "全站 videolist 补全任务已启动", site_id: null, started: true, status };
}

const idleStatus = fillStatus({
  state: "idle",
  current_site_id: null,
  current_site_name: null,
  completed_sites: 0,
  total_sites: 0,
  missing: 0,
  filled: 0,
  skipped: 0,
  started_at: null,
  sites: [],
});

/** 让已排队的 promise 继续执行并把 setState 收进 act */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDashboard() {
  const view = render(<Dashboard />);
  await flush();
  return view;
}

async function startBatchFill() {
  fireEvent.click(screen.getByRole("button", { name: "批量补全 videolist" }));
  await flush();
}

describe("Dashboard 补全任务进度", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    mocks.getCrawlerStats.mockResolvedValue(stats);
    mocks.getFillVideolistStatus.mockResolvedValue(idleStatus);
    mocks.fillMissingVideolist.mockResolvedValue(startedResponse(fillStatus()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("启动全站补全后显示真实进度，按钮禁用直到终态，不再固定 3 秒刷新", async () => {
    await renderDashboard();
    await startBatchFill();

    expect(mocks.fillMissingVideolist).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("全站 videolist 补全任务已启动");
    expect(screen.getByRole("button", { name: "批量补全中…" })).toBeDisabled();
    expect(screen.getByText("正在补全 无尽ME")).toBeInTheDocument();
    expect(screen.getByText("站点 0 / 2")).toBeInTheDocument();

    // 旧实现会在 3 秒后用 setTimeout 强行刷新统计；现在只有终态才刷新
    mocks.getFillVideolistStatus.mockResolvedValue(fillStatus());
    await advance(3000);
    expect(mocks.getCrawlerStats).toHaveBeenCalledTimes(1);
  });

  it("running 时每 2.5 秒轮询一次状态，终态后停止并刷新统计", async () => {
    await renderDashboard();
    await startBatchFill();
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();

    const mountCalls = mocks.getFillVideolistStatus.mock.calls.length;
    mocks.getFillVideolistStatus.mockResolvedValue(fillStatus());
    await advance(2500);
    expect(mocks.getFillVideolistStatus.mock.calls.length).toBe(mountCalls + 1);
    await advance(2500);
    expect(mocks.getFillVideolistStatus.mock.calls.length).toBe(mountCalls + 2);

    const doneStatus = fillStatus({
      state: "done",
      current_site_id: null,
      current_site_name: null,
      completed_sites: 2,
      filled: 40,
      finished_at: 1_777_778_000,
      sites: fillStatus().sites.map((s) => ({ ...s, state: "done" as const })),
    });
    mocks.getFillVideolistStatus.mockResolvedValue(doneStatus);
    await advance(2500);

    expect(screen.getByText("上次补全结果")).toBeInTheDocument();
    expect(mocks.getCrawlerStats).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("补全完成：补齐 40 条，跳过 0 条");
    expect(
      screen.getByRole("button", { name: "批量补全 videolist" })
    ).not.toBeDisabled();

    const callsAtDone = mocks.getFillVideolistStatus.mock.calls.length;
    await advance(7500);
    expect(mocks.getFillVideolistStatus.mock.calls.length).toBe(callsAtDone);
  });

  it("partial 终态给出明确提示并展示每站错误", async () => {
    await renderDashboard();
    await startBatchFill();

    const partialStatus = fillStatus({
      state: "partial",
      current_site_id: null,
      current_site_name: null,
      completed_sites: 2,
      filled: 20,
      failed: 20,
      finished_at: 1_777_778_000,
      sites: [
        {
          site_id: 1,
          site_name: "无尽ME",
          state: "blocked",
          missing: 40,
          filled: 20,
          failed: 20,
          skipped: 0,
          error: "HTTP 403：资源站拒绝访问",
        },
        {
          site_id: 2,
          site_name: "非凡",
          state: "done",
          missing: 0,
          filled: 0,
          failed: 0,
          skipped: 0,
          error: null,
        },
      ],
    });
    mocks.getFillVideolistStatus.mockResolvedValue(partialStatus);
    await advance(2500);

    expect(screen.getByText(/部分完成：补齐 20 条，失败 20 条/)).toBeInTheDocument();
    expect(screen.getByText("HTTP 403：资源站拒绝访问")).toBeInTheDocument();
    expect(screen.getByText("受阻")).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("部分完成")
    );
    expect(mocks.getCrawlerStats).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "批量补全 videolist" })
    ).not.toBeDisabled();
  });

  it("interrupted 终态提示任务被中断", async () => {
    await renderDashboard();
    await startBatchFill();

    mocks.getFillVideolistStatus.mockResolvedValue(
      fillStatus({
        state: "interrupted",
        current_site_id: null,
        current_site_name: null,
        finished_at: 1_777_778_000,
      })
    );
    await advance(2500);

    expect(screen.getByText(/补全任务被中断/)).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("补全任务被中断")
    );
  });

  it("failed 且顶层 error 为空时，从第一个带错误的站点生成含站点名的提示", async () => {
    await renderDashboard();
    await startBatchFill();

    mocks.getFillVideolistStatus.mockResolvedValue(
      fillStatus({
        state: "failed",
        current_site_id: null,
        current_site_name: null,
        error: null,
        finished_at: 1_777_778_000,
        sites: [
          {
            site_id: 1,
            site_name: "无尽ME",
            state: "failed",
            missing: 40,
            filled: 0,
            failed: 40,
            skipped: 0,
            error: "HTTP 403：资源站拒绝访问",
          },
          {
            site_id: 2,
            site_name: "非凡",
            state: "pending",
            missing: 0,
            filled: 0,
            failed: 0,
            skipped: 0,
            error: null,
          },
        ],
      })
    );
    await advance(2500);

    expect(
      screen.getByText("补全失败：无尽ME：HTTP 403：资源站拒绝访问")
    ).toBeInTheDocument();
    expect(screen.queryByText(/未知错误/)).not.toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "补全失败：无尽ME：HTTP 403：资源站拒绝访问"
    );
  });

  it("failed 且顶层与站点 error 都为空时才显示未知错误", async () => {
    await renderDashboard();
    await startBatchFill();

    mocks.getFillVideolistStatus.mockResolvedValue(
      fillStatus({
        state: "failed",
        current_site_id: null,
        current_site_name: null,
        error: null,
        finished_at: 1_777_778_000,
      })
    );
    await advance(2500);

    expect(screen.getByText("补全失败：未知错误")).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith("补全失败：未知错误");
  });

  it("进入页面时接管仍在运行的任务", async () => {
    mocks.getFillVideolistStatus.mockResolvedValue(fillStatus());
    await renderDashboard();

    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量补全中…" })).toBeDisabled();
    // 接管时不重复弹「启动」提示
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    const calls = mocks.getFillVideolistStatus.mock.calls.length;
    await advance(2500);
    expect(mocks.getFillVideolistStatus.mock.calls.length).toBe(calls + 1);
  });

  it("单站补全入口带 site_id 启动同一任务", async () => {
    mocks.fillMissingVideolist.mockResolvedValue({
      message: "站点 1 补全任务已启动",
      site_id: 1,
      started: true,
      status: fillStatus({ total_sites: 1 }),
    });
    await renderDashboard();

    const siteButtons = screen.getAllByRole("button", { name: "补全" });
    expect(siteButtons).toHaveLength(1);
    fireEvent.click(siteButtons[0]);
    await flush();

    expect(mocks.fillMissingVideolist).toHaveBeenCalledWith(1);
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    // 任务运行期间单站入口同样禁用
    expect(screen.getByRole("button", { name: "补全中…" })).toBeDisabled();
  });

  it("已有任务在运行时 started=false 不重复启动，仅接管进度", async () => {
    mocks.fillMissingVideolist.mockResolvedValue({
      message: "已有补全任务在运行",
      site_id: null,
      started: false,
      status: fillStatus(),
    });
    await renderDashboard();
    await startBatchFill();

    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith("info", "已有补全任务在运行");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("启动失败时提示错误且按钮恢复", async () => {
    mocks.fillMissingVideolist.mockRejectedValue(new Error("crawler not running"));
    await renderDashboard();
    await startBatchFill();

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("启动失败")
    );
    expect(screen.queryByText("正在补全 videolist")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "批量补全 videolist" })
    ).not.toBeDisabled();
  });

  it("页面卸载后停止轮询", async () => {
    const view = await renderDashboard();
    await startBatchFill();
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();

    mocks.getFillVideolistStatus.mockResolvedValue(fillStatus());
    await advance(2500);
    const calls = mocks.getFillVideolistStatus.mock.calls.length;
    expect(calls).toBeGreaterThan(1);

    view.unmount();
    await advance(10000);
    expect(mocks.getFillVideolistStatus.mock.calls.length).toBe(calls);
  });
});
