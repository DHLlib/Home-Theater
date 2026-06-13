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
