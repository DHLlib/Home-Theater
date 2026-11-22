import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiteOpsSheet from "../SiteOpsSheet";
import { getSiteHealth, probeSite, updateSite } from "../../../api/sites";
import type { MaintenanceJob, Site, SiteMaintenanceStatus } from "../../../types";

vi.mock("../../../api/sites", () => ({
  getSiteHealth: vi.fn(),
  probeSite: vi.fn(),
  updateSite: vi.fn(),
}));

const site: Site = {
  id: 3,
  name: "天涯资源",
  base_url: "https://tyszy.com/api.php/provide/vod",
  enabled: true,
  sort: 0,
};

const status: SiteMaintenanceStatus = {
  site_id: 3,
  site_name: "天涯资源",
  enabled: true,
  health: { last_probe_ok: true, last_probe_latency_ms: 120 },
  last_crawl_at: null,
  total: 41_233,
  with_detail: 41_204,
  without_detail: 29,
  next_check_at: null,
  last_check_status: null,
  active_job_ids: [],
};

const health = {
  site_id: 3,
  site_name: "天涯资源",
  enabled: true,
  auto_disabled_at: null,
  latest_probe: {
    id: 1,
    site_id: 3,
    ok: true,
    latency_ms: 120,
    error: null,
    created_at: "2026-11-23T00:40:00Z",
  },
  recent_logs: [
    {
      id: 1,
      site_id: 3,
      ok: true,
      latency_ms: 120,
      error: null,
      created_at: "2026-11-23T00:40:00Z",
    },
  ],
  availability_24h: 99.2,
};

function makeJob(overrides: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    id: "active",
    kind: "crawl.incremental",
    state: "running",
    trigger: "manual",
    site_id: 3,
    cancel_requested: false,
    progress_completed: 0,
    progress_total: 0,
    details: {},
    error: null,
    created_at: "2026-11-23T00:40:00Z",
    started_at: "2026-11-23T00:40:00Z",
    finished_at: null,
    ...overrides,
  };
}

function renderSheet(jobs: MaintenanceJob[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props = {
    site,
    status,
    jobs,
    onClose: vi.fn(),
    onStart: vi.fn(),
    onCancelJob: vi.fn(),
    onRequestDelete: vi.fn(),
    onRefresh: vi.fn(),
  };
  render(
    <QueryClientProvider client={client}>
      <SiteOpsSheet {...props} />
    </QueryClientProvider>
  );
  return props;
}

beforeEach(() => {
  vi.mocked(getSiteHealth).mockResolvedValue(health);
  vi.mocked(probeSite).mockResolvedValue({ ok: true, latency_ms: 120 });
  vi.mocked(updateSite).mockResolvedValue({ ...site, enabled: false });
});

describe("SiteOpsSheet", () => {
  it("展示健康、数据与操作矩阵", async () => {
    renderSheet();

    expect(await screen.findByText("天涯资源")).toBeInTheDocument();
    expect(await screen.findByText("99.2%")).toBeInTheDocument();
    expect(screen.getAllByText("正常 120ms").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "单站补全" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "增量刮削" })).toBeEnabled();
  });

  it("同站增量任务运行时禁用增量刮削，并保留补全", () => {
    renderSheet([makeJob()]);

    expect(screen.getByRole("button", { name: "刮削中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "单站补全" })).toBeEnabled();
  });

  it("探测后刷新总览", async () => {
    const props = renderSheet();
    await screen.findByText("99.2%");

    await userEvent.click(screen.getByRole("button", { name: "立即探测" }));

    await waitFor(() => expect(probeSite).toHaveBeenCalledWith(3));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("禁用站点提交更新并刷新", async () => {
    const props = renderSheet();
    await screen.findByText("99.2%");

    await userEvent.click(screen.getByRole("button", { name: "禁用站点" }));

    await waitFor(() =>
      expect(updateSite).toHaveBeenCalledWith(3, { enabled: false })
    );
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("删除按钮交给外部确认流程", async () => {
    const props = renderSheet();
    await screen.findByText("99.2%");

    await userEvent.click(screen.getByRole("button", { name: "删除站点" }));

    expect(props.onRequestDelete).toHaveBeenCalledWith(site);
  });
});
