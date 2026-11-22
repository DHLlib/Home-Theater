import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSiteHealth, probeSite, updateSite } from "../../api/sites";
import { ApiError } from "../../api/client";
import { toastError, toastSuccess } from "../../utils/toast";
import type {
  MaintenanceJob,
  Site,
  SiteMaintenanceStatus,
} from "../../types";
import { CheckIcon, CloseIcon, XIcon } from "./icons";
import {
  formatFullTime,
  formatNumber,
  formatShortTime,
  healthOf,
  isActiveJob,
  kindLabel,
  rateText,
  stateLabel,
  stateTone,
  triggerLabel,
} from "./ops";

interface SiteOpsSheetProps {
  site: Site | null;
  status?: SiteMaintenanceStatus;
  jobs: MaintenanceJob[];
  startingKind?: string;
  onClose: () => void;
  onStart: (kind: "detail.fill" | "crawl.incremental") => void;
  onCancelJob: (job: MaintenanceJob) => void;
  onRequestDelete: (site: Site) => void;
  onRefresh: () => void;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return fallback;
}

export default function SiteOpsSheet({
  site,
  status,
  jobs,
  startingKind,
  onClose,
  onStart,
  onCancelJob,
  onRequestDelete,
  onRefresh,
}: SiteOpsSheetProps) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setEditing(false);
    setName(site?.name ?? "");
    setUrl(site?.base_url ?? "");
  }, [site?.id, site?.name, site?.base_url]);

  useEffect(() => {
    if (!site) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [site]);

  const healthQuery = useQuery({
    queryKey: ["site-health", site?.id],
    queryFn: () => getSiteHealth(site!.id),
    enabled: Boolean(site),
    staleTime: 15_000,
  });

  if (!site) return null;

  const enabled = status?.enabled ?? site.enabled;
  const pending = status?.without_detail ?? 0;
  const total = status?.total ?? 0;
  const withDetail = status?.with_detail ?? 0;
  const healthChip = status
    ? healthOf(status)
    : { tone: enabled ? ("muted" as const) : ("muted" as const), text: enabled ? "未探测" : "已禁用", error: null };
  const activeJob = jobs.find(
    (job) => isActiveJob(job) && job.site_id === site.id
  );
  const fillActive =
    activeJob?.kind === "detail.fill" ||
    jobs.some(
      (job) => isActiveJob(job) && job.kind === "detail.fill" && job.site_id == null
    );
  const crawlActive = activeJob?.kind === "crawl.incremental";
  const startingFill = startingKind === "detail.fill";
  const startingCrawl = startingKind === "crawl.incremental";
  const latestProbe = healthQuery.data?.latest_probe ?? null;
  const availability =
    healthQuery.data?.availability_24h != null
      ? `${Number(healthQuery.data.availability_24h)
          .toFixed(1)
          .replace(/\.0$/, "")}%`
      : "—";
  const probeLogs = healthQuery.data?.recent_logs ?? [];
  const siteJobs = jobs
    .filter((job) => job.site_id === site.id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 4);
  const primaryFill = enabled && pending > 0;
  const primaryCrawl = enabled && pending === 0;
  const deleteBlocked = Boolean(activeJob);

  const handleProbe = async () => {
    setProbing(true);
    try {
      await probeSite(site.id);
      await queryClient.invalidateQueries({
        queryKey: ["site-health", site.id],
      });
      onRefresh();
      toastSuccess("探测完成");
    } catch (error) {
      toastError(`探测失败：${errorText(error, "请稍后重试")}`);
    } finally {
      setProbing(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await updateSite(site.id, { enabled: !enabled });
      onRefresh();
      toastSuccess(enabled ? "站点已禁用" : "站点已启用");
    } catch (error) {
      toastError(`更新站点失败：${errorText(error, "请稍后重试")}`);
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    const nextName = name.trim();
    const nextUrl = url.trim();
    if (!nextName || !nextUrl) {
      toastError("名称和地址不能为空");
      return;
    }
    setSaving(true);
    try {
      await updateSite(site.id, { name: nextName, base_url: nextUrl });
      onRefresh();
      setEditing(false);
      toastSuccess("站点已更新");
    } catch (error) {
      toastError(`更新站点失败：${errorText(error, "请稍后重试")}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ops-sheet-layer">
      <div className="ops-sheet-scrim" onClick={onClose} />
      <div
        className="ops-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-sheet-title"
      >
        <div className="ops-sheet-handle" aria-hidden="true" />
        <div className="ops-sheet-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ops-sheet-title-row">
              <h2 className="ops-sheet-title" id="ops-sheet-title">
                {site.name}
              </h2>
              <span className={`ops-health is-${healthChip.tone}`}>
                {healthChip.text}
              </span>
            </div>
            <div className="ops-sheet-url" title={site.base_url}>
              {site.base_url || "地址未记录"}
            </div>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="ops-sheet-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="ops-sheet-body">
          {editing && (
            <form
              className="ops-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSave();
              }}
            >
              <div className="ops-field">
                <label htmlFor="ops-edit-name">站点名称</label>
                <input
                  id="ops-edit-name"
                  className="ops-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="ops-field">
                <label htmlFor="ops-edit-url">站点地址</label>
                <input
                  id="ops-edit-url"
                  className="ops-input"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className="ops-edit-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  取消
                </button>
              </div>
            </form>
          )}

          <div className="ops-sheet-section">
            <h3 className="ops-sheet-h">健康</h3>
            <div className="ops-kv">
              <span className="ops-kv-k">最新探测</span>
              <span className={`ops-kv-v is-${healthChip.tone}`}>
                {healthChip.text}
              </span>
            </div>
            {latestProbe?.error && healthChip.tone === "bad" && (
              <div className="ops-kv-error">{latestProbe.error}</div>
            )}
            <div className="ops-kv">
              <span className="ops-kv-k">24h 可用率</span>
              <span className="ops-kv-v">
                {healthQuery.isLoading ? "加载中…" : availability}
              </span>
            </div>
            {healthQuery.isError && (
              <div className="ops-kv-error">健康详情加载失败</div>
            )}
            {!enabled && healthQuery.data?.auto_disabled_at && (
              <div className="ops-warn-box">
                自动禁用于 {formatFullTime(healthQuery.data.auto_disabled_at)}。
                建议先探测确认站点恢复，再启用。
              </div>
            )}
          </div>

          <div className="ops-sheet-section">
            <h3 className="ops-sheet-h">数据</h3>
            <div className="ops-data-grid">
              <div>
                <span className="ops-data-k">已收录</span>
                <span className="ops-data-v">{formatNumber(total)}</span>
              </div>
              <div>
                <span className="ops-data-k">已补全</span>
                <span className="ops-data-v">{formatNumber(withDetail)}</span>
              </div>
              <div>
                <span className="ops-data-k">未补全</span>
                <span
                  className="ops-data-v"
                  style={pending > 0 ? { color: "var(--danger)" } : undefined}
                >
                  {formatNumber(pending)}
                </span>
              </div>
              <div>
                <span className="ops-data-k">补全率</span>
                <span className="ops-data-v">
                  {rateText(total, withDetail, pending)}
                </span>
              </div>
            </div>
          </div>

          <div className="ops-sheet-section">
            <h3 className="ops-sheet-h">操作</h3>
            <div className="ops-actions-grid">
              <button
                type="button"
                className={`btn${primaryFill ? " btn-primary" : ""}`}
                disabled={!enabled || fillActive || startingFill}
                onClick={() => onStart("detail.fill")}
              >
                {fillActive || startingFill ? "补全中…" : "单站补全"}
              </button>
              <button
                type="button"
                className={`btn${primaryCrawl && !crawlActive ? " btn-primary" : ""}`}
                disabled={!enabled || crawlActive || startingCrawl}
                onClick={() => onStart("crawl.incremental")}
              >
                {crawlActive || startingCrawl ? "刮削中…" : "增量刮削"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={probing}
                onClick={() => void handleProbe()}
              >
                {probing ? "探测中…" : "立即探测"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => {
                  setEditing(true);
                  setName(site.name);
                  setUrl(site.base_url);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className={`btn is-span2${!enabled ? " btn-primary" : ""}`}
                disabled={toggling}
                onClick={() => void handleToggle()}
              >
                {toggling ? "提交中…" : enabled ? "禁用站点" : "启用站点"}
              </button>
            </div>
            {!enabled && (
              <div className="ops-sheet-hint">
                站点已禁用，启用后才能刮削或补全。
              </div>
            )}
          </div>

          <div className="ops-sheet-section">
            <h3 className="ops-sheet-h">本站任务</h3>
            {siteJobs.length > 0 ? (
              <div className="ops-history">
                {siteJobs.map((job) => (
                  <div className="ops-history-row" key={job.id}>
                    <span className="ops-history-time">
                      {formatShortTime(job.created_at)}
                    </span>
                    <span className="ops-history-grow">
                      {kindLabel(job.kind)}
                      {job.trigger ? ` · ${triggerLabel(job.trigger)}` : ""}
                    </span>
                    <span className={`ops-state is-${stateTone(job.state)}`}>
                      {stateLabel(job.state)}
                    </span>
                    {isActiveJob(job) && (
                      <button
                        type="button"
                        className="ops-text-btn"
                        onClick={() => onCancelJob(job)}
                      >
                        取消
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="ops-empty-line">暂无任务记录</div>
            )}
          </div>

          <div className="ops-sheet-section">
            <h3 className="ops-sheet-h">探测历史</h3>
            {probeLogs.length > 0 ? (
              <div className="ops-history">
                {probeLogs.slice(0, 5).map((log) => (
                  <div className="ops-history-row" key={log.id}>
                    <span className="ops-history-time">
                      {formatShortTime(log.created_at)}
                    </span>
                    <span
                      className={`ops-history-ico ${log.ok ? "ops-history-ok" : "ops-history-bad"}`}
                    >
                      {log.ok ? <CheckIcon /> : <XIcon />}
                    </span>
                    <span className="ops-history-grow">
                      {log.ok ? "正常" : log.error || "异常"}
                    </span>
                    <span className="ops-history-muted">
                      {log.ok && log.latency_ms != null
                        ? `${log.latency_ms}ms`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ops-empty-line">暂无探测记录</div>
            )}
          </div>

          <div className="ops-sheet-section ops-danger-zone">
            <div className="ops-danger-label">危险区</div>
            <button
              type="button"
              className="btn btn-danger"
              style={{ width: "100%" }}
              disabled={deleteBlocked}
              onClick={() => onRequestDelete(site)}
            >
              删除站点
            </button>
            {deleteBlocked && (
              <div className="ops-sheet-hint">
                本站任务运行中，完成后可删除。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
