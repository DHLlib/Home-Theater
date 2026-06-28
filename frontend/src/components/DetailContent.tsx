import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { getDownloadRoot } from "../api/settings";
import { createDownloadBatch } from "../api/downloads";
import { getFavoriteStatus, toggleFavorite } from "../api/favorites";
import { getEpisodes } from "../api/play";
import { useDetailQuery } from "../hooks/useVideos";
import { toastError, toastSuccess } from "../utils/toast";
import EpisodeList from "./EpisodeList";
import PosterImage from "./PosterImage";
import SourcePicker from "./SourcePicker";
import type {
  AggregatedVideo,
  DownloadBatchItem,
  SourceDetail,
  SourceRef,
} from "../types";

export type DetailVariant = "page" | "modal" | "sheet";

/**
 * 海报共享元素 layoutId。VideoCard（卡片端）与 DetailContent（弹窗端）必须
 * 用同一份构造逻辑，framer-motion 才能在两端间做生长补间。
 */
export function posterLayoutId(title: string, year?: number | null): string {
  return `poster-${title}-${year ?? "null"}`;
}

export interface DetailContentProps {
  item: AggregatedVideo;
  variant?: DetailVariant;
}

function sourceKey(s: SourceDetail | SourceRef): string {
  return `${s.site_id}-${s.original_id}`;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 200ms ease",
      }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * 详情内容主体：海报 / 简介 / 选源 / 选集 / 播放 / 下载 / 收藏。
 *
 * 从 Detail.tsx 抽取，供整页（variant="page"）与弹窗（variant="modal"/"sheet"）
 * 复用，避免逻辑双份维护。item 由调用方保证非空。开关与关闭动画由容器
 * （DetailModalHost）负责；内部播放/下载跳转换页后弹窗随路由自然卸载。
 */
export default function DetailContent({
  item,
  variant = "page",
}: DetailContentProps) {
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const isSheet = variant === "sheet";
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { data: detail = [], isLoading } = useDetailQuery(
    item.title,
    item.year,
    item.sources
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
  const [isFavorited, setIsFavorited] = useState(false);

  // sheet 模式下默认只展开第一个来源，避免小屏下选集区过长
  const defaultExpanded = useMemo(() => {
    if (!isSheet || detail.length === 0) {
      return new Set(detail.map(sourceKey));
    }
    return new Set([sourceKey(detail[0])]);
  }, [isSheet, detail]);

  const [expandedSources, setExpandedSources] = useState(defaultExpanded);

  // detail 加载完成后同步默认展开态
  useEffect(() => {
    setExpandedSources(defaultExpanded);
  }, [defaultExpanded]);

  const toggleSource = (key: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    getFavoriteStatus(item.title, item.year).then((res) => {
      if (!cancelled) setIsFavorited(res.favorited);
    });
    return () => {
      cancelled = true;
    };
  }, [item.title, item.year]);

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
    toggleFavorite({
      title: item.title,
      year: item.year,
      poster_url: item.poster_url || detail[0]?.poster_url || undefined,
      sources: item.sources,
    })
      .then((res) => {
        setIsFavorited(res.favorited);
        toastSuccess(res.favorited ? "已收藏" : "已取消收藏");
      })
      .catch(() => {
        toastError("收藏操作失败");
      });
  };

  const buildPlayerUrl = (siteId: number, originalId: string, epIndex: number) => {
    const yearParam = item.year != null ? `&year=${item.year}` : "";
    return `/player?site_id=${siteId}&original_id=${encodeURIComponent(
      originalId
    )}&ep=${epIndex}&title=${encodeURIComponent(item.title)}${yearParam}`;
  };

  const handlePlayEpisode = (source: SourceDetail, episodeIndex: number) => {
    navigate(buildPlayerUrl(source.site_id, source.original_id, episodeIndex), {
      state: { episodes: source.episodes },
    });
  };

  const onConfirmSource = (source: SourceRef) => {
    setPickerOpen(false);
    const d = detail.find(
      (s) =>
        s.site_id === source.site_id && s.original_id === source.original_id
    );
    if (!d) return;

    if (pickerAction === "play") {
      navigate(buildPlayerUrl(source.site_id, source.original_id, 0), {
        state: { episodes: d.episodes },
      });
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
    setDownloading(true);
    try {
      const resolvedEps = await getEpisodes(source.site_id, source.original_id);
      const selectedEps = resolvedEps.filter((e) => indices.has(e.index));
      if (selectedEps.length === 0) {
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

      const total = selectedEps.length;
      const createdCount = result.created.length;
      const skippedCount = result.skipped.length;
      const recreatedCount = result.recreated.length;
      const failedCount = total - createdCount - skippedCount - recreatedCount;

      const parts: string[] = [];
      if (createdCount) parts.push(`新建 ${createdCount} 个`);
      if (skippedCount) parts.push(`跳过 ${skippedCount} 个`);
      if (recreatedCount) parts.push(`重建 ${recreatedCount} 个`);
      if (failedCount) parts.push(`失败 ${failedCount} 个`);

      toastSuccess(parts.length > 0 ? parts.join("，") : "下载任务处理完成");
    } catch (err) {
      // ApiError already toasted by client.ts
    } finally {
      if (isMountedRef.current) {
        setDownloading(false);
      }
    }
  };

  const handleConfirmBatchDownload = () => {
    if (!selectedSource) return;
    if (selectedEpisodeIndices.size === 0) return;

    // 立即关闭弹窗、清空选择，避免阻塞 UI；实际提示由 createTasksAsync 完成后给出
    const source = selectedSource;
    const indices = new Set(selectedEpisodeIndices);
    setEpisodePickerOpen(false);
    setSelectedSource(null);
    setSelectedEpisodeIndices(new Set());

    createTasksAsync(source, indices, item);
  };

  const actionBar = (
    <div
      className="row detail-actions"
      style={{
        marginTop: isSheet ? 0 : 8,
        gap: isSheet ? 12 : undefined,
      }}
    >
      <button
        className="btn btn-primary"
        onClick={handlePlay}
        disabled={!detailReady}
        style={isSheet ? { flex: 1, minHeight: 48 } : undefined}
      >
        播放
      </button>
      <button
        className="btn"
        onClick={handleDownload}
        disabled={!detailReady}
        style={isSheet ? { flex: 1, minHeight: 48 } : undefined}
      >
        下载
      </button>
      <button
        className="btn"
        onClick={handleFavorite}
        style={isSheet ? { flex: 1, minHeight: 48 } : undefined}
      >
        {isFavorited ? "已收藏" : "收藏"}
      </button>
    </div>
  );

  return (
    <div className={variant === "page" ? "col" : "detail-content"}>
      {variant === "page" && (
        <button
          className="btn"
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate("/");
            }
          }}
          style={{
            alignSelf: "flex-start",
            padding: "4px 12px",
            fontSize: 13,
            marginBottom: 4,
          }}
          aria-label="返回"
        >
          ← 返回
        </button>
      )}
      <div
        className="row detail-layout"
        style={{
          alignItems: isSheet ? "stretch" : "flex-start",
          flexDirection: isSheet ? "column" : "row",
        }}
      >
        <div
          className="detail-poster-wrap"
          style={{
            width: isSheet ? "100%" : 220,
            flexShrink: 0,
            maxHeight: isSheet ? "45vh" : undefined,
          }}
        >
          {variant === "page" ? (
            <PosterImage
              title={item.title}
              year={item.year}
              posterUrl={item.poster_url || detail[0]?.poster_url}
              posterUrls={item.poster_urls}
              alt={item.title}
              loading="eager"
              style={{ width: "100%", minHeight: 300 }}
              placeholder={
                <div className="empty" style={{ height: "100%" }}>
                  无封面
                </div>
              }
            />
          ) : (
            // 弹窗/抽屉形态：海报包共享 layoutId 容器，与卡片端补间生长
            <motion.div
              layoutId={posterLayoutId(item.title, item.year)}
              style={{
                width: "100%",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <PosterImage
                title={item.title}
                year={item.year}
                posterUrl={item.poster_url || detail[0]?.poster_url}
                posterUrls={item.poster_urls}
                alt={item.title}
                loading="eager"
                style={{
                  width: "100%",
                  minHeight: isSheet ? 200 : 300,
                  maxHeight: isSheet ? "45vh" : undefined,
                  objectFit: isSheet ? "contain" : undefined,
                }}
                placeholder={
                  <div className="empty" style={{ height: "100%" }}>
                    无封面
                  </div>
                }
              />
            </motion.div>
          )}
        </div>
        <motion.div
          className="col detail-info-wrap"
          style={{
            flex: 1,
            gap: 8,
            width: isSheet ? "100%" : undefined,
            marginTop: isSheet ? 12 : undefined,
          }}
          initial={variant === "page" ? false : { opacity: 0, y: 8 }}
          animate={variant === "page" ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.12 }}
        >
          <h2 style={{ margin: 0 }}>
            {item.title} {item.year ? `(${item.year})` : ""}
          </h2>
          {detail[0]?.area && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              地区：{detail[0].area}
            </div>
          )}
          {detail[0]?.actors && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              演员：{detail[0].actors}
            </div>
          )}
          {detail[0]?.director && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              导演：{detail[0].director}
            </div>
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
          {!isSheet && actionBar}

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
        </motion.div>
      </div>

      {isSheet && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            padding: "12px 0",
            background: "linear-gradient(to top, var(--bg-elevated) 70%, transparent)",
            zIndex: 5,
          }}
        >
          {actionBar}
        </div>
      )}

      {!isLoading &&
        detail.length > 0 &&
        detail.map((s) => {
          const key = sourceKey(s);
          const expanded = expandedSources.has(key);
          return (
            <div key={key} style={{ marginTop: 16 }}>
              <button
                type="button"
                className="source-header"
                onClick={() => toggleSource(key)}
                style={{
                  padding: isSheet ? "12px 0" : "0 0 8px",
                  fontSize: isSheet ? 15 : 14,
                  borderBottom: isSheet
                    ? "1px solid var(--glass-border)"
                    : undefined,
                }}
                aria-expanded={expanded}
              >
                <span>{s.site_name || `站点 #${s.site_id}`}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "var(--text-muted)",
                    }}
                  >
                    {s.episodes.length} 集
                  </span>
                  <ChevronIcon open={expanded} />
                </span>
              </button>
              {expanded && (
                <div style={{ marginTop: isSheet ? 8 : undefined }}>
                  <EpisodeList
                    episodes={s.episodes}
                    onPick={(index) => handlePlayEpisode(s, index)}
                  />
                </div>
              )}
            </div>
          );
        })}

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
              {selectedSource.site_name || `站点 #${selectedSource.site_id}`} ·{" "}
              {item.title}
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
                    <div style={{ color: "var(--text-secondary)", padding: 12 }}>
                      暂无可用集数
                    </div>
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
