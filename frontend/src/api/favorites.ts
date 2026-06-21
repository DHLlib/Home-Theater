import { get, post, del } from "./client";
import type { Favorite, FavoriteIn } from "../types";

export const addFavorite = (body: FavoriteIn) =>
  post<Favorite>("/api/favorites", body);
export const toggleFavorite = (body: FavoriteIn) =>
  post<{ favorited: boolean; id: number | null }>("/api/favorites/toggle", body);
export const getFavoriteStatus = (title: string, year?: number | null) =>
  get<{ favorited: boolean; id: number | null }>(
    `/api/favorites/status?title=${encodeURIComponent(title)}&year=${year ?? ""}`
  );
export const listFavorites = () => get<Favorite[]>("/api/favorites");
export const removeFavorite = (id: number) =>
  del<{ ok: boolean }>(`/api/favorites/${id}`);
