import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getDownloadRoot } from "../api/settings";
import { createDownloadBatch } from "../api/downloads";
import { addFavorite } from "../api/favorites";
import { getEpisodes } from "../api/play";
import { useDetailQuery } from "../hooks/useVideos";
import { toastError, toastSuccess } from "../utils/toast";
import EpisodeList from "../components/EpisodeList";
import SourcePicker from "../components/SourcePicker";
import type {
  AggregatedVideo,
  DownloadBatchItem,
  SourceRef,
} from "../types";

const logger = {
  info: (...args: unknown[]) => console.info("[Detail]", ...args),
  warn: (...args: unknown[]) => console.warn("[Detail]", ...args),
  error: (...args: unknown[]) => console.error("[Detail]", ...args),
};

export default function Detail() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
  const [selectedEpisodeIndices, setSelectedEpisodeIndices] = useState<
    Set<number>
  >(new Set());
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
      setSelectedEpisodeIndices(new Set());
      setEpisodePickerOpen(true);
    }
  };

  const handleToggleEpisode = (index: number, selected: boolean) => {
    setSelectedEpisodeIndices((prev) => {
      const next = new Set(prev);
      if (selected) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const handleSelectAll = (episodes: { index: number }[]) => {
    setSelectedEpisodeIndices(new Set(episodes.map((e) => e.index)));
  };

  const handleDeselectAll = () => {
    setSelectedEpisodeIndices(new Set());
  };

  const createTasksAsync = async (
    source: SourceRef,
    indices: Set<number>,
    videoItem: AggregatedVideo
  ) => {
    logger.info(
      "create_tasks_start title=%s site_id=%s original_id=%s selected=%d",
      videoItem.title,
      source.site_id,
      source.original_id,
      indices.size
    );
    setDownloading(true);
    try {
      const resolvedEps = await getEpisodes(
        source.site_id,
        source.original_id
      );
      logger.info(
        "create_tasks_got_episodes title=%s count=%d",
        videoItem.title,
        resolvedEps.length
      );
      const selectedEps = resolvedEps.filter((e) => indices.has(e.index));
      if (selectedEps.length === 0) {
        logger.warn(
          "create_tasks_no_selected_episodes title=%s indices=%o",
          videoItem.title,
          Array.from(indices)
        );
        toastError("未能解析选中的集数");
        return;
      }

      const episodes: DownloadBatchItem[] = selectedEps.map((ep) => ({
        episode_index: ep.index,
        episode_name: ep.ep_name,
        url: ep.url,
        suffix: ep.suffix,
      }));

      const result = await createDownloadBatch({
        site_id: source.site_id,
        original_id: source.original_id,
        title: videoItem.title,
        year: videoItem.year,
        episodes,
      });

      logger.info(
        "create_tasks_batch_done title=%s created=%o skipped=%o recreated=%o",
        videoItem.title,
        result.created,
        result.skipped,
        result.recreated
      );

      const total = selectedEps.length;
      const createdCount = result.created.length;
      const skippedCount = result.skipped.length;
      const recreatedCount = result.recreated.length;
      const failedCount =
        total - createdCount - skippedCount - recreatedCount;

      const parts: string[] = [];
      if (createdCount) parts.push(`新建 ${createdCount} 个`);
      if (skippedCount) parts.push(`跳过 ${skippedCount} 个`);
      if (recreatedCount) parts.push(`重建 ${recreatedCount} 个`);
      if (failedCount) parts.push(`失败 ${failedCount} 个`);

      toastSuccess(
        parts.length > 0 ? parts.join("，") : "下载任务处理完成"
      );
    } catch (err) {
      logger.error("create_tasks_failed title=%s error=%o", videoItem.title, err);
      // ApiError already toasted by client.ts
    } finally {
      if (isMountedRef.current) {
        setDownloading(false);
      }
    }
  };

  const handleConfirmBatchDownload = () => {
    if (!selectedSource || !item) return;
    if (selectedEpisodeIndices.size === 0) return;

    // 立即关闭弹窗、清空选择，避免阻塞 UI；后台任务 fire-and-forget
    const source = selectedSource;
    const indices = new Set(selectedEpisodeIndices);
    setEpisodePickerOpen(false);
    setSelectedSource(null);
    setSelectedEpisodeIndices(new Set());
    toastSuccess("已开始创建下载任务");

    createTasksAsync(source, indices, item);
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
                  <div className="col" style={{ gap: 12 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={downloading}
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => handleSelectAll(d.episodes)}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={downloading}
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={handleDeselectAll}
                      >
                        取消全选
                      </button>
                    </div>
                    <EpisodeList
                      episodes={d.episodes}
                      onPick={() => {}}
                      multiSelect
                      selectedIndices={selectedEpisodeIndices}
                      onToggleSelection={handleToggleEpisode}
                    />
                  </div>
                );
              })()}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                已选 {selectedEpisodeIndices.size} 集
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={downloading}
                  onClick={() => {
                    setEpisodePickerOpen(false);
                    setSelectedSource(null);
                    setSelectedEpisodeIndices(new Set());
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={downloading || selectedEpisodeIndices.size === 0}
                  onClick={handleConfirmBatchDownload}
                >
                  {downloading ? "创建中..." : "确定下载"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
