import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VideoCard from "../VideoCard";
import rawResponse from "./fixtures/search-response.json";
import type { AggregatedListResponse } from "../../types";

vi.mock("../../api/favorites", () => ({
  getFavoriteStatus: vi.fn(() =>
    Promise.resolve({ favorited: false, id: null })
  ),
  toggleFavorite: vi.fn(() => Promise.resolve({ favorited: true, id: 1 })),
}));

describe("Search results render", () => {
  const items = (rawResponse as unknown as AggregatedListResponse).items;

  it.each(items)("VideoCard renders for title=$title year=$year", (item) => {
    const { container } = render(
      <MemoryRouter>
        <VideoCard item={item} />
      </MemoryRouter>
    );
    expect(container.querySelector(".video-card")).toBeTruthy();
  });
});
