import type { CrawlerStatsResponse } from "../../types";
import { formatNumber } from "./ops";

interface StatBarProps {
  stats?: CrawlerStatsResponse | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

export default function StatBar({ stats, loading, error, onRetry }: StatBarProps) {
  if (error) {
    return (
      <div className="ops-stat-error" role="alert">
        <strong style={{ color: "var(--danger)", fontWeight: 500 }}>
          统计加载失败
        </strong>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <button type="button" className="ops-text-btn" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  }
  if (loading || !stats) {
    return (
      <section className="ops-stat-strip" aria-busy="true" aria-label="数据概览">
        {[0, 1, 2, 3].map((i) => (
          <div className="ops-stat-cell" key={i}>
            <div className="ops-skeleton ops-skeleton-line" style={{ width: 52 }} />
            <div
              className="ops-skeleton"
              style={{ width: 120, height: 28, marginTop: 6 }}
            />
          </div>
        ))}
      </section>
    );
  }
  const danger = stats.without_detail > 0;
  return (
    <section className="ops-stat-strip" aria-label="数据概览">
      <div className="ops-stat-cell">
        <span className="ops-stat-label">已收录</span>
        <span className="ops-stat-value">{formatNumber(stats.total)}</span>
      </div>
      <div className="ops-stat-cell">
        <span className="ops-stat-label">已补全</span>
        <span className="ops-stat-value">{formatNumber(stats.with_detail)}</span>
      </div>
      <div className="ops-stat-cell">
        <span className="ops-stat-label">未补全</span>
        <span className={`ops-stat-value${danger ? " is-danger" : ""}`}>
          {formatNumber(stats.without_detail)}
        </span>
      </div>
      <div className="ops-stat-cell">
        <span className="ops-stat-label">已聚合</span>
        <span className="ops-stat-value">
          {formatNumber(stats.aggregated_count)}
        </span>
      </div>
    </section>
  );
}
