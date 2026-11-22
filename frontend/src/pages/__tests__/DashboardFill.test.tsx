import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../Dashboard";
import type {
  CrawlerStatsResponse,
  FillStatus,
  MaintenanceJob,
  MaintenanceOverview,
} from "../../types";

const mocks = vi.hoisted(() => ({
  listMaintenanceJobs: vi.fn(),
  startMaintenanceJob: vi.fn(),
  cancelMaintenanceJob: vi.fn(),
  getMaintenanceOverview: vi.fn(),
  getMaintenanceJob: vi.fn(),
  getCrawlerStats: vi.fn(),
  onSseEvent: vi.fn(() => () => {}),
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("../../api/maintenance", () => ({
  listMaintenanceJobs: mocks.listMaintenanceJobs,
  startMaintenanceJob: mocks.startMaintenanceJob,
  cancelMaintenanceJob: mocks.cancelMaintenanceJob,
  getMaintenanceOverview: mocks.getMaintenanceOverview,
  getMaintenanceJob: mocks.getMaintenanceJob,
}));

vi.mock("../../api/videos", () => ({
  getCrawlerStats: mocks.getCrawlerStats,
}));

vi.mock("../../api/sse", () => ({
  onSseEvent: mocks.onSseEvent,
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

const emptyOverview: MaintenanceOverview = {
  sites: [],
  jobs: [],
  schedules: { health_interval_seconds: 1800, fill_next_run_at: null, sites: {} },
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

function fillJob(
  patch: Partial<MaintenanceJob> = {},
  fillPatch: Partial<FillStatus> = {}
): MaintenanceJob {
  return {
    id: "job-fill-1",
    kind: "detail.fill",
    state: "running",
    trigger: "manual",
    site_id: null,
    cancel_requested: false,
    progress_completed: 0,
    progress_total: 2,
    details: { fill: fillStatus(fillPatch) },
    error: null,
    created_at: "2026-03-01T00:00:00Z",
    started_at: "2026-03-01T00:00:01Z",
    finished_at: null,
    ...patch,
  };
}

/** TanStack Query 的获取链有一部分挂在定时器上，用 async 版推进 0ms 并等 microtask 落地 */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
  await flush();
  return { view, queryClient };
}

/**
 * fake timers 下 interval 触发的 refetch 只更新缓存、不重渲染组件，
 * 而终态转换来自 SSE 的 invalidate（与手动 invalidate 同一条路径），
 * 所以测试里用 invalidate 模拟「收到 maintenance_progress 后拉快照」。
 */
async function refreshJobs(queryClient: QueryClient) {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["maintenance", "jobs"] });
  });
  await flush();
}

/**
 * 点击启动并在 flush 前同步设置好随后的任务快照，
 * 保证 mutation 成功后的 invalidate 拉到的就是新状态
 */
async function startBatchFill(nextJobs: MaintenanceJob[]) {
  fireEvent.click(screen.getByRole("button", { name: "批量补全 videolist" }));
  mocks.listMaintenanceJobs.mockResolvedValue(nextJobs);
  await flush();
  await flush();
}

describe("Dashboard 补全任务（统一 maintenance）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    mocks.getCrawlerStats.mockResolvedValue(stats);
    mocks.getMaintenanceOverview.mockResolvedValue(emptyOverview);
    mocks.listMaintenanceJobs.mockResolvedValue([]);
    mocks.startMaintenanceJob.mockResolvedValue(fillJob());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("启动全站补全后显示真实进度，按钮禁用直到终态，运行中不刷新统计", async () => {
    await renderDashboard();
    await startBatchFill([fillJob()]);

    expect(mocks.startMaintenanceJob).toHaveBeenCalledWith(
      "detail.fill",
      null,
      undefined
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("videolist 补全已启动");
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量补全中…" })).toBeDisabled();
    expect(screen.getByText("正在补全 无尽ME")).toBeInTheDocument();
    expect(screen.getByText("站点 0 / 2")).toBeInTheDocument();

    // 运行中只轮询任务快照，不刷新看板统计（统计终态才刷新）
    await advance(2000);
    expect(mocks.getCrawlerStats).toHaveBeenCalledTimes(1);
  });

  it("活动任务每 2 秒兜底轮询一次，终态后停止并刷新统计", async () => {
    const { queryClient } = await renderDashboard();
    await startBatchFill([fillJob()]);

    const mountCalls = mocks.listMaintenanceJobs.mock.calls.length;
    await advance(2000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(mountCalls + 1);
    await advance(2000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(mountCalls + 2);

    const doneJob = fillJob(
      { state: "done", progress_completed: 2, finished_at: "2026-03-01T00:10:00Z" },
      {
        state: "done",
        current_site_id: null,
        current_site_name: null,
        completed_sites: 2,
        filled: 40,
        finished_at: 1_777_778_000,
        sites: fillStatus().sites.map((s) => ({ ...s, state: "done" as const })),
      }
    );
    mocks.listMaintenanceJobs.mockResolvedValue([doneJob]);
    await refreshJobs(queryClient);

    expect(screen.getByText("上次补全结果")).toBeInTheDocument();
    expect(mocks.getCrawlerStats).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("补全完成：补齐 40 条，跳过 0 条");
    expect(
      screen.getByRole("button", { name: "批量补全 videolist" })
    ).not.toBeDisabled();

    const callsAtDone = mocks.listMaintenanceJobs.mock.calls.length;
    await advance(8000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(callsAtDone);
  });

  it("partial 终态给出明确提示并展示每站错误", async () => {
    const { queryClient } = await renderDashboard();
    await startBatchFill([fillJob()]);

    const partialJob = fillJob(
      { state: "partial", progress_completed: 2, finished_at: "2026-03-01T00:10:00Z" },
      {
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
      }
    );
    mocks.listMaintenanceJobs.mockResolvedValue([partialJob]);
    await refreshJobs(queryClient);

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

  it("interrupted 终态提示任务被后端重启中断", async () => {
    const { queryClient } = await renderDashboard();
    await startBatchFill([fillJob()]);

    mocks.listMaintenanceJobs.mockResolvedValue([
      fillJob(
        { state: "interrupted", finished_at: "2026-03-01T00:10:00Z" },
        {
          state: "interrupted",
          current_site_id: null,
          current_site_name: null,
          finished_at: 1_777_778_000,
        }
      ),
    ]);
    await refreshJobs(queryClient);

    expect(screen.getByText(/补全任务被中断（后端重启）/)).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("补全任务被中断")
    );
  });

  it("cancelled 显示已取消，不误写成后端重启", async () => {
    const { queryClient } = await renderDashboard();
    await startBatchFill([fillJob()]);

    mocks.listMaintenanceJobs.mockResolvedValue([
      fillJob(
        { state: "cancelled", cancel_requested: true, finished_at: "2026-03-01T00:05:00Z" },
        {
          state: "interrupted",
          current_site_id: null,
          current_site_name: null,
          finished_at: 1_777_778_000,
        }
      ),
    ]);
    await refreshJobs(queryClient);

    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.getByText(/补全任务已取消/)).toBeInTheDocument();
    expect(screen.queryByText(/后端重启/)).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("补全任务已取消")
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("failed 且顶层 error 为空时，从第一个带错误的站点生成含站点名的提示", async () => {
    const { queryClient } = await renderDashboard();
    await startBatchFill([fillJob()]);

    mocks.listMaintenanceJobs.mockResolvedValue([
      fillJob(
        { state: "failed", finished_at: "2026-03-01T00:05:00Z" },
        {
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
        }
      ),
    ]);
    await refreshJobs(queryClient);

    expect(
      screen.getByText("补全失败：无尽ME：HTTP 403：资源站拒绝访问")
    ).toBeInTheDocument();
    expect(screen.queryByText(/未知错误/)).not.toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "补全失败：无尽ME：HTTP 403：资源站拒绝访问"
    );
  });

  it("failed 且顶层与站点 error 都为空时才显示未知错误", async () => {
    const { queryClient } = await renderDashboard();
    await startBatchFill([fillJob()]);

    mocks.listMaintenanceJobs.mockResolvedValue([
      fillJob(
        { state: "failed", finished_at: "2026-03-01T00:05:00Z" },
        {
          state: "failed",
          current_site_id: null,
          current_site_name: null,
          error: null,
          finished_at: 1_777_778_000,
        }
      ),
    ]);
    await refreshJobs(queryClient);

    expect(screen.getByText("补全失败：未知错误")).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith("补全失败：未知错误");
  });

  it("进入页面时接管仍在运行的任务", async () => {
    mocks.listMaintenanceJobs.mockResolvedValue([fillJob()]);
    await renderDashboard();

    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量补全中…" })).toBeDisabled();
    // 接管时不重复弹「启动」提示
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    const calls = mocks.listMaintenanceJobs.mock.calls.length;
    await advance(2000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(calls + 1);
  });

  it("单站补全入口带 site_id 启动同一任务", async () => {
    await renderDashboard();

    const siteButtons = screen.getAllByRole("button", { name: "补全" });
    expect(siteButtons).toHaveLength(1);
    fireEvent.click(siteButtons[0]);
    mocks.listMaintenanceJobs.mockResolvedValue([fillJob({ site_id: 1 })]);
    await flush();
    await flush();

    expect(mocks.startMaintenanceJob).toHaveBeenCalledWith("detail.fill", 1, undefined);
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
    // 任务运行期间单站入口同样禁用
    expect(screen.getByRole("button", { name: "补全中…" })).toBeDisabled();
  });

  it("已有任务在运行时后端去重返回 deduplicated，仅接管进度", async () => {
    mocks.startMaintenanceJob.mockResolvedValue(fillJob({ deduplicated: true }));
    await renderDashboard();
    await startBatchFill([fillJob()]);

    expect(mocks.toast).toHaveBeenCalledWith(
      "info",
      "videolist 补全正在运行，已接上当前进度"
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();
  });

  it("启动失败时提示错误且按钮恢复", async () => {
    mocks.startMaintenanceJob.mockRejectedValue(new Error("crawler not running"));
    await renderDashboard();
    await startBatchFill([]);

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("启动任务失败")
    );
    expect(screen.queryByText("正在补全 videolist")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "批量补全 videolist" })
    ).not.toBeDisabled();
  });

  it("页面卸载后停止轮询", async () => {
    mocks.listMaintenanceJobs.mockResolvedValue([fillJob()]);
    const { view } = await renderDashboard();
    expect(screen.getByText("正在补全 videolist")).toBeInTheDocument();

    await advance(2000);
    const calls = mocks.listMaintenanceJobs.mock.calls.length;
    expect(calls).toBeGreaterThan(1);

    view.unmount();
    await advance(10000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(calls);
  });

  it("历史无时区补全时间按 UTC 显示", async () => {
    const finishedAt = "2026-03-01T00:10:00.123456";
    mocks.listMaintenanceJobs.mockResolvedValue([
      fillJob(
        { state: "done", finished_at: finishedAt },
        { state: "done", finished_at: finishedAt }
      ),
    ]);
    await renderDashboard();

    expect(
      screen.getByText(
        `结束于 ${new Date(`${finishedAt}Z`).toLocaleString("zh-CN")}`
      )
    ).toBeInTheDocument();
  });
});
