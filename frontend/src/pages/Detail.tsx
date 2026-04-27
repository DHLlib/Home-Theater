import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getDetail } from "../api/videos";
import { getDownloadRoot } from "../api/settings";
import { createDownload } from "../api/downloads";
import { addFavorite } from "../api/favorites";
import { getEpisodes } from "../api/play";
import { toastSuccess } from "../utils/toast";
import {
  getCachedDetail,
  setCachedDetail,
} from "../utils/cache";
import EpisodeList from "../components/EpisodeList";
import SourcePicker from "../components/SourcePicker";
import type {
  AggregatedVideo,
  SourceDetail,
  SourceRef,
  Episode,
} from "../types";

export default function Detail() {
  const location = useLocation();
  const navigate = useNavigate();
  const item = location.state as AggregatedVideo | undefined;
  const [detail, setDetail] = useState<SourceDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAction, setPickerAction] = useState<"play" | "download" | null>(
    null
  );
  const [selectedSource, setSelectedSource] = useState<SourceRef | null>(null);
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!item) return;

    // 先读缓存立即渲染，减少白屏
    getCachedDetail<SourceDetail[]>(item.title, item.year).then((cached) => {
      if (cached) {
        setDetail(cached);
      }
    });

    // 再调 API 刷新并写入缓存
    getDetail({
      title: item.title,
      year: item.year,
      sources: item.sources,
    }).then((r) => {
      setDetail(r.sources);
      setCachedDetail(item.title, item.year, r.sources);
    });
  }, [item]);

  if (!item) {
    return <div className="empty">非法入口，请从首页进入。</div>;
  }

  const handlePlay = () => {
    setPickerAction("play");
    setPickerOpen(true);
  };

  const handleDownload = async () => {
    const root = await getDownloadRoot();
    if (!root) {
      alert("请先配置下载根目录");
      navigate("/settings");
      return;
    }
    setPickerAction("download");
    setPickerOpen(true);
  };

  const handleFavorite = () => {
    addFavorite({
      title: item.title,
      year: item.year,
      poster_url: item.poster_url || detail[0]?.poster_url || undefined,
    }).then(() => toastSuccess("已收藏"));
  };

  const onConfirmSource = (source: SourceRef) => {
    setPickerOpen(false);
    const d = detail.find(
      (s) =>
        s.site_id === source.site_id && s.original_id === source.original_id
    );
    if (!d) return;

    if (pickerAction === "play") {
      navigate(
        `/player?site_id=${source.site_id}&original_id=${encodeURIComponent(
          source.original_id
        )}&ep=0&title=${encodeURIComponent(item.title)}&year=${
          item.year ?? ""
        }`
      );
    } else if (pickerAction === "download") {
      if (d.episodes.length === 0) {
        alert("该源暂无可用集数");
        return;
      }
      setSelectedSource(source);
      setEpisodePickerOpen(true);
    }
  };

  const handleDownloadEpisode = async (ep: Episode) => {
    if (!selectedSource || !item) return;
    setDownloading(true);
    try {
      // 先解析真实播放地址（feifan 分享页 → 真实 m3u8，360zy → ffm3u8）
      const resolvedEps = await getEpisodes(
        selectedSource.site_id,
        selectedSource.original_id
      );
      const resolved = resolvedEps.find((e) => e.index === ep.index);
      if (!resolved) {
        alert("未能解析该集播放地址");
        return;
      }

      await createDownload({
        site_id: selectedSource.site_id,
        original_id: selectedSource.original_id,
        episode_index: resolved.index,
        episode_name: resolved.ep_name,
        url: resolved.url,
        suffix: resolved.suffix,
        title: item.title,
        year: item.year,
      });
      setEpisodePickerOpen(false);
      setSelectedSource(null);
      alert("下载任务已创建");
    } catch {
      // ApiError already toasted by client.ts
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="col">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {(item.poster_url || detail[0]?.poster_url) ? (
            <img
              src={item.poster_url || detail[0]?.poster_url || undefined}
              alt={item.title}
              style={{ width: "100%", borderRadius: 8, display: "block" }}
            />
          ) : (
            <div className="empty" style={{ height: 300 }}>
              无封面
            </div>
          )}
        </div>
        <div className="col" style={{ flex: 1, gap: 8 }}>
          <h2 style={{ margin: 0 }}>
            {item.title} {item.year ? `(${item.year})` : ""}
          </h2>
          {detail[0]?.area && (
            <div style={{ fontSize: 13, opacity: 0.8 }}>地区：{detail[0].area}</div>
          )}
          {detail[0]?.actors && (
            <div style={{ fontSize: 13, opacity: 0.8 }}>演员：{detail[0].actors}</div>
          )}
          {detail[0]?.director && (
            <div style={{ fontSize: 13, opacity: 0.8 }}>导演：{detail[0].director}</div>
          )}
          {detail[0]?.intro && (
            <div
              style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: detail[0].intro }}
            />
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handlePlay}>
              播放
            </button>
            <button className="btn" onClick={handleDownload}>
              下载
            </button>
            <button className="btn" onClick={handleFavorite}>
              收藏
            </button>
          </div>
        </div>
      </div>

      {detail.map((s) => (
        <div
          key={`${s.site_id}-${s.original_id}`}
          style={{ marginTop: 16 }}
        >
          <h4>{s.site_name || `站点 #${s.site_id}`}</h4>
          <EpisodeList
            episodes={s.episodes}
            onPick={(idx) => {
              navigate(
                `/player?site_id=${s.site_id}&original_id=${encodeURIComponent(
                  s.original_id
                )}&ep=${idx}&title=${encodeURIComponent(item.title)}&year=${
                  item.year ?? ""
                }`
              );
            }}
          />
        </div>
      ))}

      <SourcePicker
        open={pickerOpen}
        sources={item.sources}
        title={pickerAction === "play" ? "选择播放源" : "选择下载源"}
        onCancel={() => setPickerOpen(false)}
        onConfirm={onConfirmSource}
      />

      {/* 集数选择对话框 */}
      {episodePickerOpen && selectedSource && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEpisodePickerOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--card, #1c1c1e)",
              color: "var(--fg, #f5f5f7)",
              padding: 20,
              borderRadius: 8,
              width: "min(520px, 92vw)",
              border: "1px solid var(--border, #2d2d2f)",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h3 style={{ marginTop: 0 }}>选择要下载的集数</h3>
            <p style={{ opacity: 0.7, fontSize: 13 }}>
              {selectedSource.site_name || `站点 #${selectedSource.site_id}`} · {item.title}
            </p>

            <div style={{ overflowY: "auto", margin: "12px 0" }}>
              {(() => {
                const d = detail.find(
                  (s) =>
                    s.site_id === selectedSource.site_id &&
                    s.original_id === selectedSource.original_id
                );
                if (!d || d.episodes.length === 0) {
                  return (
                    <div style={{ opacity: 0.7, padding: 12 }}>暂无可用集数</div>
                  );
                }
                return (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {d.episodes.map((ep) => (
                      <button
                        key={ep.index}
                        className="btn"
                        disabled={downloading}
                        onClick={() => handleDownloadEpisode(ep)}
                      >
                        {ep.ep_name}
                        {ep.suffix ? ` (${ep.suffix})` : ""}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={downloading}
                onClick={() => {
                  setEpisodePickerOpen(false);
                  setSelectedSource(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
