import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TaskRecords from "../TaskRecords";
import type {
  MaintenanceJob,
  SiteMaintenanceStatus,
} from "../../../types";

const site: SiteMaintenanceStatus = {
  site_id: 3,
  site_name: "天涯资源",
  enabled: true,
  health: null,
  last_crawl_at: null,
  total: 41_233,
  with_detail: 41_233,
  without_detail: 0,
  next_check_at: null,
  last_check_status: null,
  active_job_ids: [],
};

function makeJob(overrides: Partial<MaintenanceJob>): MaintenanceJob {
  return {
    id: "job",
    kind: "crawl.incremental",
    state: "done",
    trigger: "scheduled",
    site_id: 3,
    cancel_requested: false,
    progress_completed: 0,
    progress_total: 0,
    details: {},
    error: null,
    created_at: "2026-11-23T00:35:00Z",
    started_at: "2026-11-23T00:35:00Z",
    finished_at: "2026-11-23T00:36:00Z",
    ...overrides,
  };
}

describe("TaskRecords", () => {
  it("有活动任务时默认展开，展示扫描中并可取消", async () => {
    const onCancel = vi.fn();
    const active = makeJob({
      id: "active",
      state: "running",
      trigger: "manual",
      progress_completed: 0,
      progress_total: 0,
    });
    render(
      <TaskRecords
        jobs={[active]}
        sites={[site]}
        loading={false}
        error={false}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("扫描中")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledWith(active);
  });

  it("detail.fill 活动任务展示逐站状态入口", () => {
    const fillJob = makeJob({
      id: "fill",
      kind: "detail.fill",
      state: "running",
      trigger: "manual",
      details: {
        fill: {
          state: "running",
          current_site_id: 4,
          current_site_name: "新浪HTTPS",
          completed_sites: 0,
          total_sites: 2,
          missing: 10,
          filled: 5,
          failed: 0,
          skipped: 0,
          started_at: null,
          finished_at: null,
          error: null,
          sites: [
            {
              site_id: 3,
              site_name: "天涯资源",
              state: "done",
              missing: 0,
              filled: 5,
              failed: 0,
              skipped: 0,
              error: null,
            },
            {
              site_id: 4,
              site_name: "新浪HTTPS",
              state: "running",
              missing: 5,
              filled: 0,
              failed: 0,
              skipped: 0,
              error: null,
            },
          ],
        },
      },
    });
    render(
      <TaskRecords
        jobs={[fillJob]}
        sites={[site]}
        loading={false}
        error={false}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText(/逐站状态/)).toBeInTheDocument();
    expect(screen.getByText("正在补全 新浪HTTPS")).toBeInTheDocument();
  });

  it("聚合定时任务并给出各状态计数", async () => {
    render(
      <TaskRecords
        jobs={[
          makeJob({ id: "s1", state: "done" }),
          makeJob({ id: "s2", state: "interrupted" }),
        ]}
        sites={[site]}
        loading={false}
        error={false}
        onCancel={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /任务记录/ }));
    expect(screen.getByText("定时增量 · 2 条")).toBeInTheDocument();
    expect(screen.getByText("成功 1")).toBeInTheDocument();
    expect(screen.getByText("中断 1")).toBeInTheDocument();
    expect(screen.getByText("最近 2 条")).toBeInTheDocument();
  });

  it("加载失败时显示错误而不是空态", async () => {
    render(
      <TaskRecords
        jobs={[]}
        sites={[]}
        loading={false}
        error
        onCancel={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /任务记录/ }));
    expect(screen.getByText("任务记录加载失败")).toBeInTheDocument();
  });
});
