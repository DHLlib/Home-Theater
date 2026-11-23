import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SiteCard from "../SiteCard";
import type {
  MaintenanceJob,
  SiteMaintenanceStatus,
} from "../../../types";

function makeSite(
  overrides: Partial<SiteMaintenanceStatus> = {}
): SiteMaintenanceStatus {
  const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
  return {
    site_id: 7,
    site_name: "新浪HTTPS",
    enabled: true,
    health: { last_probe_ok: false, last_probe_error: "HTTP 503" },
    last_crawl_at: new Date().toISOString(),
    total: 49_871,
    with_detail: 49_842,
    without_detail: 29,
    next_check_at: inAnHour,
    last_check_status: "error",
    active_job_ids: [],
    ...overrides,
  };
}

function makeJob(overrides: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    id: "job-1",
    kind: "crawl.incremental",
    state: "running",
    trigger: "manual",
    site_id: 7,
    cancel_requested: false,
    progress_completed: 0,
    progress_total: 0,
    details: {},
    error: null,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
    ...overrides,
  };
}

describe("SiteCard", () => {
  it("显示健康、待补全、补全率与下次检查", () => {
    render(<SiteCard site={makeSite()} onOpen={() => {}} />);

    expect(screen.getByText("新浪HTTPS")).toBeInTheDocument();
    expect(screen.getByText("异常")).toBeInTheDocument();
    expect(screen.getByText("29")).toBeInTheDocument();
    expect(screen.getByText("99.94%")).toBeInTheDocument();
    expect(screen.getByText(/最近 .+ · 下次/)).toBeInTheDocument();
  });

  it("有活动任务时显示任务中，并优先于最近刮削", () => {
    render(
      <SiteCard
        site={makeSite({ without_detail: 0, with_detail: 49_871 })}
        job={makeJob()}
        onOpen={() => {}}
      />
    );

    expect(screen.getByText("任务中 · 增量刮削")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("删除中禁用打开并给出状态", () => {
    render(<SiteCard site={makeSite()} deleting onOpen={() => {}} />);

    expect(screen.getByText("删除中…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /打开 新浪HTTPS 的站点运维/ })
    ).toBeDisabled();
  });

  it("删除排队时展示阻塞任务而不是笼统的删除中", () => {
    render(
      <SiteCard
        site={makeSite()}
        deleting
        deletingMessage="等待其他任务结束：crawl.full"
        onOpen={() => {}}
      />
    );

    expect(screen.getByText("等待其他任务结束：crawl.full")).toBeInTheDocument();
    expect(screen.queryByText("删除中…")).not.toBeInTheDocument();
  });

  it("点击卡片触发 onOpen", async () => {
    const onOpen = vi.fn();
    render(<SiteCard site={makeSite()} onOpen={onOpen} />);

    await userEvent.click(
      screen.getByRole("button", { name: /打开 新浪HTTPS 的站点运维/ })
    );

    expect(onOpen).toHaveBeenCalledOnce();
  });
});
