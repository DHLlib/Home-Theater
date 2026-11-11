import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import PosterEmpty from "./PosterEmpty";
import SourcePicker from "./SourcePicker";
import {
  ChevronDownIcon,
  HeartIcon,
  PlayIcon,
  DownloadIcon,
} from "./icons";
import type {
  AggregatedVideo,
  DownloadBatchItem,
  SourceDetail,
  SourceRef,
} from "../types";
import { displayYear } from "../utils/year";
import "./DetailContent.css";

export type DetailVariant = "page" | "modal" | "sheet";

/**
 * 海报共享元素 layoutId。VideoCard（卡片端）与 DetailContent（弹窗端）必须
 * 用同一份构造逻辑，framer-motion 才能在两端间做生长补间。
 */
export function posterLayoutId(title: string, year?: number | null): string {
  return `poster-${title}-${year ?? "null"}`;
}

/** 资源站简介是 HTML 片段：去标签后还要解实体，否则会露出 &#39; 之类。 */
export function cleanIntro(raw: string | null | undefined): string {
  if (!raw) return "";
  const el = document.createElement("textarea");
  el.innerHTML = raw.replace(/<[^>]*>/g, " ");
  return el.value.replace(/\s+/g, " ").trim();
}

export interface DetailContentProps {
  item: AggregatedVideo;
  variant?: DetailVariant;
}

function sourceKey(s: SourceDetail | SourceRef): string {
  return `${s.site_id}-${s.original_id}`;
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

  const { data: detailResp, isLoading } = useDetailQuery(
    item.title,
    item.year,
    item.sources
  );
  const detail = detailResp?.sources ?? [];
  const systemCategory = detailResp?.system_category ?? null;

  const detailReady = !isLoading && detail.length > 0;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceRef | null>(null);
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [selectedEpisodeIndices, setSelectedEpisodeIndices] = useState<
    Set<number>
  >(new Set());
  const [downloading, setDownloading] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  // 打开详情时所有来源默认折叠，由用户手动展开
  const defaultExpanded = useMemo(() => new Set<string>(), []);

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

  // 弹窗本身就是「选源 + 选集」的表面：主操作不再叠一层选源弹层，
  // 而是把视线带到下方来源区，并展开第一个可用来源的集数。
  const sourcesRef = useRef<HTMLElement>(null);

  const handlePlay = () => {
    if (!detailReady) return;
    const target = detail.find((s) => s.episodes.length > 0) ?? detail[0];
    if (target) {
      setExpandedSources((prev) => new Set(prev).add(sourceKey(target)));
    }
    sourcesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleDownload = async () => {
    const root = await getDownloadRoot();
    if (!root) {
      toastError("请先配置下载根目录");
      navigate("/settings");
      return;
    }
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
    if (d.episodes.length === 0) {
      toastError("该源暂无可用集数");
      return;
    }
    setSelectedSource(source);
    setSelectedEpisodeIndices(new Set());
    setEpisodePickerOpen(true);
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

  // 选源弹层里给用户可比较的信息，而不是数据库 ID
  const sourceSubtitle = (s: SourceRef): string | undefined => {
    const d = detail.find(
      (x) => x.site_id === s.site_id && x.original_id === s.original_id
    );
    const parts: string[] = [];
    if (d) parts.push(`${d.episodes.length} 集`);
    if (s.type) parts.push(s.type);
    if (s.remarks) parts.push(s.remarks);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  };

  // 来源区的提示跟着展开状态变化，而不是一句静态文案
  const expandedCount = detail.filter((s) =>
    expandedSources.has(sourceKey(s))
  ).length;

  const actionBar = (
    <div className={`dc-actions${isSheet ? " is-sheet" : ""}`}>
      <button
        type="button"
        className="dc-btn dc-btn-primary"
        onClick={handlePlay}
        disabled={!detailReady}
      >
        <PlayIcon size={16} />
        选源播放
      </button>
      <button
        type="button"
        className="dc-btn"
        onClick={handleDownload}
        disabled={!detailReady}
      >
        <DownloadIcon size={16} />
        下载
      </button>
      <button
        type="button"
        className={`dc-btn dc-btn-fav${isFavorited ? " is-on" : ""}`}
        onClick={handleFavorite}
        aria-pressed={isFavorited}
        aria-label={isFavorited ? "取消收藏" : "收藏"}
      >
        <HeartIcon size={16} style={{ fill: isFavorited ? "currentColor" : "none" }} />
        {isFavorited ? "已收藏" : "收藏"}
      </button>
    </div>
  );

  return (
    <div className="dc" data-variant={variant}>
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
            gap: 4,
          }}
          aria-label="返回"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回
        </button>
      )}
      <div className="dc-head">
        <div className="dc-poster">
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
                style={{ width: "100%" }}
                placeholder={<PosterEmpty />}
              />
            </motion.div>
          )}
        </div>
        <motion.div
          className="dc-info"
          style={{
            flex: 1,
            width: isSheet ? "100%" : undefined,
          }}
          initial={variant === "page" ? false : { opacity: 0, y: 8 }}
          animate={variant === "page" ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.1 }}
        >
          <h2 className="dc-title">{item.title}</h2>
          <div className="dc-meta tnum">
            {[
              item.year != null ? String(displayYear(item.year) ?? "") || null : null,
              detail[0]?.area ?? null,
              // 来源分类 = 第一个来源站的原始类名；系统分类 = 聚合后的归类结果
              detail[0]?.type_name ? `来源分类 ${detail[0].type_name}` : null,
              item.sources.length > 0 ? `${item.sources.length} 个来源` : null,
              // 系统分类是聚合后的归类结果；与上面「来源原始类名」不同，便于核对映射
              `系统分类 ${systemCategory ?? "未分类"}`,
            ]
              .filter(Boolean)
              .map((label, i) => (
                <Fragment key={`${label}-${i}`}>
                  {i > 0 && <i aria-hidden="true">·</i>}
                  <span>{label}</span>
                </Fragment>
              ))}
          </div>
          {(detail[0]?.director || detail[0]?.actors) && (
            <div className="dc-credits">
              {detail[0]?.director && <span>导演 {detail[0].director}</span>}
              {detail[0]?.actors && <span>演员 {detail[0].actors}</span>}
            </div>
          )}
          {detail[0]?.intro && (
            <p className="dc-intro">{cleanIntro(detail[0].intro)}</p>
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
            background: "var(--bg-elevated)",
            borderTop: "1px solid var(--border)",
            zIndex: 5,
          }}
        >
          {actionBar}
        </div>
      )}

      {!isLoading && detail.length > 0 && (
        <section className="dc-sources" ref={sourcesRef}>
          <div className="dc-sources-head">
            <h3>来源</h3>
            <span className="dc-sources-count tnum">{detail.length} 个</span>
            <span className="dc-sources-hint">
              {expandedCount > 0
                ? `已展开 ${expandedCount} 个来源，点集数开始播放`
                : "点一个来源，展开选集"}
            </span>
          </div>
          <div className="source-list">
            {detail.map((s) => {
            const key = sourceKey(s);
            const expanded = expandedSources.has(key);
            return (
              <div
                key={key}
                className={`source-block${expanded ? " expanded" : ""}`}
              >
                <button
                  type="button"
                  className="source-header"
                  onClick={() => toggleSource(key)}
                  aria-expanded={expanded}
                >
                  <span className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span>{s.site_name || `站点 #${s.site_id}`}</span>
                    {s.type_name && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          padding: "1px 6px",
                          background: "var(--bg-surface)",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                        }}
                      >
                        {s.type_name}
                      </span>
                    )}
                  </span>
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
                    <ChevronDownIcon
                      size={16}
                      style={{
                        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform var(--transition-fast)",
                      }}
                    />
                  </span>
                </button>
                {expanded && (
                  <div className="source-body">
                    <EpisodeList
                      episodes={s.episodes}
                      onPick={(index) => handlePlayEpisode(s, index)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </section>
      )}

      <SourcePicker
        open={pickerOpen}
        sources={item.sources}
        title="选择下载源"
        onCancel={() => setPickerOpen(false)}
        onConfirm={onConfirmSource}
        formatSubtitle={sourceSubtitle}
      />

      {/* 集数选择对话框 */}
      {episodePickerOpen && selectedSource && (
        <div
          className="ep-picker-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEpisodePickerOpen(false);
          }}
        >
          <div className="ep-picker-dialog">
            <h3 className="ep-picker-title">选择要下载的集数</h3>
            <p className="ep-picker-sub">
              {selectedSource.site_name || `站点 #${selectedSource.site_id}`} ·{" "}
              {item.title}
            </p>

            <div className="ep-picker-body">
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
