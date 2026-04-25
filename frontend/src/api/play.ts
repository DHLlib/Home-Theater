import { get } from "./client";
import type { Episode } from "../types";

export const getEpisodes = (site_id: number, original_id: string) =>
  get<Episode[]>(
    `/api/play/episodes?site_id=${site_id}&original_id=${encodeURIComponent(
      original_id
    )}`
  );
