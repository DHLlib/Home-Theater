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

/** 系统分类清单（扁平叶子节点） */
const DEFAULT_SYSTEM_CATEGORIES = [
  "动作片",
  "科幻片",
  "喜剧片",
  "爱情片",
  "剧情片",
  "战争片",
  "恐怖片",
  "伦理片",
  "纪录片",
  "动画片",
  "短片",
  "国产剧",
  "香港剧",
  "韩国剧",
  "欧美剧",
  "台湾剧",
  "日本剧",
  "泰国剧",
  "海外剧",
  "大陆综艺",
  "港台综艺",
  "日韩综艺",
  "欧美综艺",
  "国产动漫",
  "日韩动漫",
  "欧美动漫",
  "港台动漫",
  "海外动漫",
  "体育",
  "短剧",
  "其他",
];

/** 自动匹配关键词：系统分类 -> 关键词列表（按优先级） */
const MATCH_RULES: Record<string, string[]> = {
  动作片: ["动作片", "动作"],
  科幻片: ["科幻片", "科幻"],
  喜剧片: ["喜剧片", "喜剧"],
  爱情片: ["爱情片", "爱情"],
  剧情片: ["剧情片", "剧情"],
  战争片: ["战争片", "战争"],
  恐怖片: ["恐怖片", "惊悚片", "灾难片", "恐怖", "惊悚", "灾难"],
  伦理片: ["伦理片", "伦理"],
  纪录片: ["纪录片", "纪录"],
  动画片: ["动画片", "动画"],
  短片: ["短片"],
  国产剧: ["国产剧", "国产电视", "国产连续"],
  香港剧: ["香港剧", "港台剧"],
  韩国剧: ["韩国剧", "韩剧"],
  欧美剧: ["欧美剧", "美国剧"],
  台湾剧: ["台湾剧", "台剧"],
  日本剧: ["日本剧", "日剧"],
  泰国剧: ["泰国剧", "泰剧"],
  海外剧: ["海外剧"],
  大陆综艺: ["大陆综艺", "内地综艺", "国产综艺"],
  港台综艺: ["港台综艺", "香港综艺", "台湾综艺"],
  日韩综艺: ["日韩综艺", "韩国综艺", "日本综艺"],
  欧美综艺: ["欧美综艺"],
  国产动漫: ["国产动漫", "国产动画"],
  日韩动漫: ["日韩动漫", "日本动漫", "韩国动漫"],
  欧美动漫: ["欧美动漫"],
  港台动漫: ["港台动漫"],
  海外动漫: ["海外动漫"],
  体育: ["足球", "篮球", "NBA", "体育"],
  短剧: ["短剧"],
};

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

  /** 加载默认系统分类（不覆盖已有行） */
  const loadDefaults = () => {
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.system_name));
      const toAdd = DEFAULT_SYSTEM_CATEGORIES.filter((c) => !existing.has(c));
      if (toAdd.length === 0) return prev;
      return [...prev, ...toAdd.map((c) => ({ system_name: c, mappings: {} }))];
    });
  };

  /** 根据远程分类名称自动匹配到系统分类 */
  const autoMatch = () => {
    setRows((prevRows) => {
      // 1. 确保默认分类已加载
      const existing = new Set(prevRows.map((r) => r.system_name));
      const missing = DEFAULT_SYSTEM_CATEGORIES.filter((c) => !existing.has(c));
      let newRows: CategoryRow[] = [
        ...prevRows,
        ...missing.map((c) => ({ system_name: c, mappings: {} })),
      ];

      // 2. 深拷贝
      newRows = newRows.map((r) => ({ ...r, mappings: { ...r.mappings } }));

      // 3. 计算当前 occupancy
      const occ: Record<number, Record<string, number>> = {};
      for (let i = 0; i < newRows.length; i++) {
        for (const [sid, rids] of Object.entries(newRows[i].mappings)) {
          const siteId = Number(sid);
          if (!occ[siteId]) occ[siteId] = {};
          for (const rid of rids) occ[siteId][rid] = i;
        }
      }

      // 4. 遍历每个站点的远程分类，尝试匹配
      for (const site of sites) {
        const cats = remoteCats[site.id] || [];
        for (const cat of cats) {
          // 已占用则跳过
          if (occ[site.id]?.[cat.remote_id] !== undefined) continue;

          // 找最佳匹配（最长关键词优先）
          let bestMatchIdx = -1;
          let bestScore = 0;

          for (let i = 0; i < newRows.length; i++) {
            const rules = MATCH_RULES[newRows[i].system_name];
            if (!rules) continue;
            for (const keyword of rules) {
              if (cat.name.includes(keyword) && keyword.length > bestScore) {
                bestScore = keyword.length;
                bestMatchIdx = i;
              }
            }
          }

          if (bestMatchIdx >= 0) {
            const current = newRows[bestMatchIdx].mappings[site.id] || [];
            newRows[bestMatchIdx] = {
              ...newRows[bestMatchIdx],
              mappings: {
                ...newRows[bestMatchIdx].mappings,
                [site.id]: [...current, cat.remote_id],
              },
            };
            if (!occ[site.id]) occ[site.id] = {};
            occ[site.id][cat.remote_id] = bestMatchIdx;
          }
        }
      }

      return newRows;
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
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={loadAllRemote}>
          重新拉取各站分类
        </button>
        <button className="btn" onClick={loadDefaults}>
          加载默认分类
        </button>
        <button className="btn" onClick={autoMatch}>
          自动匹配
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
            <tr style={{ background: "var(--muted)" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  minWidth: 120,
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "var(--text-secondary)",
                }}
              >
                系统分类
              </th>
              {sites.map((s) => (
                <th
                  key={s.id}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    minWidth: 160,
                    fontWeight: 700,
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--text-secondary)",
                  }}
                >
                  {s.name}
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
              <tr
                key={idx}
                style={{
                  transition: "background-color 150ms ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--card-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
              >
                <td
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    verticalAlign: "top",
                  }}
                >
                  <input
                    type="text"
                    value={row.system_name}
                    onChange={(e) => updateRowName(idx, e.target.value)}
                    placeholder="如：动作片"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--fg)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      minHeight: 36,
                    }}
                  />
                </td>
                {sites.map((s) => {
                  const siteOccupancy = occupancy[s.id] || {};
                  return (
                    <td
                      key={s.id}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                        verticalAlign: "top",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                          maxHeight: 220,
                          overflowY: "auto",
                          padding: "2px 0",
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
                                  gap: 6,
                                  padding: "6px 8px",
                                  opacity: 0.35,
                                  cursor: "not-allowed",
                                  borderRadius: 6,
                                  minHeight: 32,
                                }}
                                title={`已被「${
                                  occupant?.system_name || "未命名"
                                }」占用`}
                              >
                                <input
                                  type="checkbox"
                                  checked={true}
                                  disabled
                                  style={{ cursor: "not-allowed" }}
                                />
                                <span
                                  style={{
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {c.name} ({c.remote_id})
                                </span>
                                <button
                                  className="btn"
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: 13,
                                    lineHeight: 1,
                                    opacity: 1,
                                    cursor: "pointer",
                                    minHeight: 28,
                                  }}
                                  onClick={() =>
                                    releaseRemoteId(
                                      occupiedRowIdx,
                                      s.id,
                                      c.remote_id
                                    )
                                  }
                                  title={`从「${
                                    occupant?.system_name || "未命名"
                                  }」中释放`}
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
                                gap: 6,
                                cursor: "pointer",
                                padding: "6px 8px",
                                borderRadius: 6,
                                background: selected
                                  ? "rgba(225,29,72,0.12)"
                                  : "transparent",
                                border: selected
                                  ? "1px solid var(--accent)"
                                  : "1px solid transparent",
                                minHeight: 32,
                                transition:
                                  "background-color 150ms ease, border-color 150ms ease",
                              }}
                              onMouseEnter={(e) => {
                                if (!selected) {
                                  e.currentTarget.style.backgroundColor =
                                    "var(--card-hover)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!selected) {
                                  e.currentTarget.style.backgroundColor =
                                    "transparent";
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const current = row.mappings[s.id] || [];
                                  const next = e.target.checked
                                    ? [...current, c.remote_id]
                                    : current.filter(
                                        (id) => id !== c.remote_id
                                      );
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
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    verticalAlign: "top",
                  }}
                >
                  <button
                    className="btn"
                    onClick={() => removeRow(idx)}
                    style={{ minHeight: 36, padding: "8px 12px" }}
                  >
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
