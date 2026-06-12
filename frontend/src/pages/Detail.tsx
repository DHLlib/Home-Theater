import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getDownloadRoot } from "../api/settings";
import { createDownload } from "../api/downloads";
import { addFavorite } from "../api/favorites";
import { getEpisodes } from "../api/play";
import { useDetailQuery } from "../hooks/useVideos";
import { toastError, toastSuccess } from "../utils/toast";
import EpisodeList from "../components/EpisodeList";
import SourcePicker from "../components/SourcePicker";
import type {
  AggregatedVideo,
  SourceRef,
  Episode,
} from "../types";

export default function Detail() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const item = useMemo(() => {
    const fromState = location.state as AggregatedVideo | undefined;
    if (fromState) return fromState;

    const title = searchParams.get("title");
    if (!title) return undefined;

    try {
      const sources = JSON.parse(searchParams.get("sources") || "[]");
      return {
        title,
        year: searchParams.get("year")
          ? parseInt(searchParams.get("year")!, 10)
          : null,
        poster_url: null,
        sources,
      } as AggregatedVideo;
    } catch {
      return undefined;
    }
  }, [location.state, searchParams]);

  const { data: detail = [], isLoading } = useDetailQuery(
    item?.title ?? "",
    item?.year,
    item?.sources ?? []
  );

  const detailReady = !isLoading && detail.length > 0;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAction, setPickerAction] = useState<"play" | "download" | null>(
    null
  );
  const [selectedSource, setSelectedSource] = useState<SourceRef | null>(null);
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

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
      toastError("请先配置下载根目录");
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
      sources: item.sources,
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
        }`,
        { state: { episodes: d.episodes } }
      );
    } else if (pickerAction === "download") {
      if (d.episodes.length === 0) {
        toastError("该源暂无可用集数");
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
        toastError("未能解析该集播放地址");
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
      toastSuccess("下载任务已创建");
    } catch {
      // ApiError already toasted by client.ts
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="col">
      <button
        className="btn"
        onClick={() => navigate("/")}
        style={{ alignSelf: "flex-start", padding: "4px 12px", fontSize: 13, marginBottom: 4 }}
        aria-label="返回首页"
      >
        ← 返回
      </button>
      <div className="row detail-layout" style={{ alignItems: "flex-start" }}>
        <div className="detail-poster-wrap" style={{ width: 220, flexShrink: 0 }}>
          {(item.poster_url || detail[0]?.poster_url) ? (
            <img
              src={item.poster_url || detail[0]?.poster_url || undefined}
              alt={item.title}
              style={{ width: "100%", borderRadius: 4, display: "block" }}
            />
          ) : (
            <div className="empty" style={{ height: 300 }}>
              无封面
            </div>
          )}
        </div>
        <div className="col detail-info-wrap" style={{ flex: 1, gap: 8 }}>
          <h2 style={{ margin: 0 }}>
            {item.title} {item.year ? `(${item.year})` : ""}
          </h2>
          {detail[0]?.area && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>地区：{detail[0].area}</div>
          )}
          {detail[0]?.actors && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>演员：{detail[0].actors}</div>
          )}
          {detail[0]?.director && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>导演：{detail[0].director}</div>
          )}
          {detail[0]?.intro && (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {detail[0].intro.replace(/<[^>]*>/g, "")}
            </div>
          )}
          <div className="row detail-actions" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handlePlay}
              disabled={!detailReady}
            >
              播放
            </button>
            <button
              className="btn"
              onClick={handleDownload}
              disabled={!detailReady}
            >
              下载
            </button>
            <button className="btn" onClick={handleFavorite}>
              收藏
            </button>
          </div>

          {isLoading && (
            <div
              className="row"
              style={{
                marginTop: 16,
                gap: 10,
                color: "var(--text-secondary)",
                fontSize: 13,
              }}
            >
              <div
                className="spinner"
                style={{ width: 18, height: 18, borderWidth: 2 }}
              />
              正在加载源信息...
            </div>
          )}

          {!isLoading && detail.length === 0 && (
            <div
              style={{
                marginTop: 16,
                color: "var(--text-secondary)",
                fontSize: 13,
              }}
            >
              暂无可用源信息
            </div>
          )}
        </div>
      </div>

      {!isLoading && detail.length > 0 && detail.map((s) => (
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
                }`,
                { state: { episodes: s.episodes } }
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
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              padding: 20,
              borderRadius: 4,
              width: "min(520px, 92vw)",
              border: "1px solid var(--glass-border)",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h3 style={{ marginTop: 0 }}>选择要下载的集数</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
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
                    <div style={{ color: "var(--text-secondary)", padding: 12 }}>暂无可用集数</div>
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
