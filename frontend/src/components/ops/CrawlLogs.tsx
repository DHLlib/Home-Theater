import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCrawlerLogs } from "../../api/videos";
import { ChevronIcon } from "./icons";
import { formatLogTime, formatNumber } from "./ops";

export default function CrawlLogs() {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["crawler-logs"],
    queryFn: getCrawlerLogs,
    enabled: open,
    staleTime: 60_000,
  });
  const logs = query.data?.logs ?? [];
  const last = logs[0] ? formatLogTime(logs[0].timestamp) : "—";
  const countText = query.isLoading
    ? "加载中"
    : query.isError
      ? "加载失败"
      : !open && !query.data
        ? "展开查看"
        : logs.length
          ? `最近 ${logs.length} 条`
          : "暂无记录";

  let body: ReactNode;
  if (query.isLoading) {
    body = [0, 1, 2].map((i) => (
      <div
        key={i}
        className="ops-skeleton-card"
        style={{ minHeight: 46, padding: 12, marginBottom: 6 }}
      >
        <div className="ops-skeleton ops-skeleton-line" style={{ width: "78%" }} />
      </div>
    ));
  } else if (query.isError) {
    body = (
      <div className="ops-task-empty">
        刮削日志加载失败{" "}
        <button type="button" className="ops-text-btn" onClick={() => query.refetch()}>
          重试
        </button>
      </div>
    );
  } else if (!logs.length) {
    body = <div className="ops-task-empty">暂无刮削记录</div>;
  } else {
    body = (
      <>
        <div className="ops-log-wrap">
          <table className="ops-log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>站点</th>
                <th>分类</th>
                <th className="is-num">页</th>
                <th>类型</th>
                <th className="is-num">处理</th>
                <th className="is-num">新增</th>
                <th className="is-num">更新</th>
                <th className="is-num">耗时</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={`${log.timestamp}-${log.site_id}-${index}`}>
                  <td className="is-muted">{formatLogTime(log.timestamp)}</td>
                  <td>{log.site_name}</td>
                  <td className="is-muted">{log.category}</td>
                  <td className="is-num">{log.page}</td>
                  <td>{log.crawl_type === "full" ? "全量" : "增量"}</td>
                  <td className="is-num">{formatNumber(log.items_count)}</td>
                  <td className={`is-num ${log.new_count > 0 ? "is-new" : "is-muted"}`}>
                    {formatNumber(log.new_count)}
                  </td>
                  <td className="is-num">{formatNumber(log.update_count)}</td>
                  <td className="is-num is-muted">{log.duration_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ops-log-list">
          {logs.map((log, index) => (
            <div className="ops-log-row" key={`${log.timestamp}-${log.site_id}-${index}`}>
              <div className="ops-log-main">
                <div>
                  {log.site_name} · {log.category}
                </div>
                <div className="ops-log-nums">
                  {log.crawl_type === "full" ? "全量" : "增量"} · 处理{" "}
                  {formatNumber(log.items_count)} · 新增{" "}
                  <span className="is-new">{formatNumber(log.new_count)}</span> ·
                  更新 {formatNumber(log.update_count)} · {log.duration_ms}ms
                </div>
              </div>
              <span className="ops-log-time">{formatLogTime(log.timestamp)}</span>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <section className="ops-section">
      <button
        type="button"
        className="ops-section-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ops-section-chev">
          <ChevronIcon />
        </span>
        <span className="ops-section-title">刮削日志</span>
        <span className="ops-section-count">{countText}</span>
        <span className="ops-section-right">{query.isLoading ? "—" : last}</span>
      </button>
      {open && <div className="ops-section-body">{body}</div>}
    </section>
  );
}
