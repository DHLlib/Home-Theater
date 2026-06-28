import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDetailQuery } from "../../hooks/useVideos";
import {
  toggleFavorite,
  getFavoriteStatus,
} from "../../api/favorites";
import { getDownloadRoot } from "../../api/settings";
import { createDownloadBatch } from "../../api/downloads";
import { toastError, toastSuccess } from "../../utils/toast";
import type {
  AggregatedVideo,
  DownloadBatchItem,
  SourceDetail,
  SourceRef,
} from "../../types";

interface DetailState {
  title: string;
  year: number | null;
  sources: SourceRef[];
  poster_url: string | null;
}

function sourceKey(s: SourceDetail | SourceRef): string {
  return `${s.site_id}-${s.original_id}`;
}

function pickPoster(
  item: Partial<AggregatedVideo>,
  detail?: SourceDetail
): string | undefined {
  if (item.poster_url) return item.poster_url;
  if (detail?.poster_url) return detail.poster_url;
  if (item.poster_urls && item.poster_urls.length > 0) {
    return item.poster_urls.find((u) => u?.trim()) || item.poster_urls[0];
  }
  return undefined;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={18}
      height={18}
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

export default function MobileDetailView() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as DetailState | null) || {
    title: "",
    year: null,
    sources: [],
    poster_url: null,
  };

  const item: AggregatedVideo = useMemo(
    () => ({
      title: state.title || "",
      year: state.year ?? null,
      poster_url: state.poster_url ?? null,
      sources: state.sources || [],
    }),
    [state]
  );

  const { data: detail = [], isLoading } = useDetailQuery(
    item.title,
    item.year,
    item.sources
  );

  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [isFavorited, setIsFavorited] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (detail.length === 0) return;
    setExpandedSources(new Set([sourceKey(detail[0])]));
  }, [detail]);

  useEffect(() => {
    let cancelled = false;
    getFavoriteStatus(item.title, item.year).then((res) => {
      if (!cancelled) setIsFavorited(res.favorited);
    });
    return () => {
      cancelled = true;
    };
  }, [item.title, item.year]);

  const toggleSource = (key: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const buildPlayerUrl = (
    siteId: number,
    originalId: string,
    epIndex: number
  ) => {
    const yearParam = item.year != null ? `&year=${item.year}` : "";
    return `/player?site_id=${siteId}&original_id=${encodeURIComponent(
      originalId
    )}&ep=${epIndex}&title=${encodeURIComponent(item.title)}${yearParam}`;
  };

  const handlePlayFirst = () => {
    const s = detail.find((d) => d.episodes.length > 0);
    if (!s) {
      toastError("暂无可播放集数");
      return;
    }
    navigate(buildPlayerUrl(s.site_id, s.original_id, 0), {
      state: { episodes: s.episodes },
    });
  };

  const handlePlayEpisode = (s: SourceDetail, index: number) => {
    navigate(buildPlayerUrl(s.site_id, s.original_id, index), {
      state: { episodes: s.episodes },
    });
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
      .catch(() => toastError("收藏操作失败"));
  };

  const handleDownloadSource = async (s: SourceDetail) => {
    if (s.episodes.length === 0) {
      toastError("该源暂无可用集数");
      return;
    }
    const root = await getDownloadRoot();
    if (!root) {
      toastError("请先配置下载根目录");
      navigate("/me/settings");
      return;
    }
    const key = sourceKey(s);
    setDownloadingKey(key);
    try {
      const episodes: DownloadBatchItem[] = s.episodes.map((ep) => ({
        episode_index: ep.index,
        episode_name: ep.ep_name,
        url: ep.url,
        suffix: ep.suffix,
      }));
      const result = await createDownloadBatch({
        site_id: s.site_id,
        original_id: s.original_id,
        title: item.title,
        year: item.year,
        episodes,
      });
      const parts: string[] = [];
      if (result.created.length) parts.push(`新建 ${result.created.length} 个`);
      if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 个`);
      if (result.recreated.length)
        parts.push(`重建 ${result.recreated.length} 个`);
      toastSuccess(parts.length > 0 ? parts.join("，") : "下载任务处理完成");
    } catch {
      // client.ts 已 toast
    } finally {
      if (isMountedRef.current) setDownloadingKey(null);
    }
  };

  const poster = pickPoster(item, detail[0]);
  const firstSource = detail.find((d) => d.episodes.length > 0);

  return (
    <div className="mobile-detail">
      <header className="mobile-detail-header">
        <button
          className="mobile-back-btn"
          aria-label="返回"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate("/");
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="mobile-detail-title" title={item.title}>
          {item.title}
        </h1>
      </header>

      <div className="mobile-detail-body">
        <div className="mobile-detail-meta">
          <div className="mobile-detail-poster">
            {poster ? (
              <img src={poster} alt={item.title} />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                }}
              >
                无封面
              </div>
            )}
          </div>
          <div className="mobile-detail-info">
            <h2 className="mobile-detail-name">
              {item.title} {item.year ? `(${item.year})` : ""}
            </h2>
            {detail[0]?.area && (
              <div className="mobile-detail-sub">地区：{detail[0].area}</div>
            )}
            {detail[0]?.director && (
              <div className="mobile-detail-sub">导演：{detail[0].director}</div>
            )}
            {detail[0]?.actors && (
              <div className="mobile-detail-sub">演员：{detail[0].actors}</div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <button
            className="btn btn-primary"
            style={{ minHeight: 44 }}
            disabled={!firstSource || isLoading}
            onClick={handlePlayFirst}
          >
            立即播放
          </button>
          <button
            className="btn"
            style={{ minHeight: 44 }}
            onClick={handleFavorite}
          >
            {isFavorited ? "已收藏" : "收藏"}
          </button>
          <button
            className="btn"
            style={{ minHeight: 44 }}
            onClick={() => navigate("/downloads")}
          >
            查看下载
          </button>
        </div>

        {detail[0]?.intro && (
          <div className="mobile-detail-desc">
            {detail[0].intro.replace(/<[^>]*>/g, "")}
          </div>
        )}

        {isLoading && detail.length === 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "32px 0",
              color: "var(--text-secondary)",
              fontSize: 13,
            }}
          >
            <div className="spinner" style={{ width: 18, height: 18 }} />
            正在加载源信息...
          </div>
        )}

        {!isLoading && detail.length === 0 && (
          <div className="mobile-empty" style={{ padding: 40 }}>
            <div className="mobile-empty-title">暂无可用源信息</div>
          </div>
        )}

        {detail.map((s) => {
          const key = sourceKey(s);
          const expanded = expandedSources.has(key);
          return (
            <div key={key} className="mobile-source-section">
              <div
                className="mobile-source-header"
                onClick={() => toggleSource(key)}
                role="button"
                aria-expanded={expanded}
              >
                <span className="mobile-source-name">
                  {s.site_name || `站点 #${s.site_id}`}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--text-secondary)",
                  }}
                >
                  <span className="mobile-source-count">
                    {s.episodes.length} 集
                  </span>
                  <ChevronIcon open={expanded} />
                </span>
              </div>
              {expanded && (
                <div style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <div className="mobile-episode-grid">
                    {s.episodes.map((ep) => (
                      <button
                        key={ep.index}
                        className="mobile-episode-btn"
                        onClick={() => handlePlayEpisode(s, ep.index)}
                      >
                        {ep.ep_name}
                      </button>
                    ))}
                  </div>
                  {s.episodes.length > 0 && (
                    <div style={{ padding: "0 12px 12px" }}>
                      <button
                        className="btn"
                        style={{ width: "100%", minHeight: 44 }}
                        disabled={downloadingKey === key}
                        onClick={() => handleDownloadSource(s)}
                      >
                        {downloadingKey === key
                          ? "创建下载中..."
                          : `下载全部 (${s.episodes.length} 集)`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
