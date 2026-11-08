import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adoptCategoryAliases,
  deleteCategoryAlias,
  deleteCategoryOverride,
  listCategoryAliases,
  listCategoryOverrides,
  listUnmappedCategories,
  saveCategoryOverride,
  updateCategoryAlias,
  type CategoryAliasItem,
  type UnmappedCategoryItem,
} from "../../api/category-aliases";
import { listSites } from "../../api/sites";
import { toastError, toastSuccess } from "../../utils/toast";
import type { Site } from "../../types";
import "./AliasSettings.css";

interface OverrideItem {
  id: number;
  site_id: number;
  site_name: string | null;
  name_key: string;
  raw_name: string;
  system_name: string;
}

/**
 * 一屏式分类对照表：远程分类名 → 系统分类。
 *
 * 取代旧的「站点 × 远程分类」面板：别名是全局的，98 个类名覆盖全部站点，
 * 新增站点命中即自动生效，只有未识别类名和站点例外需要人工处理。
 */
export default function AliasSettings() {
  const [aliases, setAliases] = useState<CategoryAliasItem[]>([]);
  const [systemCategories, setSystemCategories] = useState<string[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedCategoryItem[]>([]);
  const [overrides, setOverrides] = useState<OverrideItem[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftSite, setDraftSite] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftSystem, setDraftSystem] = useState("");

  const reload = useCallback(async () => {
    try {
      const [aliasResp, unmappedResp, overrideResp, siteList] = await Promise.all([
        listCategoryAliases(),
        listUnmappedCategories(),
        listCategoryOverrides(),
        listSites(),
      ]);
      setAliases(aliasResp.items);
      setSystemCategories(aliasResp.system_categories);
      setUnmapped(unmappedResp.items);
      setOverrides(overrideResp.items);
      setSites(siteList);
    } catch {
      // client 已统一 toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalSources = useMemo(
    () => aliases.reduce((sum, item) => sum + item.source_count, 0),
    [aliases]
  );

  const filteredAliases = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return aliases;
    return aliases.filter(
      (item) =>
        item.system_name.toLowerCase().includes(keyword) ||
        item.name_key.toLowerCase().includes(keyword) ||
        item.raw_names.some((raw) => raw.toLowerCase().includes(keyword))
    );
  }, [aliases, query]);

  // 按系统分类分组，保持系统分类的原始顺序
  const groups = useMemo(() => {
    const bySystem = new Map<string, CategoryAliasItem[]>();
    for (const item of filteredAliases) {
      const list = bySystem.get(item.system_name) || [];
      list.push(item);
      bySystem.set(item.system_name, list);
    }
    const order = new Map(systemCategories.map((name, index) => [name, index]));
    return [...bySystem.entries()]
      .sort(
        (a, b) =>
          (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999) ||
          a[0].localeCompare(b[0], "zh")
      )
      .map(([systemName, items]) => ({
        systemName,
        items: items.sort((x, y) => y.source_count - x.source_count),
      }));
  }, [filteredAliases, systemCategories]);

  const suggestedCount = useMemo(
    () => unmapped.filter((item) => item.suggested_system_name).length,
    [unmapped]
  );

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await task();
      } catch {
        // client 已统一 toast
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const adoptOne = (item: UnmappedCategoryItem) => {
    const systemName = drafts[item.name_key] || item.suggested_system_name;
    if (!systemName) {
      toastError("先选一个系统分类");
      return;
    }
    const rawName = item.raw_names[0] || item.name_key;
    run(async () => {
      await adoptCategoryAliases([{ raw_name: rawName, system_name: systemName }]);
      toastSuccess(`已归类「${rawName}」→ ${systemName}`);
      await reload();
    });
  };

  const adoptAllSuggested = () => {
    const items = unmapped
      .filter((item) => item.suggested_system_name)
      .map((item) => ({
        raw_name: item.raw_names[0] || item.name_key,
        system_name: item.suggested_system_name as string,
      }));
    if (items.length === 0) return;
    run(async () => {
      const result = await adoptCategoryAliases(items);
      toastSuccess(`已采纳 ${result.adopted} 个建议`);
      await reload();
    });
  };

  const changeSystem = (item: CategoryAliasItem, systemName: string) => {
    if (!systemName || systemName === item.system_name) return;
    run(async () => {
      await updateCategoryAlias(item.name_key, { system_name: systemName });
      toastSuccess(`「${item.raw_names[0] || item.name_key}」→ ${systemName}`);
      await reload();
    });
  };

  const toggleEnabled = (item: CategoryAliasItem) => {
    run(async () => {
      await updateCategoryAlias(item.name_key, { enabled: !item.enabled });
      await reload();
    });
  };

  const remove = (item: CategoryAliasItem) => {
    const label = item.raw_names[0] || item.name_key;
    if (!window.confirm(`删除别名「${label}」？删除后该分类的内容会进入未分类。`)) {
      return;
    }
    run(async () => {
      await deleteCategoryAlias(item.name_key);
      toastSuccess("已删除");
      await reload();
    });
  };

  const addOverride = () => {
    const siteId = Number(draftSite);
    if (!siteId || !draftName.trim() || !draftSystem) {
      toastError("站点、类名、系统分类都要选");
      return;
    }
    run(async () => {
      await saveCategoryOverride(siteId, draftName.trim(), draftSystem);
      toastSuccess(`已添加例外：${draftName.trim()} → ${draftSystem}`);
      setDraftName("");
      await reload();
    });
  };

  const removeOverride = (item: OverrideItem) => {
    const siteLabel = item.site_name || `#${item.site_id}`;
    if (
      !window.confirm(
        `删除例外「${siteLabel} · ${item.raw_name} → ${item.system_name}」？`
      )
    ) {
      return;
    }
    run(async () => {
      await deleteCategoryOverride(item.site_id, item.name_key);
      toastSuccess("例外已删除");
      await reload();
    });
  };

  if (loading) {
    return <div className="alias-empty">加载中…</div>;
  }

  return (
    <div className="alias-settings">
      <div className="alias-summary">
        <span>
          <strong>{aliases.length}</strong> 个别名
        </span>
        <span className="alias-dot" aria-hidden="true" />
        <span>
          覆盖 <strong>{totalSources.toLocaleString()}</strong> 条来源
        </span>
        <span className="alias-dot" aria-hidden="true" />
        <span className={unmapped.length > 0 ? "alias-warn" : undefined}>
          <strong>{unmapped.length}</strong> 个未分类
        </span>
      </div>

      {unmapped.length > 0 && (
        <section className="alias-block">
          <div className="alias-block-head">
            <div>
              <div className="alias-block-title">未分类</div>
              <div className="alias-block-hint">
                这些远程类名还没有对应系统分类，归一次即对全部站点生效。
              </div>
            </div>
            {suggestedCount > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={adoptAllSuggested}
                disabled={busy}
              >
                全部采纳建议（{suggestedCount}）
              </button>
            )}
          </div>
          <div className="alias-rows">
            {unmapped.map((item) => {
              const rawName = item.raw_names[0] || item.name_key;
              const value =
                drafts[item.name_key] ?? item.suggested_system_name ?? "";
              return (
                <div className="alias-row alias-row--unmapped" key={item.name_key}>
                  <div className="alias-row-main">
                    <span className="alias-name">{rawName}</span>
                    {item.raw_names.length > 1 && (
                      <span className="alias-sub">{item.raw_names.join(" / ")}</span>
                    )}
                    <span className="alias-meta">
                      {item.source_count.toLocaleString()} 条 · {item.site_count} 个站点
                    </span>
                  </div>
                  <select
                    className="alias-select"
                    value={value}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [item.name_key]: event.target.value,
                      }))
                    }
                    aria-label={`把 ${rawName} 归类到系统分类`}
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
                    onClick={() => adoptOne(item)}
                    disabled={busy || !value}
                  >
                    归类
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="alias-block">
        <div className="alias-block-head">
          <div>
            <div className="alias-block-title">分类对照</div>
            <div className="alias-block-hint">
              同一类名只配一次；停用后该分类的内容不再出现在分类页。
            </div>
          </div>
          <input
            className="alias-search"
            type="search"
            placeholder="搜索类名或系统分类"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {groups.length === 0 ? (
          <div className="alias-empty">
            {query ? "没有匹配的类名" : "暂无别名，抓取完成后会自动生成"}
          </div>
        ) : (
          groups.map((group) => (
            <div className="alias-group" key={group.systemName}>
              <div className="alias-group-title">
                {group.systemName}
                <span className="alias-group-count">{group.items.length}</span>
              </div>
              {group.items.map((item) => (
                <div
                  className={`alias-row${item.enabled ? "" : " alias-row--off"}`}
                  key={item.name_key}
                >
                  <div className="alias-row-main">
                    <span className="alias-name">
                      {item.raw_names[0] || item.name_key}
                    </span>
                    {item.raw_names.length > 1 && (
                      <span className="alias-sub">{item.raw_names.join(" / ")}</span>
                    )}
                    <span className="alias-meta">
                      {item.source_count.toLocaleString()} 条 · {item.site_count} 个站点
                    </span>
                  </div>

                  <select
                    className="alias-select"
                    value={item.system_name}
                    onChange={(event) => changeSystem(item, event.target.value)}
                    disabled={busy}
                    aria-label={`修改 ${item.name_key} 的系统分类`}
                  >
                    {systemCategories.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="btn alias-btn"
                    onClick={() => toggleEnabled(item)}
                    disabled={busy}
                  >
                    {item.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    className="btn alias-btn alias-btn--danger"
                    onClick={() => remove(item)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <details className="alias-overrides">
        <summary>站点例外（{overrides.length}）</summary>
        <p className="alias-block-hint">
          只有同一个类名在某个站点含义不同时才需要：例外只影响该站点的来源，其余站点
          继续使用全局别名。
        </p>

        {overrides.length > 0 && (
          <div className="alias-override-list">
            {overrides.map((item) => (
              <div className="alias-override-row" key={item.id}>
                <span className="alias-override-site">
                  {item.site_name || `站点 #${item.site_id}`}
                </span>
                <span className="alias-override-sep" aria-hidden="true">
                  ·
                </span>
                <span className="alias-name">{item.raw_name}</span>
                <span className="alias-override-sep" aria-hidden="true">
                  →
                </span>
                <span className="alias-override-cat">{item.system_name}</span>
                <button
                  type="button"
                  className="btn alias-btn alias-btn--danger"
                  onClick={() => removeOverride(item)}
                  disabled={busy}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="alias-override-form">
          <select
            className="alias-select"
            value={draftSite}
            onChange={(event) => setDraftSite(event.target.value)}
            aria-label="选择站点"
          >
            <option value="">选择站点</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>

          <input
            className="alias-search"
            list="alias-raw-names"
            placeholder="远程类名，如 伦理片"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            aria-label="远程类名"
          />
          <datalist id="alias-raw-names">
            {[...new Set(aliases.flatMap((item) => item.raw_names))].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <select
            className="alias-select"
            value={draftSystem}
            onChange={(event) => setDraftSystem(event.target.value)}
            aria-label="选择系统分类"
          >
            <option value="">改为哪个分类</option>
            {systemCategories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-primary alias-btn"
            onClick={addOverride}
            disabled={busy || !draftSite || !draftName.trim() || !draftSystem}
          >
            添加例外
          </button>
        </div>
      </details>
    </div>
  );
}
