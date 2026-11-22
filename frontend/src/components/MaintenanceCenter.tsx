import { useMemo, useState } from "react";
import {
  findActiveJob,
  isJobActive,
  MAINTENANCE_KIND_LABEL,
  MAINTENANCE_STATE_LABEL,
  MAINTENANCE_TRIGGER_LABEL,
  useMaintenance,
} from "../hooks/useMaintenance";
import type { CleanupSpeed, CleanupStatus } from "../api/videos";
import type {
  FillStatus,
  MaintenanceJob,
  MaintenanceOverview,
  MaintenanceState,
  SiteMaintenanceStatus,
} from "../types";
import "./MaintenanceCenter.css";

function fmtNum(n: number): string {
  return n.toLocaleString("zh-CN");
}

/** 表格里的紧凑时间：11-08 14:03 */
function fmtShortTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtFullTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN");
}

function stateTone(
  state: MaintenanceState
): "ok" | "warn" | "bad" | "muted" {
  switch (state) {
    case "done":
      return "ok";
    case "queued":
    case "running":
      return "ok";
    case "partial":
    case "skipped":
    case "cancelled":
    case "interrupted":
      return "warn";
    case "failed":
      return "bad";
  }
}

/** 任务行的一句话摘要：从 details 里挑关键数字，不解析大对象 */
function jobBrief(job: MaintenanceJob): string | null {
  if (job.kind === "detail.fill") {
    const fill = job.details?.fill as FillStatus | undefined;
    if (!fill || typeof fill !== "object") return null;
    const parts = [`已补 ${fmtNum(fill.filled ?? 0)}`];
    if (fill.failed > 0) parts.push(`失败 ${fmtNum(fill.failed)}`);
    if (fill.skipped > 0) parts.push(`跳过 ${fmtNum(fill.skipped)}`);
    return parts.join(" · ");
  }
  if (job.kind === "cache.cleanup") {
    const cleanup = job.details?.cleanup as CleanupStatus | undefined;
    if (!cleanup || typeof cleanup !== "object") return null;
    const parts = [`检查 ${fmtNum(cleanup.checked ?? 0)}`];
    if (cleanup.deleted > 0) parts.push(`删除 ${fmtNum(cleanup.deleted)}`);
    if (cleanup.pending > 0) parts.push(`待确认 ${fmtNum(cleanup.pending)}`);
    return parts.join(" · ");
  }
  return null;
}

function JobRow({
  job,
  siteName,
  cancelling,
  onCancel,
}: {
  job: MaintenanceJob;
  siteName: string | null;
  cancelling: boolean;
  onCancel: (job: MaintenanceJob) => void;
}) {
  const active = isJobActive(job);
  const percent =
    job.progress_total > 0
      ? Math.min(100, Math.round((job.progress_completed / job.progress_total) * 100))
      : null;
  const brief = jobBrief(job);

  return (
    <div className="maintenance-job" data-job-kind={job.kind} data-job-state={job.state}>
      <div className="maintenance-job-head">
        <span className="maintenance-job-kind">
          {MAINTENANCE_KIND_LABEL[job.kind]}
          {siteName ? ` · ${siteName}` : ""}
        </span>
        <span className={`maintenance-chip is-${stateTone(job.state)}`}>
          {job.state === "interrupted"
            ? "已中断（服务重启）"
            : MAINTENANCE_STATE_LABEL[job.state]}
        </span>
        <span className="maintenance-job-trigger">
          {MAINTENANCE_TRIGGER_LABEL[job.trigger]}
        </span>
      </div>

      {active && percent != null && (
        <div className="maintenance-progress-track" aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="maintenance-job-meta">
        {percent != null && (
          <b>
            {job.progress_completed.toLocaleString()} /{" "}
            {job.progress_total.toLocaleString()}
          </b>
        )}
        {brief && <span>{brief}</span>}
        <span>发起于 {fmtFullTime(job.created_at)}</span>
        {!active && job.finished_at && (
          <span>结束于 {fmtFullTime(job.finished_at)}</span>
        )}
      </div>

      {job.error && <div className="maintenance-job-error">{job.error}</div>}

      {active && (
        <button
          type="button"
          className="maintenance-job-cancel"
          disabled={job.cancel_requested || cancelling}
          onClick={() => onCancel(job)}
        >
          {job.cancel_requested ? "取消中…" : cancelling ? "提交中…" : "取消"}
        </button>
      )}
    </div>
  );
}

function healthCell(site: SiteMaintenanceStatus): {
  text: string;
  tone: "ok" | "warn" | "bad" | "muted";
} {
  if (!site.enabled) return { text: "已禁用", tone: "muted" };
  // health 来自健康计数器 + 最新探测日志：last_probe_ok / last_probe_latency_ms
  const health = site.health;
  const lastOk =
    health && typeof health["last_probe_ok"] === "boolean"
      ? (health["last_probe_ok"] as boolean)
      : null;
  if (lastOk === true) {
    const latency =
      health && typeof health["last_probe_latency_ms"] === "number"
        ? (health["last_probe_latency_ms"] as number)
        : null;
    return { text: latency != null ? `正常 ${latency}ms` : "正常", tone: "ok" };
  }
  if (lastOk === false) return { text: "异常", tone: "bad" };
  const status = site.last_check_status;
  if (status === "ok" || status === "healthy") return { text: "正常", tone: "ok" };
  if (status) return { text: "异常", tone: "bad" };
  return { text: "—", tone: "muted" };
}

function SiteStatusTable({ overview }: { overview: MaintenanceOverview }) {
  const { sites, schedules } = overview;
  const healthMinutes =
    schedules.health_interval_seconds > 0
      ? Math.max(1, Math.round(schedules.health_interval_seconds / 60))
      : null;

  if (sites.length === 0) {
    return <div className="maintenance-overview-empty">暂无采集站</div>;
  }

  return (
    <>
      <div className="maintenance-site-table-wrapper">
        <table className="maintenance-site-table">
          <thead>
            <tr>
              <th>站点</th>
              <th>健康</th>
              <th style={{ textAlign: "right" }}>待补全</th>
              <th>最近刮削</th>
              <th>下次检查</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const health = healthCell(s);
              return (
                <tr key={s.site_id}>
                  <td data-label="站点">
                    <span className="maintenance-site-name">{s.site_name}</span>
                    {!s.enabled && (
                      <span className="maintenance-chip is-muted">已禁用</span>
                    )}
                    {s.active_job_ids.length > 0 && (
                      <span className="maintenance-chip is-ok">任务中</span>
                    )}
                  </td>
                  <td data-label="健康">
                    <span className={`maintenance-health is-${health.tone}`}>
                      {health.text}
                    </span>
                  </td>
                  <td data-label="待补全" style={{ textAlign: "right" }}>
                    {s.without_detail > 0 ? (
                      <span className="maintenance-health is-bad">
                        {fmtNum(s.without_detail)}
                      </span>
                    ) : (
                      <span className="maintenance-health is-muted">0</span>
                    )}
                    <span className="maintenance-site-total">
                      {" "}
                      / {fmtNum(s.total)}
                    </span>
                  </td>
                  <td data-label="最近刮削">
                    {s.last_crawl_at ? fmtShortTime(s.last_crawl_at) : "从未"}
                  </td>
                  <td data-label="下次检查">{fmtShortTime(s.next_check_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(healthMinutes != null || schedules.fill_next_run_at) && (
        <div className="maintenance-schedule-note">
          自动任务：
          {[
            healthMinutes != null ? `健康检查每 ${healthMinutes} 分钟` : null,
            schedules.fill_next_run_at
              ? `全站补全下次 ${fmtShortTime(schedules.fill_next_run_at)}`
              : null,
          ]
            .filter(Boolean)
            .join("，")}
        </div>
      )}
    </>
  );
}

export default function MaintenanceCenter() {
  const {
    jobs,
    jobsLoading,
    overview,
    overviewLoading,
    startJob,
    startingKind,
    cancelJob,
    cancellingId,
  } = useMaintenance();

  const [cleanupSpeed, setCleanupSpeed] = useState<CleanupSpeed>(() => {
    const saved = localStorage.getItem("ht-cleanup-speed");
    return saved === "normal" || saved === "fast" ? saved : "eco";
  });

  const siteNames = useMemo(() => {
    const map = new Map<number, string>();
    overview?.sites.forEach((s) => map.set(s.site_id, s.site_name));
    return map;
  }, [overview]);

  const fullActive = findActiveJob(jobs, "crawl.full");
  const fillActive = findActiveJob(jobs, "detail.fill");
  const cleanupActive = findActiveJob(jobs, "cache.cleanup");

  const handleFullCrawl = () => {
    if (fullActive || startingKind) return;
    if (
      !confirm(
        "确定要重新全量刮削吗？这会遍历所有站点的所有分类，预计耗时 20-40 分钟。"
      )
    )
      return;
    startJob("crawl.full");
  };

  const handleFill = () => {
    if (fillActive || startingKind) return;
    startJob("detail.fill");
  };

  const handleCleanup = () => {
    if (cleanupActive || startingKind) return;
    if (
      !confirm(
        "确定要清除失效资源吗？会后台扫完全部站点的缓存，连续两轮都没被资源站返回的条目才会删除，整个过程可能需要约 1 小时。"
      )
    )
      return;
    // ?cleanup_dry_run=1 时只统计不删除，用于验证任务链路
    const dryRun =
      new URLSearchParams(window.location.search).get("cleanup_dry_run") === "1";
    startJob("cache.cleanup", null, { dry_run: dryRun, speed: cleanupSpeed });
  };

  const handleCancel = (job: MaintenanceJob) => {
    if (job.cancel_requested) return;
    if (
      !confirm(
        `确定要取消「${MAINTENANCE_KIND_LABEL[job.kind]}」吗？任务会在当前批次结束后停止。`
      )
    )
      return;
    cancelJob(job.id);
  };

  return (
    <div className="maintenance-center">
      <div className="maintenance-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleFullCrawl}
          disabled={Boolean(fullActive) || Boolean(startingKind)}
        >
          {fullActive
            ? "全量刮削中…"
            : startingKind === "crawl.full"
              ? "启动中..."
              : "全量刮削"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleFill}
          disabled={Boolean(fillActive) || Boolean(startingKind)}
        >
          {fillActive
            ? "补全进行中…"
            : startingKind === "detail.fill"
              ? "启动中..."
              : "全站补全 videolist"}
        </button>
        <select
          className="cleanup-speed"
          value={cleanupSpeed}
          disabled={Boolean(cleanupActive)}
          onChange={(event) => {
            const next = event.target.value as CleanupSpeed;
            setCleanupSpeed(next);
            try {
              localStorage.setItem("ht-cleanup-speed", next);
            } catch {
              // 隐私模式下写入失败可忽略
            }
          }}
          title="清理速度：越慢对资源站和带宽的压力越小"
          aria-label="清理速度"
        >
          <option value="eco">省流</option>
          <option value="normal">标准</option>
          <option value="fast">快速</option>
        </select>
        <button
          type="button"
          className="btn maintenance-danger"
          onClick={handleCleanup}
          disabled={Boolean(cleanupActive) || Boolean(startingKind)}
        >
          {cleanupActive
            ? "清理进行中…"
            : startingKind === "cache.cleanup"
              ? "启动中..."
              : "清除失效资源"}
        </button>
      </div>

      <div>
        <div className="maintenance-section-title">任务记录</div>
        {jobsLoading ? (
          <div className="maintenance-overview-empty">加载中...</div>
        ) : !jobs || jobs.length === 0 ? (
          <div className="maintenance-overview-empty">
            暂无任务记录，从上方发起刮削、补全或清理
          </div>
        ) : (
          <div className="maintenance-job-list">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                siteName={
                  job.site_id != null
                    ? (siteNames.get(job.site_id) ?? `站点${job.site_id}`)
                    : null
                }
                cancelling={cancellingId === job.id}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="maintenance-section-title">站点状态</div>
        {overview ? (
          <SiteStatusTable overview={overview} />
        ) : (
          <div className="maintenance-overview-empty">
            {overviewLoading ? "加载中..." : "站点状态加载失败"}
          </div>
        )}
      </div>
    </div>
  );
}
