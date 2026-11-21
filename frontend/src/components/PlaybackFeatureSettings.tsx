import { useEffect, useState } from "react";
import {
  usePlaybackFeatures,
  useUpdatePlaybackFeatures,
} from "../hooks/usePlaybackFeatures";
import { toastSuccess } from "../utils/toast";
import type { PlaybackFeatureChanges } from "../api/settings";
import "./PlaybackFeatureSettings.css";

const FEATURES = [
  {
    key: "media_analysis",
    label: "按需画质分析",
    description: "发起播放时分析当前视频的来源；每次最多 2 个，不做全库检测。",
  },
  {
    key: "playback_guard",
    label: "播放保护",
    description: "播放时让爬虫、清理、后台探测和下载退让；暂停或离开后恢复。",
  },
  {
    key: "enhancement",
    label: "轻量画质增强",
    description: "当前来源低于 1080p 时，使用本机 Lanczos 缩放与轻度锐化。",
  },
] as const;

type Draft = PlaybackFeatureChanges;

export default function PlaybackFeatureSettings() {
  const { data, isLoading } = usePlaybackFeatures();
  const update = useUpdatePlaybackFeatures();
  const [draft, setDraft] = useState<Draft>({});

  useEffect(() => {
    if (data) {
      setDraft({
        media_analysis: data.media_analysis,
        playback_guard: data.playback_guard,
        enhancement: data.enhancement,
      });
    }
  }, [data]);

  if (isLoading || !data) {
    return <div className="panel playback-features-loading">正在读取播放与画质设置…</div>;
  }

  const dirty = FEATURES.some(({ key }) => draft[key] !== data[key]);
  const save = () => {
    const changes = Object.fromEntries(
      FEATURES.filter(({ key }) => draft[key] !== data[key]).map(
        ({ key }) => [key, draft[key]]
      )
    ) as PlaybackFeatureChanges;
    update.mutate(changes, {
      onSuccess: () => toastSuccess("播放与画质设置已保存"),
    });
  };

  return (
    <section className="panel playback-features" aria-labelledby="playback-features-title">
      <div className="playback-features-head">
        <div>
          <h3 id="playback-features-title">播放与画质</h3>
          <p>仅处理当前视频；不启动全库检测或定时宽带测速。</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? "保存中…" : "保存设置"}
        </button>
      </div>

      <div className="playback-feature-list">
        {FEATURES.map((feature) => {
          const checked = Boolean(draft[feature.key]);
          const unavailable =
            feature.key === "enhancement" && !data.enhancement_available;
          return (
            <div className="playback-feature-row" key={feature.key}>
              <div className="playback-feature-copy">
                <span className="playback-feature-label">{feature.label}</span>
                <span className="playback-feature-description">
                  {feature.description}
                </span>
                {unavailable && (
                  <span className="playback-feature-note">
                    未安装 ffmpeg；安装并重启后可用
                  </span>
                )}
              </div>
              <span className="playback-feature-state">{checked ? "开启" : "关闭"}</span>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={feature.label}
                className={`feature-switch${checked ? " is-on" : ""}`}
                disabled={unavailable || update.isPending}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    [feature.key]: !checked,
                  }))
                }
              >
                <span className="feature-switch-track" aria-hidden="true">
                  <span className="feature-switch-knob" />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
