import { useCallback, useEffect, useMemo, useState } from "react";
import { listCategoryAliases } from "../../api/category-aliases";
import {
  getCategoryMapSummary,
  getSiteCategoryMap,
  saveSiteCategoryMap,
  undoSiteCategoryMap,
  type CategoryMapGroup,
  type CategoryMapResponse,
} from "../../api/category-map";
import { listSites } from "../../api/sites";
import {
  createSystemCategory,
  listSystemCategories,
} from "../../api/system-categories";
import { toastError } from "../../utils/toast";
import type { Site, SystemCategoryTreeItem } from "../../types";
import CategoryCombobox, { type CategoryOption } from "./CategoryCombobox";
import "./CategoryWorkbench.css";

type Draft = { system: string; scope: "global" | "site" };

const FILL_REST = "其他资源";
/** 置信度低于它不预填（用户定的阈值 70%） */
const PREFILL_THRESHOLD = 0.7;

const SOURCE_LABEL: Record<string, string> = {
  history: "本站历史映射",
  rule: "关键词规则",
  similarity: "名称相似度",
  none: "规则与相似度都未命中",
};

function groupLabel(group: CategoryMapGroup): string {
  return group.names.map((item) => item.raw_name).join(" / ");
}

export default function CategoryWorkbench() {
  const [sites, setSites] = useState<Site[]>([]);
  const [unmappedBySite, setUnmappedBySite] = useState<Record<number, number>>({});
  const [siteId, setSiteId] = useState<number | null>(null);
  const [data, setData] = useState<CategoryMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSystem, setBulkSystem] = useState("");
  const [fillRest, setFillRest] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [view, setView] = useState<"unmapped" | "all">("all");
  const [sort, setSort] = useState<"confidence" | "sources">("confidence");
  const [query, setQuery] = useState("");
  const [showSamples, setShowSamples] = useState(true);

  const [categories, setCategories] = useState<string[]>([]);
  const [tree, setTree] = useState<SystemCategoryTreeItem[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);

  const loadMap = useCallback(async (id: number) => {
    setLoading(true);
    try {
      setData(await getSiteCategoryMap(id));
      setDrafts({});
      setSelected(new Set());
      setFillRest(false);
    } catch {
      // client 已统一 toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      listSites(),
      listCategoryAliases(),
      listSystemCategories(),
      getCategoryMapSummary().catch(() => ({ items: [] })),
    ])
      .then(([siteList, aliasResp, treeResp, summaryResp]) => {
        const counts: Record<number, number> = {};
        for (const item of summaryResp.items) {
          counts[item.site_id] = item.unmapped;
        }
        setUnmappedBySite(counts);
        // 默认选中「问题最多」的站点；都干净时退回第一个
        const ordered = [...siteList].sort(
          (a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)
        );
        setSites(ordered);
        setCategories(aliasResp.system_categories);
        setTree(treeResp);
        const firstBroken = ordered.find((site) => (counts[site.id] ?? 0) > 0);
        if (firstBroken ?? ordered[0]) {
          setSiteId((firstBroken ?? ordered[0]).id);
        }
      })
      .catch(() => {
        // client 已统一 toast
      });
  }, []);

  useEffect(() => {
    if (siteId !== null) loadMap(siteId);
  }, [siteId, loadMap]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(timer);
  }, [toast]);

  const parents = useMemo(() => tree.map((item) => item.name), [tree]);
  const parentIdByName = useMemo(
    () => new Map(tree.map((item) => [item.name, item.id])),
    [tree]
  );

  const options: CategoryOption[] = useMemo(
    () => categories.map((name) => ({ name })),
    [categories]
  );

  const groups = data?.groups ?? [];
  const unmapped = useMemo(() => groups.filter((group) => !group.mapped), [groups]);
  const mapped = useMemo(() => groups.filter((group) => group.mapped), [groups]);

  const draftOf = (group: CategoryMapGroup) => drafts[group.group_key];

  const effectiveSystem = (group: CategoryMapGroup) => {
    const draft = draftOf(group);
    if (draft) return draft.system;
    if (group.current_system) return group.current_system;
    if (group.confidence > PREFILL_THRESHOLD && group.suggested_system) {
      return group.suggested_system;
    }
    return "";
  };

  const effectiveScope = (group: CategoryMapGroup): "global" | "site" =>
    draftOf(group)?.scope ?? group.scope ?? "global";

  const rememberRecent = (name: string) =>
    setRecent((prev) => [name, ...prev.filter((item) => item !== name)].slice(0, 5));

  const setGroupSystem = (group: CategoryMapGroup, system: string) => {
    if (!system) return;
    rememberRecent(system);
    setDrafts((prev) => ({
      ...prev,
      [group.group_key]: { system, scope: effectiveScope(group) },
    }));
  };

  const setGroupScope = (group: CategoryMapGroup, siteOnly: boolean) => {
    const system = effectiveSystem(group);
    if (!system) return;
    setDrafts((prev) => ({
      ...prev,
      [group.group_key]: { system, scope: siteOnly ? "site" : "global" },
    }));
  };

  const toggleSelected = (group: CategoryMapGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(group.group_key)) next.delete(group.group_key);
      else next.add(group.group_key);
      return next;
    });
  };

  const acceptHighConfidence = () => {
    const targets = unmapped.filter(
      (group) => group.confidence >= 0.9 && group.suggested_system
    );
    if (targets.length === 0) {
      toastError("没有置信度 ≥90% 的建议");
      return;
    }
    setSelected(new Set(targets.map((group) => group.group_key)));
    setBulkSystem((current) => current || (targets[0].suggested_system as string));
  };

  const applyBulk = () => {
    if (!bulkSystem) {
      toastError("先选一个目标分类");
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const group of unmapped) {
        if (selected.has(group.group_key)) {
          next[group.group_key] = { system: bulkSystem, scope: "global" };
        }
      }
      return next;
    });
    rememberRecent(bulkSystem);
    setSelected(new Set());
  };

  const createCategory = async (name: string, parentName: string | null) => {
    try {
      await createSystemCategory({
        name,
        parent_id: parentName ? parentIdByName.get(parentName) ?? null : null,
        sort: 999,
      });
    } catch {
      // 同名已存在时也直接选中，避免打断流程
    }
    try {
      const resp = await listCategoryAliases();
      setCategories(resp.system_categories);
      setTree(await listSystemCategories());
    } catch {
      // ignore
    }
    rememberRecent(name);
    return name;
  };

  const doSave = async (withFillRest: boolean) => {
    if (!data || siteId === null) return;
    const items = pending
      .map((entry) => ({
        raw_names: entry.group.names.map((name) => name.raw_name),
        system_name: entry.system,
        scope: entry.scope,
      }))
      .filter((item) => item.raw_names.length > 0);

    if (items.length === 0 && !withFillRest) {
      toastError("还没有要保存的修改");
      return;
    }

    setSaving(true);
    try {
      const result = await saveSiteCategoryMap(
        siteId,
        items,
        withFillRest ? FILL_REST : null
      );
      setToast({
        text: `已保存 ${result.names_touched} 项 · 重算 ${result.recomputed_videos} 条 · 未分类 ${result.uncategorized_before} → ${result.uncategorized_after}`,
        undo: Boolean(result.undo_available),
      });
      await loadMap(siteId);
    } catch {
      // client 已统一 toast
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const undo = async () => {
    if (siteId === null) return;
    try {
      const result = await undoSiteCategoryMap(siteId);
      setToast({
        text: result.ok ? `已撤销，还原 ${result.names_restored ?? 0} 个类名` : "没有可撤销的操作",
        undo: false,
      });
      await loadMap(siteId);
    } catch {
      // client 已统一 toast
    }
  };

  const pending = useMemo(() => {
    const list: { group: CategoryMapGroup; system: string; scope: "global" | "site" }[] = [];
    for (const group of groups) {
      const draft = drafts[group.group_key];
      // 已完整映射且没改过的行不参与保存；预填的建议（>70%）与「部分已映射」都算待保存
      if (group.mapped && !group.partial && !draft) continue;
      const system = draft?.system ?? effectiveSystem(group);
      if (!system) continue;
      list.push({ group, system, scope: draft?.scope ?? group.scope ?? "global" });
    }
    return list;
  }, [groups, drafts, effectiveSystem]);

  const dirtyCount = pending.length;
  const filteredUnmapped = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = unmapped.filter(
      (group) => !keyword || group.names.some((name) => name.raw_name.toLowerCase().includes(keyword))
    );
    return [...list].sort((a, b) =>
      sort === "confidence" ? a.confidence - b.confidence : b.sources - a.sources
    );
  }, [unmapped, query, sort]);

  const renderRow = (group: CategoryMapGroup, selectable: boolean) => {
    const names = group.names;
    const first = names[0];
    const adult = names.some((name) => name.adult);
    const suggestion = group.suggested_system;
    const confidence = group.confidence;
    const low = confidence <= PREFILL_THRESHOLD;

    return (
      <div className="wb-row" key={group.group_key}>
        {selectable ? (
          <input
            type="checkbox"
            checked={selected.has(group.group_key)}
            onChange={() => toggleSelected(group)}
            aria-label={`选择 ${groupLabel(group)}`}
          />
        ) : (
          <span />
        )}

        <div>
          <div className="wb-names">
            <span className="wb-name">{first.raw_name}</span>
            {names.length > 1 && (
              <span className="wb-variant">
                / {names.slice(1).map((name) => name.raw_name).join(" / ")}
              </span>
            )}
            {group.mapped && <span className="wb-pill">已映射</span>}
            {group.partial && <span className="wb-pill is-low">部分已映射</span>}
            {!group.mapped && adult && <span className="wb-pill">成人词库</span>}
            {!group.mapped && draftOf(group) && <span className="wb-pill is-new">待保存</span>}
          </div>
          <div className="wb-meta">
            <span>{group.sources.toLocaleString()} 条</span>
            <span>{group.videos.toLocaleString()} 个视频</span>
          </div>
          <div className={`wb-samples${adult && !showSamples ? " is-blurred" : ""}`}>
            <span>{first.samples[0] ?? "（无样例）"}</span>
            {first.samples.length > 1 && <span className="wb-more">+{first.samples.length - 1} 条</span>}
          </div>
          {group.cross_site.sites > 0 && (
            <div className="wb-cross">
              <span>ⓘ</span>
              <span>
                另外 <b>{group.cross_site.sites} 个站点</b>也用了这个类名，合计{" "}
                <b>{group.cross_site.sources.toLocaleString()}</b> 条
              </span>
            </div>
          )}
        </div>

        <div className="wb-suggest">
          {group.mapped ? (
            <span className="wb-src">{group.scope === "site" ? "站点例外" : "全局别名"}</span>
          ) : suggestion ? (
            <>
              <span className={`wb-pill${low ? " is-low" : ""}`}>
                {low ? "低置信 " : "建议 · "}
                {suggestion} {Math.round(confidence * 100)}%
              </span>
              <div className="wb-conf">
                <i className={low ? "low" : ""} style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
              <span className="wb-src">来源：{SOURCE_LABEL[group.suggestion_source] ?? group.suggestion_source}</span>
            </>
          ) : (
            <>
              <span className="wb-pill">无建议</span>
              <span className="wb-src">{SOURCE_LABEL.none}</span>
            </>
          )}
        </div>

        <CategoryCombobox
          value={effectiveSystem(group)}
          options={options}
          recent={recent}
          onChange={(system) => setGroupSystem(group, system)}
          onCreate={createCategory}
          parents={parents}
          disabled={saving}
          ariaLabel={`把 ${groupLabel(group)} 归类`}
        />

        <label className="wb-scope">
          <input
            type="checkbox"
            checked={effectiveScope(group) === "site"}
            onChange={(event) => setGroupScope(group, event.target.checked)}
            disabled={saving}
          />
          仅本站
        </label>
      </div>
    );
  };

  return (
    <div className="workbench">
      <div className="wb-top">
        <select
          className="wb-site"
          value={siteId ?? ""}
          onChange={(event) => setSiteId(Number(event.target.value))}
          aria-label="选择站点"
        >
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
              {unmappedBySite[site.id] ? `（${unmappedBySite[site.id]} 个未映射）` : ""}
            </option>
          ))}
        </select>
        {data && (
          <>
            <span className="wb-chip">
              <b>{data.stats.names}</b> 个远程类名
            </span>
            <span className="wb-chip">
              <b>{data.stats.mapped}</b> 已映射
            </span>
            <span className={`wb-chip${data.stats.unmapped > 0 ? " warn" : ""}`}>
              <b>{data.stats.unmapped}</b> 未映射
            </span>
            <span className="wb-chip">
              未分类视频 <b>{data.stats.uncategorized_videos}</b>
            </span>
          </>
        )}
      </div>

      {data && (unmapped.length > 0 || dirtyCount > 0) && (
        <div className="wb-progress">
          <span>
            本次已确认 <b>{dirtyCount}</b>/{unmapped.length} 组
          </span>
          <div className="wb-track">
            <i style={{ width: `${unmapped.length ? (dirtyCount / unmapped.length) * 100 : 0}%` }} />
          </div>
          <div className="grow" />
          <button
            type="button"
            className="btn wb-accent sm"
            onClick={acceptHighConfidence}
            disabled={saving || unmapped.length === 0}
          >
            勾选 ≥90% 建议（
            {unmapped.filter((group) => group.confidence >= 0.9).length} 组）
          </button>
        </div>
      )}

      <div className="wb-toolbar">
        <input
          className="wb-search"
          type="search"
          placeholder="搜索类名"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="wb-seg">
          <button
            type="button"
            className={view === "unmapped" ? "on" : ""}
            onClick={() => setView("unmapped")}
          >
            只看未映射
          </button>
          <button type="button" className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
            全部
          </button>
        </div>
        <div className="wb-seg">
          <button
            type="button"
            className={sort === "confidence" ? "on" : ""}
            onClick={() => setSort("confidence")}
          >
            置信度 ↑
          </button>
          <button
            type="button"
            className={sort === "sources" ? "on" : ""}
            onClick={() => setSort("sources")}
          >
            视频数 ↓
          </button>
        </div>
        <div className="wb-seg">
          <button
            type="button"
            className={showSamples ? "on" : ""}
            onClick={() => setShowSamples(true)}
          >
            样例显示
          </button>
          <button
            type="button"
            className={showSamples ? "" : "on"}
            onClick={() => setShowSamples(false)}
          >
            模糊
          </button>
        </div>
        <div className="grow" />
        <button
          type="button"
          className="btn sm"
          onClick={() => siteId !== null && loadMap(siteId)}
          disabled={loading}
        >
          刷新
        </button>
      </div>

      {loading ? (
        <div className="wb-empty">加载中…</div>
      ) : !data ? (
        <div className="wb-empty">没有数据</div>
      ) : (
        <div className="wb-card">
          <div className="wb-row is-head">
            <span />
            <span>远程类名 / 变体</span>
            <span>建议</span>
            <span>目标分类</span>
            <span>范围</span>
          </div>

          {filteredUnmapped.map((group) => renderRow(group, true))}
          {filteredUnmapped.length === 0 && (
            <div className="wb-empty">没有未映射的类名了 🎉</div>
          )}

          {view === "all" && mapped.length > 0 && (
            <details>
              <summary className="wb-mapped-head">
                ▶ 已映射（{mapped.length}）—— 展开可改分类 / 改范围
              </summary>
              {mapped.map((group) => renderRow(group, false))}
            </details>
          )}

          <div className="wb-foot">
            <span>
              已选 <b>{selected.size}</b> 组
            </span>
            <select
              className="wb-site"
              style={{ minWidth: 140, height: 30, fontSize: 12 }}
              value={bulkSystem}
              onChange={(event) => setBulkSystem(event.target.value)}
            >
              <option value="">归到…</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn sm"
              onClick={applyBulk}
              disabled={saving || selected.size === 0}
            >
              应用
            </button>
            <label className="wb-scope">
              <input
                type="checkbox"
                checked={fillRest}
                onChange={(event) => setFillRest(event.target.checked)}
              />
              剩余未选归到「{FILL_REST}」
            </label>
            <div className="right">
              <span>
                未分类 <b>{data.stats.uncategorized_videos}</b>
              </span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || dirtyCount === 0}
                onClick={() => (fillRest ? setConfirmOpen(true) : doSave(false))}
              >
                保存 {dirtyCount} 项
              </button>
            </div>
          </div>
        </div>
      )}

      {data && data.stats.no_name_videos > 0 && (
        <div className="wb-src">
          另有 {data.stats.no_name_sources} 条来源没有分类名（{data.stats.no_name_videos} 个视频），别名无法修复
        </div>
      )}

      {confirmOpen && data && (
        <div className="wb-dialog-mask">
          <div className="wb-dialog">
            <div className="wb-dialog-head">
              <h3>剩余未选的类名会被归到「{FILL_REST}」</h3>
              <p>
                保存后，勾选行之外的未映射类名也会一起完成映射，且无法通过「撤销」恢复成未分类。
              </p>
            </div>
            <div className="wb-dialog-list">
              {filteredUnmapped
                .filter((group) => !draftOf(group)?.system)
                .slice(0, 8)
                .map((group) => (
                  <div className="wb-dialog-row" key={group.group_key}>
                    <span>{groupLabel(group)}</span>
                    <span>{group.sources.toLocaleString()} 条</span>
                  </div>
                ))}
            </div>
            <div className="wb-dialog-foot">
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => doSave(false)}
                disabled={saving}
              >
                只保存已选 {dirtyCount} 项
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => doSave(true)}
                disabled={saving}
              >
                确认，全部归到「{FILL_REST}」
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="wb-toast">
          <span className="bar" />
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="btn sm" onClick={undo}>
              撤销
            </button>
          )}
        </div>
      )}
    </div>
  );
}
