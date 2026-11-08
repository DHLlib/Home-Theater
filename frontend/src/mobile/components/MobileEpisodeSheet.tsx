import BottomSheet from "../../components/BottomSheet";
import EpisodeList from "../../components/EpisodeList";
import type { SourceDetail } from "../../types";

interface MobileEpisodeSheetProps {
  /** 已由用户显式选中的来源；null 表示抽屉关闭 */
  source: SourceDetail | null;
  onClose: () => void;
  onPick: (source: SourceDetail, index: number) => void;
}

/**
 * 移动端「选集」抽屉，补齐「显式选源 → 选集 → 播放」里的第二步。
 *
 * 复用全局 BottomSheet（role="dialog" / aria-modal / 遮罩点击关闭 / 下滑关闭），
 * 这里只补 BottomSheet 自身没有的 Esc 关闭，并把 EpisodeList 的单选模式包进来。
 * 用户关闭抽屉时只回调 onClose，不产生任何播放行为。
 */
export default function MobileEpisodeSheet({
  source,
  onClose,
  onPick,
}: MobileEpisodeSheetProps) {
  // hooks 全部在 return 之前，source 置空时安全卸载
  if (!source) return null;

  const siteName = source.site_name || `站点 #${source.site_id}`;
  const hasEpisodes = source.episodes.length > 0;

  return (
    <BottomSheet open title={`选择集数 · ${siteName}`} onClose={onClose}>
      <div className="mobile-episode-sheet-head">
        <p className="mobile-episode-sheet-hint tnum">
          {hasEpisodes
            ? `共 ${source.episodes.length} 集 · 点一集开始播放`
            : "该源暂无可用集数"}
        </p>
        <button
          type="button"
          className="mobile-episode-sheet-cancel"
          onClick={onClose}
        >
          取消
        </button>
      </div>
      {hasEpisodes && (
        <div className="mobile-episode-sheet-list">
          <EpisodeList
            episodes={source.episodes}
            onPick={(index) => onPick(source, index)}
          />
        </div>
      )}
    </BottomSheet>
  );
}
