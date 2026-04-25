import { useEffect, useMemo, useState } from "react";
import {
  updateSiteCategories,
  fetchRemoteCategories,
} from "../api/sites";
import type { CategoryMapping, Site } from "../types";

interface CategoryRow {
  system_name: string;
  mappings: Record<number, string[]>; // site_id -> remote_id[]
}

interface CategorySettingsProps {
  sites: Site[];
}

/** 计算占用关系：site_id -> remote_id -> rowIdx */
function buildOccupancy(
  rows: CategoryRow[]
): Record<number, Record<string, number>> {
  const map: Record<number, Record<string, number>> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const [siteIdStr, remoteIds] of Object.entries(row.mappings)) {
      const siteId = Number(siteIdStr);
      if (!map[siteId]) map[siteId] = {};
      for (const rid of remoteIds) {
        map[siteId][rid] = i;
      }
    }
  }
  return map;
}

export default function CategorySettings({ sites }: CategorySettingsProps) {
  const [remoteCats, setRemoteCats] = useState<
    Record<number, CategoryMapping[]>
  >({});
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const occupancy = useMemo(() => buildOccupancy(rows), [rows]);

  // 拉取每个站点的远程分类（用于下拉选项）
  const loadAllRemote = () => {
    sites.forEach((site) => {
      fetchRemoteCategories(site.id).then((res) => {
        setRemoteCats((prev) => ({ ...prev, [site.id]: res.categories }));
      });
    });
  };

  // 从各站点的 categories 配置，反推出表格行
  const buildRowsFromSites = () => {
    const map: Record<string, Record<number, string[]>> = {};
    for (const site of sites) {
      for (const cat of site.categories || []) {
        const sys = cat.name || "";
        if (!sys) continue;
        if (!map[sys]) map[sys] = {};
        if (!map[sys][site.id]) map[sys][site.id] = [];
        map[sys][site.id].push(cat.remote_id);
      }
    }
    const newRows = Object.entries(map).map(([system_name, mappings]) => ({
      system_name,
      mappings,
    }));
    setRows(newRows);
  };

  useEffect(() => {
    loadAllRemote();
    buildRowsFromSites();
  }, [sites]);

  const addRow = () => {
    setRows((prev) => [...prev, { system_name: "", mappings: {} }]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => {
      const arr = [...prev];
      arr.splice(idx, 1);
      return arr;
    });
  };

  const updateRowName = (idx: number, val: string) => {
    setRows((prev) => {
      const arr = [...prev];
      arr[idx] = { ...arr[idx], system_name: val };
      return arr;
    });
  };

  const updateRowMapping = (idx: number, siteId: number, remoteIds: string[]) => {
    setRows((prev) => {
      const arr = [...prev];
      arr[idx] = {
        ...arr[idx],
        mappings: { ...arr[idx].mappings, [siteId]: remoteIds },
      };
      return arr;
    });
  };

  /** 从指定行的指定站点中移除某个 remote_id */
  const releaseRemoteId = (fromRowIdx: number, siteId: number, remoteId: string) => {
    setRows((prev) => {
      const arr = [...prev];
      const current = arr[fromRowIdx].mappings[siteId] || [];
      arr[fromRowIdx] = {
        ...arr[fromRowIdx],
        mappings: {
          ...arr[fromRowIdx].mappings,
          [siteId]: current.filter((id) => id !== remoteId),
        },
      };
      return arr;
    });
  };

  const save = async () => {
    setLoading(true);
    try {
      for (const site of sites) {
        const cats: CategoryMapping[] = [];
        for (const row of rows) {
          const remoteIds = row.mappings[site.id] || [];
          for (const remoteId of remoteIds) {
            if (row.system_name && remoteId) {
              cats.push({ remote_id: remoteId, name: row.system_name });
            }
          }
        }
        await updateSiteCategories(site.id, cats);
      }
      alert("保存成功");
    } catch {
      alert("保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={loadAllRemote}>
          重新拉取各站分类
        </button>
        <button className="btn btn-primary" onClick={save} disabled={loading}>
          {loading ? "保存中…" : "保存映射"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: 8,
                  borderBottom: "1px solid var(--border)",
                  minWidth: 120,
                }}
              >
                系统分类
              </th>
              {sites.map((s) => (
                <th
                  key={s.id}
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom: "1px solid var(--border)",
                    minWidth: 160,
                  }}
                >
                  {s.name} 映射
                </th>
              ))}
              <th
                style={{
                  width: 60,
                  borderBottom: "1px solid var(--border)",
                }}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: 6, borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                  <input
                    type="text"
                    value={row.system_name}
                    onChange={(e) => updateRowName(idx, e.target.value)}
                    placeholder="如：电影"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--fg)",
                    }}
                  />
                </td>
                {sites.map((s) => {
                  const siteOccupancy = occupancy[s.id] || {};
                  return (
                    <td
                      key={s.id}
                      style={{
                        padding: 6,
                        borderBottom: "1px solid var(--border)",
                        verticalAlign: "top",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          maxHeight: 180,
                          overflowY: "auto",
                          padding: "4px 0",
                        }}
                      >
                        {(remoteCats[s.id] || []).map((c) => {
                          const occupiedRowIdx = siteOccupancy[c.remote_id];
                          const isMine = occupiedRowIdx === idx;
                          const isOccupied =
                            occupiedRowIdx !== undefined && !isMine;

                          if (isOccupied) {
                            const occupant = rows[occupiedRowIdx];
                            return (
                              <div
                                key={c.remote_id}
                                style={{
                                  fontSize: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "2px 4px",
                                  opacity: 0.35,
                                  cursor: "not-allowed",
                                }}
                                title={`已被「${occupant?.system_name || "未命名"}」占用`}
                              >
                                <input
                                  type="checkbox"
                                  checked={true}
                                  disabled
                                  style={{ cursor: "not-allowed" }}
                                />
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {c.name} ({c.remote_id})
                                </span>
                                <button
                                  className="btn"
                                  style={{
                                    padding: "1px 6px",
                                    fontSize: 11,
                                    lineHeight: 1,
                                    opacity: 1,
                                    cursor: "pointer",
                                  }}
                                  onClick={() =>
                                    releaseRemoteId(
                                      occupiedRowIdx,
                                      s.id,
                                      c.remote_id
                                    )
                                  }
                                  title={`从「${occupant?.system_name || "未命名"}」中释放`}
                                >
                                  ×
                                </button>
                              </div>
                            );
                          }

                          const selected = isMine;
                          return (
                            <label
                              key={c.remote_id}
                              style={{
                                fontSize: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                cursor: "pointer",
                                padding: "2px 4px",
                                borderRadius: 4,
                                background: selected
                                  ? "rgba(10,132,255,0.12)"
                                  : "transparent",
                                border: selected
                                  ? "1px solid var(--accent)"
                                  : "1px solid transparent",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const current = row.mappings[s.id] || [];
                                  const next = e.target.checked
                                    ? [...current, c.remote_id]
                                    : current.filter((id) => id !== c.remote_id);
                                  updateRowMapping(idx, s.id, next);
                                }}
                              />
                              <span>{c.name} ({c.remote_id})</span>
                            </label>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
                <td
                  style={{
                    padding: 6,
                    borderBottom: "1px solid var(--border)",
                    verticalAlign: "top",
                  }}
                >
                  <button className="btn" onClick={() => removeRow(idx)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        className="btn"
        onClick={addRow}
        style={{ alignSelf: "flex-start" }}
      >
        + 新增分类映射
      </button>
    </div>
  );
}
