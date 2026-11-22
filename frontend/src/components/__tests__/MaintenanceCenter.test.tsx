import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MaintenanceCenter from "../MaintenanceCenter";
import type {
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
  onSseEvent: vi.fn(() => () => {}),
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  confirm: vi.fn(() => true),
}));

vi.mock("../../api/maintenance", () => ({
  listMaintenanceJobs: mocks.listMaintenanceJobs,
  startMaintenanceJob: mocks.startMaintenanceJob,
  cancelMaintenanceJob: mocks.cancelMaintenanceJob,
  getMaintenanceOverview: mocks.getMaintenanceOverview,
  getMaintenanceJob: mocks.getMaintenanceJob,
}));

vi.mock("../../api/sse", () => ({
  onSseEvent: mocks.onSseEvent,
}));

vi.mock("../../utils/toast", () => ({
  toast: mocks.toast,
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));

vi.stubGlobal("confirm", mocks.confirm);

const overview: MaintenanceOverview = {
  sites: [
    {
      site_id: 1,
      site_name: "无尽ME",
      enabled: true,
      health: {
        failure_count: 0,
        recovery_count: 0,
        last_probe_ok: true,
        last_probe_at: "2026-03-01T00:30:00Z",
        last_probe_error: null,
        last_probe_latency_ms: 123,
      },
      last_crawl_at: "2026-03-01T00:00:00Z",
      total: 100,
      with_detail: 60,
      without_detail: 40,
      next_check_at: "2026-03-01T01:00:00Z",
      last_check_status: "ok",
      active_job_ids: [],
    },
    {
      site_id: 2,
      site_name: "非凡",
      enabled: false,
      health: null,
      last_crawl_at: null,
      total: 10,
      with_detail: 10,
      without_detail: 0,
      next_check_at: null,
      last_check_status: null,
      active_job_ids: ["job-fill-1"],
    },
  ],
  jobs: [],
  schedules: { health_interval_seconds: 1800, fill_next_run_at: null, sites: {} },
};

function fillSnapshot(patch: Partial<FillStatus> = {}): FillStatus {
  return {
    state: "running",
    current_site_id: 1,
    current_site_name: "无尽ME",
    completed_sites: 1,
    total_sites: 2,
    missing: 40,
    filled: 5,
    failed: 0,
    skipped: 0,
    started_at: 1_777_777_777,
    finished_at: null,
    error: null,
    sites: [],
    ...patch,
  };
}

function makeJob(patch: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    id: "job-1",
    kind: "detail.fill",
    state: "running",
    trigger: "manual",
    site_id: null,
    cancel_requested: false,
    progress_completed: 1,
    progress_total: 2,
    details: { fill: fillSnapshot() },
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

async function renderCenter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MaintenanceCenter />
    </QueryClientProvider>
  );
  await flush();
  return view;
}

describe("MaintenanceCenter 运维任务中心", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    mocks.listMaintenanceJobs.mockResolvedValue([]);
    mocks.getMaintenanceOverview.mockResolvedValue(overview);
    mocks.confirm.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("展示任务真实状态、进度与触发来源", async () => {
    mocks.listMaintenanceJobs.mockResolvedValue([
      makeJob(),
      makeJob({
        id: "job-0",
        kind: "crawl.full",
        state: "done",
        trigger: "scheduled",
        progress_completed: 21,
        progress_total: 21,
        details: {},
        finished_at: "2026-02-28T23:00:00Z",
      }),
    ]);
    await renderCenter();

    expect(screen.getByText("videolist 补全")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("已补 5")).toBeInTheDocument();
    // 一处是操作按钮，一处是任务记录
    expect(screen.getAllByText("全量刮削").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("完成")).toBeInTheDocument();
    expect(screen.getByText("定时")).toBeInTheDocument();
    // 活动任务存在时显示取消入口
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("活动任务存在时同类入口禁用，去重提交给出忙碌提示", async () => {
    mocks.listMaintenanceJobs.mockResolvedValue([makeJob()]);
    mocks.startMaintenanceJob.mockResolvedValue(
      makeJob({ id: "job-cleanup", kind: "cache.cleanup", deduplicated: true })
    );
    await renderCenter();

    // 同类 detail.fill 正在运行：入口禁用且文案提示
    expect(
      screen.getByRole("button", { name: "补全进行中…" })
    ).toBeDisabled();

    // 另一类任务去重返回：给出「正在运行」提示而不是假装启动成功
    fireEvent.click(screen.getByRole("button", { name: "清除失效资源" }));
    mocks.listMaintenanceJobs.mockResolvedValue([
      makeJob({ id: "job-cleanup", kind: "cache.cleanup" }),
      makeJob(),
    ]);
    await flush();
    await flush();

    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.startMaintenanceJob).toHaveBeenCalledWith("cache.cleanup", null, {
      dry_run: false,
      speed: "eco",
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      "info",
      "失效资源清理正在运行，已接上当前进度"
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("取消活动任务：确认后调用取消接口并提示", async () => {
    const job = makeJob();
    mocks.listMaintenanceJobs.mockResolvedValue([job]);
    mocks.cancelMaintenanceJob.mockResolvedValue({
      ...job,
      cancel_requested: true,
    });
    await renderCenter();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    mocks.listMaintenanceJobs.mockResolvedValue([
      { ...job, cancel_requested: true },
    ]);
    await flush();
    await flush();

    expect(mocks.cancelMaintenanceJob).toHaveBeenCalledWith("job-1");
    expect(mocks.toast).toHaveBeenCalledWith(
      "info",
      "已请求取消，任务会在当前批次结束后停止"
    );
  });

  it("失败任务展示错误，取消与中断状态文案区分", async () => {
    mocks.listMaintenanceJobs.mockResolvedValue([
      makeJob({
        id: "job-fail",
        kind: "crawl.full",
        state: "failed",
        details: {},
        error: "crawler not running",
        finished_at: "2026-03-01T01:00:00Z",
      }),
      makeJob({
        id: "job-cancel",
        kind: "cache.cleanup",
        state: "cancelled",
        details: {},
        finished_at: "2026-03-01T01:00:00Z",
      }),
      makeJob({
        id: "job-int",
        kind: "detail.fill",
        state: "interrupted",
        finished_at: "2026-03-01T01:00:00Z",
      }),
    ]);
    await renderCenter();

    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("crawler not running")).toBeInTheDocument();
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.getByText("已中断（服务重启）")).toBeInTheDocument();
    // 终态任务没有取消按钮
    expect(
      screen.queryByRole("button", { name: "取消" })
    ).not.toBeInTheDocument();
  });

  it("站点状态表呈现健康、待补全、最近刮削与下次检查", async () => {
    await renderCenter();

    expect(screen.getByText("无尽ME")).toBeInTheDocument();
    expect(screen.getByText("正常 123ms")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("非凡")).toBeInTheDocument();
    // 站点名旁的健康徽标 + 健康列，各一处
    expect(screen.getAllByText("已禁用").length).toBe(2);
    expect(screen.getByText("任务中")).toBeInTheDocument();
    expect(screen.getByText("从未")).toBeInTheDocument();
    expect(
      screen.getByText(/健康检查每 30 分钟/)
    ).toBeInTheDocument();
  });

  it("发起全量刮削走统一接口", async () => {
    mocks.startMaintenanceJob.mockResolvedValue(
      makeJob({ id: "job-full", kind: "crawl.full", progress_total: 0, details: {} })
    );
    await renderCenter();

    fireEvent.click(screen.getByRole("button", { name: "全量刮削" }));
    await flush();

    expect(mocks.startMaintenanceJob).toHaveBeenCalledWith(
      "crawl.full",
      null,
      undefined
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("全量刮削已启动");
  });

  it("活动任务存在时每 2 秒兜底轮询快照，全部终态后停止", async () => {
    mocks.listMaintenanceJobs.mockResolvedValue([makeJob()]);
    await renderCenter();

    const calls = mocks.listMaintenanceJobs.mock.calls.length;
    await advance(2000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(calls + 1);

    mocks.listMaintenanceJobs.mockResolvedValue([
      makeJob({ state: "done", finished_at: "2026-03-01T01:00:00Z" }),
    ]);
    await advance(2000);
    const doneCalls = mocks.listMaintenanceJobs.mock.calls.length;
    expect(doneCalls).toBe(calls + 2);

    await advance(6000);
    expect(mocks.listMaintenanceJobs.mock.calls.length).toBe(doneCalls);
  });
});
