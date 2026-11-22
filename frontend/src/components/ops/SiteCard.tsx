import type { MaintenanceJob, SiteMaintenanceStatus } from "../../types";
import {
  cardMeta,
  formatNumber,
  healthOf,
  progressPercent,
  rateText,
} from "./ops";

interface SiteCardProps {
  site: SiteMaintenanceStatus;
  job?: MaintenanceJob;
  deleting?: boolean;
  onOpen: () => void;
}

export default function SiteCard({
  site,
  job,
  deleting = false,
  onOpen,
}: SiteCardProps) {
  const health = healthOf(site);
  const meta = cardMeta(site, job);
  const pending = site.without_detail || 0;
  return (
    <article
      className={`ops-card${deleting ? " is-deleting" : ""}`}
      aria-busy={deleting || undefined}
    >
      <button
        type="button"
        className="ops-card-open"
        aria-label={`打开 ${site.site_name} 的站点运维`}
        onClick={onOpen}
        disabled={deleting}
      />
      <div className="ops-card-content">
        <div className="ops-card-top">
          <span className={`ops-dot is-${health.tone}`} />
          <span className="ops-card-name">{site.site_name}</span>
          <span
            className={`ops-health is-${health.tone}`}
            title={health.error ?? ""}
          >
            {health.text}
          </span>
        </div>
        <div className="ops-card-mid">
          <span className="ops-pending">
            待补全{" "}
            <b className={pending > 0 ? "is-danger" : ""}>
              {formatNumber(pending)}
            </b>
            <span className="ops-pending-total">
              / {formatNumber(site.total)}
            </span>
          </span>
          <span className="ops-rate">
            {rateText(site.total, site.with_detail, site.without_detail)}
          </span>
        </div>
        <div className="ops-progress">
          <i style={{ width: `${progressPercent(site.total, site.with_detail)}%` }} />
        </div>
        <div className={`ops-card-meta${meta.active ? " is-active" : ""}`}>
          {deleting ? "删除中…" : meta.text}
        </div>
      </div>
    </article>
  );
}
