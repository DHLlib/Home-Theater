import { useEffect, useState } from "react";
import {
  listSites,
  createSite,
  deleteSite,
  probeSite,
  updateSite,
} from "../api/sites";
import { getDownloadRoot, setDownloadRoot } from "../api/settings";
import CategorySettings from "../components/CategorySettings";
import type { ProbeResult, Site } from "../types";

export default function Settings() {
  const [sites, setSites] = useState<Site[]>([]);
  const [root, setRoot] = useState("");
  const [savedRoot, setSavedRoot] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<number, ProbeResult>
  >({});

  useEffect(() => {
    listSites().then(setSites);
    getDownloadRoot().then((r) => {
      setSavedRoot(r);
      if (r) setRoot(r);
    });
  }, []);

  const addSite = () => {
    const name = prompt("站点名称");
    const base_url = prompt("站点地址（如 http://xxx.php）");
    if (!name || !base_url) return;
    createSite({ name, base_url, enabled: true, sort: 0 }).then((s) =>
      setSites((prev) => [...prev, s])
    );
  };

  const doProbe = (id: number) => {
    probeSite(id).then((r) =>
      setProbeResults((prev) => ({ ...prev, [id]: r }))
    );
  };

  const saveRoot = () => {
    if (!root.trim()) return;
    setDownloadRoot(root.trim()).then((r) => setSavedRoot(r.value));
  };

  return (
    <div className="col">
      <section>
        <h2>采集站管理</h2>
        <div className="col" style={{ marginTop: 12 }}>
          {sites.map((s) => (
            <div
              key={s.id}
              className="row"
              style={{
                justifyContent: "space-between",
                padding: 10,
                background: "var(--card)",
                borderRadius: 6,
              }}
            >
              <div>
                <div>{s.name}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{s.base_url}</div>
                {probeResults[s.id] && (
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 4,
                      color: probeResults[s.id].ok
                        ? "var(--success)"
                        : "var(--danger)",
                    }}
                  >
                    {probeResults[s.id].ok
                      ? `OK ${probeResults[s.id].latency_ms}ms`
                      : `FAIL ${probeResults[s.id].error}`}
                  </div>
                )}
              </div>
              <div className="row">
                <button className="btn" onClick={() => doProbe(s.id)}>
                  Probe
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    updateSite(s.id, { enabled: !s.enabled }).then(() =>
                      listSites().then(setSites)
                    )
                  }
                >
                  {s.enabled ? "禁用" : "启用"}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    deleteSite(s.id).then(() =>
                      setSites((prev) => prev.filter((x) => x.id !== s.id))
                    )
                  }
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          <button
            className="btn btn-primary"
            onClick={addSite}
            style={{ alignSelf: "flex-start" }}
          >
            + 添加站点
          </button>
        </div>
      </section>

      <section>
        <h2>分类设置</h2>
        <CategorySettings sites={sites} />
      </section>

      <section>
        <h2>下载根目录</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            type="text"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="例如 D:/Downloads"
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--fg)",
            }}
          />
          <button className="btn btn-primary" onClick={saveRoot}>
            保存
          </button>
        </div>
        {savedRoot && (
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
            当前：{savedRoot}
          </div>
        )}
      </section>
    </div>
  );
}
