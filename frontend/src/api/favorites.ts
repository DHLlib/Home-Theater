import { get, post, del } from "./client";
import type { Favorite, FavoriteIn } from "../types";

export const addFavorite = (body: FavoriteIn) =>
  post<Favorite>("/api/favorites", body);
export const listFavorites = () => get<Favorite[]>("/api/favorites");
export const removeFavorite = (id: number) =>
  del<{ ok: boolean }>(`/api/favorites/${id}`);
