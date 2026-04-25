import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getDetail } from "../api/videos";
import { getDownloadRoot } from "../api/settings";
import EpisodeList from "../components/EpisodeList";
import SourcePicker from "../components/SourcePicker";
import type {
  AggregatedVideo,
  SourceDetail,
  SourceRef,
} from "../types";

export default function Detail() {
  const location = useLocation();
  const navigate = useNavigate();
  const item = location.state as AggregatedVideo | undefined;
  const [detail, setDetail] = useState<SourceDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAction, setPickerAction] = useState<"play" | "download" | null>(
    null
  );

  useEffect(() => {
    if (item) {
      getDetail({
        title: item.title,
        year: item.year,
        sources: item.sources,
      }).then((r) => {
        setDetail(r.sources);
      });
    }
  }, [item]);

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
      alert("请先配置下载根目录");
      navigate("/settings");
      return;
    }
    setPickerAction("download");
    setPickerOpen(true);
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
        )}&ep=0`
      );
    } else if (pickerAction === "download" && d.episodes.length > 0) {
      const ep = d.episodes[0];
      alert(`将下载 ${ep.ep_name}，URL: ${ep.url}`);
    }
  };

  return (
    <div className="col">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {(item.poster_url || detail[0]?.poster_url) ? (
            <img
              src={item.poster_url || detail[0]?.poster_url || undefined}
              alt={item.title}
              style={{ width: "100%", borderRadius: 8, display: "block" }}
            />
          ) : (
            <div className="empty" style={{ height: 300 }}>
              无封面
            </div>
          )}
        </div>
        <div className="col" style={{ flex: 1, gap: 8 }}>
          <h2 style={{ margin: 0 }}>
            {item.title} {item.year ? `(${item.year})` : ""}
          </h2>
          {detail[0]?.area && (
            <div style={{ fontSize: 13, opacity: 0.8 }}>地区：{detail[0].area}</div>
          )}
          {detail[0]?.actors && (
            <div style={{ fontSize: 13, opacity: 0.8 }}>演员：{detail[0].actors}</div>
          )}
          {detail[0]?.director && (
            <div style={{ fontSize: 13, opacity: 0.8 }}>导演：{detail[0].director}</div>
          )}
          {detail[0]?.intro && (
            <div
              style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: detail[0].intro }}
            />
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handlePlay}>
              播放
            </button>
            <button className="btn" onClick={handleDownload}>
              下载
            </button>
          </div>
        </div>
      </div>

      {detail.map((s) => (
        <div
          key={`${s.site_id}-${s.original_id}`}
          style={{ marginTop: 16 }}
        >
          <h4>站点 #{s.site_id}</h4>
          <EpisodeList
            episodes={s.episodes}
            onPick={(idx) => {
              navigate(
                `/player?site_id=${s.site_id}&original_id=${encodeURIComponent(
                  s.original_id
                )}&ep=${idx}`
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
    </div>
  );
}
