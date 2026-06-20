import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import DetailContent from "../components/DetailContent";
import type { AggregatedVideo } from "../types";

export default function Detail() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

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

  if (!item) {
    return <div className="empty">非法入口，请从首页进入。</div>;
  }

  return <DetailContent item={item} variant="page" />;
}
