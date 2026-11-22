import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  FillSiteState,
  FillStatus,
  MaintenanceJob,
  SiteMaintenanceStatus,
} from "../../types";
import { ChevronIcon } from "./icons";
import {
  formatFullTime,
  formatNumber,
  formatShortTime,
  isActiveJob,
  jobBrief,
  kindLabel,
  stateLabel,
  stateTone,
  triggerLabel,
} from "./ops";

const FILL_SITE_LABEL: Record<FillSiteState, string> = {
  pending: "等待",
  running: "补全中",
  done: "完成",
  partial: "部分",
  blocked: "熔断",
  failed: "失败",
};
const FILL_SITE_TONE: Record<FillSiteState, string> = {
  pending: "",
  running: "is-active",
  done: "is-ok",
  partial: "is-warn",
  blocked: "is-warn",
  failed: "is-bad",
};

interface TaskRecordsProps {
  jobs: MaintenanceJob[];
  sites: SiteMaintenanceStatus[];
  loading: boolean;
  error: boolean;
  onCancel: (job: MaintenanceJob) => void;
}

function ActiveJob({
  job,
  siteName,
  onCancel,
}: {
  job: MaintenanceJob;
  siteName: string;
  onCancel: (job: MaintenanceJob) => void;
}) {
  const total = job.progress_total || 0;
  const done = job.progress_completed || 0;
  const known = total > 0;
  const percent = known ? Math.min(100, (done / total) * 100) : 0;
  const fill =
    job.kind === "detail.fill"
      ? (job.details?.fill as FillStatus | undefined)
      : undefined;
  const fillSites = fill?.sites ?? [];
  return (
    <div className="ops-task-active">
      <div className="ops-task-active-head">
        <span className="ops-task-active-kind">{kindLabel(job.kind)}</span>
        <span className="ops-task-site">{siteName}</span>
        <span className={`ops-state is-${stateTone(job.state)}`}>
          {stateLabel(job.state)}
        </span>
        <span className="ops-task-trigger">{triggerLabel(job.trigger)}</span>
      </div>
      <div className={`ops-task-track${known ? "" : " is-indeterminate"}`}>
        <i style={known ? { width: `${percent}%` } : undefined} />
      </div>
      <div className="ops-task-active-meta">
        <b>{known ? `${done} / ${total}` : "扫描中"}</b>
        <span>发起于 {formatFullTime(job.created_at)}</span>
      </div>
      {job.error && <div className="ops-task-active-error">{job.error}</div>}
      {fill && fillSites.length > 0 && (
        <details className="ops-fill-detail">
          <summary>
            逐站状态 <span className="ops-fill-count">{fillSites.length}</span>
            {fill.current_site_name && (
              <span className="ops-fill-current">
                正在补全 {fill.current_site_name}
              </span>
            )}
          </summary>
          <div className="ops-fill-list">
            {fillSites.map((site) => (
              <div className="ops-fill-row" key={site.site_id}>
                <span className="ops-fill-name">{site.site_name}</span>
                <span className={`ops-state ${FILL_SITE_TONE[site.state]}`}>
                  {FILL_SITE_LABEL[site.state] ?? site.state}
                </span>
                <span className="ops-fill-nums">
                  缺 {formatNumber(site.missing)} · 补 {formatNumber(site.filled)}
                  {site.failed ? ` · 失败 ${formatNumber(site.failed)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
      <button
        type="button"
        className="ops-task-cancel"
        onClick={() => onCancel(job)}
      >
        {job.cancel_requested ? "取消中…" : "取消"}
      </button>
    </div>
  );
}

function TaskRow({ job, siteName }: { job: MaintenanceJob; siteName: string }) {
  return (
    <div className="ops-task-row">
      <div className="ops-task-name">
        {kindLabel(job.kind)}
        <span className="ops-task-site">{siteName}</span>
      </div>
      <span>
        <span className={`ops-state is-${stateTone(job.state)}`}>
          {stateLabel(job.state)}
        </span>
      </span>
      <span className="ops-task-trigger">{triggerLabel(job.trigger)}</span>
      <span className="ops-task-brief">{jobBrief(job) || "—"}</span>
      <span className="ops-task-time">{formatShortTime(job.created_at)}</span>
    </div>
  );
}

export default function TaskRecords({
  jobs,
  sites,
  loading,
  error,
  onCancel,
}: TaskRecordsProps) {
  const active = useMemo(
    () =>
      jobs
        .filter(isActiveJob)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    [jobs]
  );
  const manual = useMemo(
    () =>
      jobs
        .filter((job) => !isActiveJob(job) && job.trigger !== "scheduled")
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 4),
    [jobs]
  );
  const scheduled = useMemo(
    () => jobs.filter((job) => job.trigger === "scheduled"),
    [jobs]
  );
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const job of scheduled) {
      result[job.state] = (result[job.state] || 0) + 1;
    }
    return result;
  }, [scheduled]);
  const latestScheduled = useMemo(
    () =>
      scheduled.reduce<MaintenanceJob | null>((latest, job) => {
        if (!latest) return job;
        return new Date(job.created_at).getTime() >
          new Date(latest.created_at).getTime()
          ? job
          : latest;
      }, null),
    [scheduled]
  );
  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    sites.forEach((site) => map.set(site.site_id, site.site_name));
    return map;
  }, [sites]);
  const siteName = (job: MaintenanceJob) =>
    job.site_id != null ? nameById.get(job.site_id) ?? `站点${job.site_id}` : "全部站点";

  const [open, setOpen] = useState(active.length > 0);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const previousActive = useRef(active.length);

  useEffect(() => {
    if (previousActive.current === 0 && active.length > 0) {
      setOpen(true);
    }
    previousActive.current = active.length;
  }, [active.length]);

  const toggle = () => {
    setOpen((value) => !value);
  };

  const bits = [
    counts.done ? { label: `成功 ${counts.done}`, tone: "is-ok" } : null,
    counts.interrupted
      ? { label: `中断 ${counts.interrupted}`, tone: "is-warn" }
      : null,
    counts.cancelled
      ? { label: `已取消 ${counts.cancelled}`, tone: "is-warn" }
      : null,
    counts.failed ? { label: `失败 ${counts.failed}`, tone: "is-bad" } : null,
    counts.running ? { label: `运行中 ${counts.running}`, tone: "" } : null,
  ].filter(Boolean) as { label: string; tone: string }[];

  let body: ReactNode;
  if (loading) {
    body = [0, 1, 2].map((i) => (
      <div
        key={i}
        className="ops-skeleton-card"
        style={{ minHeight: 58, padding: 12, marginBottom: 8 }}
      >
        <div className="ops-skeleton ops-skeleton-line" style={{ width: "58%" }} />
        <div
          className="ops-skeleton ops-skeleton-line"
          style={{ width: "80%", marginTop: 8 }}
        />
      </div>
    ));
  } else if (error) {
    body = <div className="ops-task-empty">任务记录加载失败</div>;
  } else if (!jobs.length) {
    body = (
      <div className="ops-task-empty">
        暂无任务记录，从上方发起刮削、补全或清理
      </div>
    );
  } else {
    body = (
      <>
        {active.length > 0 && (
          <div className="ops-task-group">
            <div className="ops-task-group-title">进行中</div>
            {active.map((job) => (
              <ActiveJob
                key={job.id}
                job={job}
                siteName={siteName(job)}
                onCancel={onCancel}
              />
            ))}
          </div>
        )}
        {manual.length > 0 && (
          <div className="ops-task-group">
            <div className="ops-task-group-title">
              手动 / 启动 / 生命周期
            </div>
            {manual.map((job) => (
              <TaskRow key={job.id} job={job} siteName={siteName(job)} />
            ))}
          </div>
        )}
        {scheduled.length > 0 && (
          <div className="ops-task-group">
            <div className="ops-task-group-title">定时</div>
            <div className="ops-task-summary">
              <b>定时增量 · {scheduled.length} 条</b>
              {bits.map((bit) => (
                <span key={bit.label} className={bit.tone}>
                  {bit.label}
                </span>
              ))}
              <span>
                最近{" "}
                {latestScheduled
                  ? formatShortTime(latestScheduled.created_at)
                  : "—"}
              </span>
              <button
                type="button"
                className="ops-text-btn"
                onClick={() => setScheduledOpen((value) => !value)}
              >
                {scheduledOpen ? "收起" : "展开"}
              </button>
            </div>
            {scheduledOpen && (
              <div style={{ marginTop: 8 }}>
                {[...scheduled]
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() -
                      new Date(a.created_at).getTime()
                  )
                  .slice(0, 6)
                  .map((job) => (
                    <TaskRow key={job.id} job={job} siteName={siteName(job)} />
                  ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  const countText = loading || error ? "—" : formatNumber(jobs.length);
  return (
    <section className="ops-section">
      <button
        type="button"
        className="ops-section-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="ops-section-chev">
          <ChevronIcon />
        </span>
        <span className="ops-section-title">任务记录</span>
        {active.length > 0 && (
          <span className="ops-state is-active">进行中 {active.length}</span>
        )}
        <span className="ops-section-count">
          {loading ? "加载中" : error ? "加载失败" : `最近 ${countText} 条`}
        </span>
        <span className="ops-section-right">
          {loading || error ? "—" : `${formatShortTime(new Date().toISOString())} 更新`}
        </span>
      </button>
      {open && <div className="ops-section-body">{body}</div>}
    </section>
  );
}
