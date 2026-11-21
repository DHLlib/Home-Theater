import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourcePicker from "../SourcePicker";
import type { SourceRef } from "../../types";

const sources: SourceRef[] = [
  { site_id: 1, site_name: "站点A", original_id: "abc", type: "movie" },
  { site_id: 2, site_name: "站点B", original_id: "def", type: "movie" },
];

describe("SourcePicker (AC-007)", () => {
  it("点击源项直接触发 onConfirm 并传入所选源", async () => {
    const onConfirm = vi.fn();
    render(
      <SourcePicker
        sources={sources}
        open={true}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    );

    await userEvent.click(screen.getByText(/站点B/));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 2, original_id: "def" })
    );
  });

  it("展示真实推荐理由但不自动选择来源", () => {
    const onConfirm = vi.fn();
    const recommended: SourceRef[] = [
      {
        ...sources[0],
        recommended: true,
        hd_recommended: true,
        stable_recommended: true,
        media: {
          width: 1920,
          height: 1080,
          evidence: "actual",
          method: "playing",
          checked_at: "2026-11-21T00:00:00",
          description: "实测 1920×1080 · 6.0 Mbps",
        },
        recommendation_reason: "近 30 天 10 次播放 · 起播成功率 90%",
      },
      sources[1],
    ];
    render(
      <SourcePicker
        sources={recommended}
        open={true}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText("高清推荐")).toBeInTheDocument();
    expect(screen.getByText("网络稳定推荐")).toBeInTheDocument();
    expect(screen.getByText(/实测 1920×1080/)).toBeInTheDocument();
    expect(screen.getByText(/起播成功率 90%/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("无可用源时显示提示", () => {
    render(
      <SourcePicker
        sources={[]}
        open={true}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );

    expect(screen.getByText("无可用源")).toBeInTheDocument();
  });

  it("点击遮罩层触发 onCancel", async () => {
    const onCancel = vi.fn();
    render(
      <SourcePicker
        sources={sources}
        open={true}
        onCancel={onCancel}
        onConfirm={() => {}}
      />
    );

    const mask = screen.getByText("请选择来源").parentElement?.parentElement;
    expect(mask).toBeTruthy();
    await userEvent.click(mask!);
    expect(onCancel).toHaveBeenCalled();
  });
});
