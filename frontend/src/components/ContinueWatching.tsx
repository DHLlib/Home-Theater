import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PosterImage from "./PosterImage";
import PosterEmpty from "./PosterEmpty";
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from "./icons";
import { progressPercent, progressTitleKey } from "../utils/progress";
import { buildResumePlayerUrl } from "../utils/playback";
import type { AggregatedVideo, PlayProgress } from "../types";
import "./ContinueWatching.css";

/** 继续观看卡片需要的海报字段（来自首页已经加载的聚合数据） */
export interface ContinueWatchingPoster {
  poster_url?: string | null;
  poster_urls?: string[] | null;
}

export interface ContinueWatchingProps {
  /** 已过滤（有进度、未看完）、按 title+year 去重并按最近观看排序的播放记录 */
  items: PlayProgress[];
  /**
   * title + year → 海报 的索引，key 由 progressTitleKey 生成。
   * 仅在 item.poster_url（后端 /recent 关联聚合表返回）缺失时作为兜底；
   * 仍未命中时 PosterImage 会回退到 IndexedDB 的封面成功缓存，再回退到 PosterEmpty。
   */
  posterMap?: ReadonlyMap<string, ContinueWatchingPoster>;
}

function hasPoster(poster: ContinueWatchingPoster | undefined): boolean {
  return Boolean(
    poster && (poster.poster_url || (poster.poster_urls?.length ?? 0) > 0)
  );
}

/**
 * 从首页已经加载的聚合列表建立海报索引。
 * /api/progress/recent 已尽量带出 poster_url；这里只为仍缺封面的记录做本地兜底，
 * 不为「继续观看」额外发请求。
 */
export function buildContinueWatchingPosterMap(
  ...lists: ReadonlyArray<readonly AggregatedVideo[]>
): Map<string, ContinueWatchingPoster> {
  const map = new Map<string, ContinueWatchingPoster>();
  for (const list of lists) {
    for (const video of list) {
      if (!video.poster_url && !(video.poster_urls?.length ?? 0)) continue;
      const key = progressTitleKey(video.title, video.year);
      if (hasPoster(map.get(key))) continue;
      map.set(key, {
        poster_url: video.poster_url,
        poster_urls: video.poster_urls,
      });
    }
  }
  return map;
}

function ContinueWatchingCard({
  item,
  poster,
  onResume,
}: {
  item: PlayProgress;
  poster?: ContinueWatchingPoster;
  onResume: (item: PlayProgress) => void;
}) {
  const pct = progressPercent(item);
  // 进度不足 1%（四舍五入后为 0）时不显示「已看 0%」，避免看起来像没开始
  const progressLabel = pct < 1 ? "刚刚开始" : `已看 ${pct}%`;
  const episodeLabel =
    item.episode_name.trim() || `第 ${item.episode_index + 1} 集`;
  const handleActivate = () => onResume(item);

  return (
    <div className="cw-item">
      <article
        className="cw-card"
        role="button"
        tabIndex={0}
        aria-label={`继续观看 ${item.title}，${episodeLabel}，${progressLabel}`}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate();
          }
        }}
      >
        <div className="cw-poster">
          <PosterImage
            title={item.title}
            year={item.year}
            posterUrl={poster?.poster_url}
            posterUrls={poster?.poster_urls}
            alt={item.title}
            loading="lazy"
            placeholder={<PosterEmpty size={28} />}
          />
          <span className="cw-play" aria-hidden="true">
            <span className="cw-play-icon">
              <PlayIcon size={16} />
            </span>
          </span>
          <div className="cw-progress" aria-hidden="true">
            <div className="cw-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="cw-caption">
          <h3 className="cw-card-title" title={item.title}>
            {item.title}
          </h3>
          <p
            className="cw-meta tnum"
            title={`${episodeLabel} · ${progressLabel}`}
          >
            <span className="cw-episode">{episodeLabel}</span>
            <i aria-hidden="true">·</i>
            <span className="cw-percent">{progressLabel}</span>
          </p>
        </div>
      </article>
    </div>
  );
}

/**
 * 首页「继续观看」横条：横向滚动 + 吸附；没有可继续的记录时整块不渲染。
 * 数据由 useContinueWatching 提供，跳转复用「最近播放」页的播放器 URL。
 */
export default function ContinueWatching({
  items,
  posterMap,
}: ContinueWatchingProps) {
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  const updateScrollable = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanScroll(el.scrollWidth - el.clientWidth > 8);
  }, []);

  useEffect(() => {
    updateScrollable();
    const el = trackRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScrollable);
      return () => window.removeEventListener("resize", updateScrollable);
    }
    const ro = new ResizeObserver(updateScrollable);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollable, items]);

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.8, 320);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  // 空态：没有「有进度且未看完」的记录时整块不渲染（不占位、不显示暂无数据）
  if (items.length === 0) return null;

  return (
    <section className="cw-section" aria-label="继续观看">
      <div className="cw-head">
        <h2 className="cw-title">继续观看</h2>
      </div>

      <div className="cw-viewport">
        <div className="cw-track" ref={trackRef}>
          {items.map((item) => {
            // 海报优先级：后端 /recent 的 poster_url > 首页聚合列表索引 >
            // PosterImage 的 IndexedDB 缓存 > PosterEmpty 占位
            const poster = item.poster_url
              ? { poster_url: item.poster_url }
              : posterMap?.get(progressTitleKey(item.title, item.year));

            return (
              <ContinueWatchingCard
                key={item.id}
                item={item}
                poster={poster}
                onResume={(target) => navigate(buildResumePlayerUrl(target))}
              />
            );
          })}
        </div>

        {canScroll && (
          <>
            <button
              type="button"
              className="cw-arrow left"
              aria-label="向左翻页"
              onClick={() => scrollBy(-1)}
            >
              <ChevronLeftIcon size={18} />
            </button>
            <button
              type="button"
              className="cw-arrow right"
              aria-label="向右翻页"
              onClick={() => scrollBy(1)}
            >
              <ChevronRightIcon size={18} />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
