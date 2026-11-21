import type { SourceRef } from "../types";
import "./SourceBadges.css";

export default function SourceBadges({ source }: { source: SourceRef }) {
  if (!source.hd_recommended && !source.stable_recommended) return null;
  return (
    <span className="source-badges">
      {source.hd_recommended && (
        <span className="source-badge">高清推荐</span>
      )}
      {source.stable_recommended && (
        <span className="source-badge">网络稳定推荐</span>
      )}
    </span>
  );
}
