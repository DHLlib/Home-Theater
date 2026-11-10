import { useCallback, useEffect, useState } from "react";
import { adoptCategoryAliases } from "../../api/category-aliases";
import {
  listUncategorizedVideos,
  type UncategorizedItem,
} from "../../api/videos";
import { toastError, toastSuccess } from "../../utils/toast";
import "./UncategorizedDiagnosis.css";

interface Props {
  systemCategories: string[];
  /** 归类后通知父组件刷新别名列表与统计 */
  onChanged?: () => void;
}

const itemKey = (item: UncategorizedItem) => `${item.title}::${item.year ?? ""}`;

/**
 * 未分类诊断：逐条说明「为什么没归到系统分类」，并提供一键归类。
 *
 * 归因来自后端 /api/videos/uncategorized：每个来源标出 no_alias / adult_blocked /
 * no_type_name / alias_disabled。能通过补别名修复的（有 candidate_name）直接归类，
 * 归完立刻重算；来源没给类名的只能如实告知，别名修不了。
 */
export default function UncategorizedDiagnosis({ systemCategories, onChanged }: Props) {
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<UncategorizedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const data = await listUncategorizedVideos(100);
      setTotal(data.total);
      setItems(data.items);
    } catch {
      // client 已统一 toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const assign = (item: UncategorizedItem) => {
    const rawName = item.candidate_name;
    const system = drafts[itemKey(item)] ?? item.candidate_system ?? "";
    if (!rawName) return;
    if (!system) {
      toastError("先选一个系统分类");
      return;
    }
    if (busy) return;
    setBusy(true);
    adoptCategoryAliases([{ raw_name: rawName, system_name: system }])
      .then(async () => {
        toastSuccess(`已归类「${rawName}」→ ${system}`);
        await reload();
        onChanged?.();
      })
      .catch(() => {
        // client 已统一 toast
      })
      .finally(() => setBusy(false));
  };

  return (
    <details className="uncat-diag" open={total > 0}>
      <summary>未分类诊断（{total}）</summary>
      <div className="uncat-hint">
        每条未分类内容都会说明「为什么没归类」；能补别名的可以直接归，归完立刻重算。
      </div>

      {loading ? (
        <div className="alias-empty">加载中…</div>
      ) : items.length === 0 ? (
        <div className="alias-empty">没有未分类内容</div>
      ) : (
        <div className="alias-rows">
          {items.map((item) => {
            const key = itemKey(item);
            const value = drafts[key] ?? item.candidate_system ?? "";
            const reasons = [...new Set(item.sources.map((s) => s.reason_text))];
            return (
              <div className="alias-row" key={key}>
                <div className="alias-row-main">
                  <span className="alias-name">
                    {item.title}
                    {item.year ? ` (${item.year})` : ""}
                  </span>
                  <span className="alias-sub">
                    {item.sources
                      .map(
                        (s) => `${s.site_name ?? `站点${s.site_id}`} · ${s.type_name ?? "无类名"}`
                      )
                      .join(" / ")}
                  </span>
                  <span className="alias-meta">{reasons.join("；")}</span>
                </div>
                {item.candidate_name ? (
                  <>
                    <select
                      className="alias-select"
                      value={value}
                      onChange={(event) =>
                        setDrafts((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                      aria-label={`把类名 ${item.candidate_name} 归类`}
                    >
                      <option value="">选择系统分类</option>
                      {systemCategories.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn alias-btn"
                      onClick={() => assign(item)}
                      disabled={busy || !value}
                    >
                      归类
                    </button>
                  </>
                ) : (
                  <span className="uncat-nofix">来源没给类名，别名修不了</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {total > items.length && (
        <div className="uncat-hint">
          共 {total} 条，仅显示最新 {items.length} 条
        </div>
      )}
    </details>
  );
}
