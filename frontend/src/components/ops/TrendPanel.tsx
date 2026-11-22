import { useMemo, useState } from "react";
import type { HistoryPoint } from "../../types";
import { ChevronIcon } from "./icons";
import { formatNumber, toDate } from "./ops";

interface TrendPanelProps {
  history?: HistoryPoint[] | null;
  loading: boolean;
}

/** 与后端历史保持一致：一天取最后一个快照，跨 7 个自然日 */
function useTrendPoints(history?: HistoryPoint[] | null) {
  return useMemo(() => {
    const byDay = new Map<
      string,
      { date: Date; total: number; detail: number }
    >();
    for (const point of history ?? []) {
      const date = toDate(point.ts);
      if (!date) continue;
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const prev = byDay.get(key);
      if (!prev || date > prev.date) {
        byDay.set(key, {
          date,
          total: point.total,
          detail: point.with_detail,
        });
      }
    }
    return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(-7);
  }, [history]);
}

function formatAxis(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function Chart({
  points,
}: {
  points: { date: Date; total: number; detail: number }[];
}) {
  const W = 1000;
  const H = 220;
  const left = 52;
  const right = 14;
  const top = 14;
  const bottom = 30;
  const max = Math.max(1, ...points.map((p) => p.total), ...points.map((p) => p.detail)) * 1.04;
  const n = points.length;
  const x = (index: number) =>
    left + (n <= 1 ? 0 : (index * (W - left - right)) / (n - 1));
  const y = (value: number) => top + (1 - value / max) * (H - top - bottom);
  const line = (key: "total" | "detail") =>
    points
      .map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`)
      .join(" ");
  const area = `${left},${H - bottom} ${line("total")} ${x(n - 1)},${H - bottom}`;
  const grid = [0, 0.5, 1].map((ratio) => {
    const yy = top + (1 - ratio) * (H - top - bottom);
    const value = (max * ratio) / 1.04;
    return (
      <g key={ratio}>
        <line
          x1={left}
          y1={yy}
          x2={W - right}
          y2={yy}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="4 5"
        />
        <text
          x={left - 10}
          y={yy + 4}
          textAnchor="end"
          fontSize={10}
          fill="var(--text-muted)"
        >
          {formatAxis(value)}
        </text>
      </g>
    );
  });
  return (
    <svg
      className="ops-trend-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="7 天收录与补全趋势"
    >
      {grid}
      <polygon points={area} fill="var(--primary-dim)" stroke="none" />
      <polyline
        points={line("total")}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points={line("detail")}
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((point, index) => (
        <text
          key={point.date.toISOString()}
          x={x(index)}
          y={H - 6}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-muted)"
        >
          {point.date.getMonth() + 1}-{String(point.date.getDate()).padStart(2, "0")}
        </text>
      ))}
    </svg>
  );
}

export default function TrendPanel({ history, loading }: TrendPanelProps) {
  const [open, setOpen] = useState(false);
  const points = useTrendPoints(history);
  const summary =
    points.length >= 2
      ? {
          total: points[points.length - 1].total - points[0].total,
          detail: points[points.length - 1].detail - points[0].detail,
        }
      : null;
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value)}`;

  if (loading) {
    return (
      <div className="ops-trend-row" style={{ cursor: "default" }}>
        <span className="ops-trend-chev" style={{ opacity: 0.3 }}>
          <ChevronIcon />
        </span>
        <span className="ops-trend-title">7 天趋势</span>
        <span className="ops-trend-summary">数据加载中…</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="ops-trend-row"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ops-trend-chev">
          <ChevronIcon />
        </span>
        <span className="ops-trend-title">7 天趋势</span>
        <span className="ops-trend-summary">
          {summary
            ? `收录 ${signed(summary.total)} · 补全 ${signed(summary.detail)}`
            : "数据积累中"}
        </span>
        <span className="ops-trend-hint">
          {summary ? `${points.length} 个快照` : ""}
        </span>
      </button>
      {open && (
        <div className="ops-trend-body">
          {points.length >= 2 ? (
            <>
              <div className="ops-trend-legend">
                <span>
                  <i className="ops-legend-dot" />
                  总已收录
                </span>
                <span>
                  <i className="ops-legend-dot is-alt" />
                  总已补全
                </span>
              </div>
              <Chart points={points} />
            </>
          ) : (
            <div className="ops-trend-empty">
              数据积累中，需至少两个历史快照
            </div>
          )}
        </div>
      )}
    </>
  );
}
