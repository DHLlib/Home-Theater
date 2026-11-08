import "./PosterEmpty.css";

interface PosterEmptyProps {
  /** 图标边长，默认 32；小卡片可传 24–28 */
  size?: number;
}

/** 海报缺图占位：全站唯一实现（图标 + 文案）。 */
export default function PosterEmpty({ size = 32 }: PosterEmptyProps) {
  return (
    <div className="poster-empty">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
      <span>暂无封面</span>
    </div>
  );
}
