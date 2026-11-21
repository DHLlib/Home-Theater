import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportPlaybackEvents } from "../../api/play";
import type { PlaybackEventInput } from "../../types";
import {
  flushPlaybackEvents,
  queuePlaybackEvent,
} from "../playbackTelemetry";

vi.mock("../../api/play", () => ({
  reportPlaybackEvents: vi.fn().mockResolvedValue(undefined),
}));

function event(id: string): PlaybackEventInput {
  return {
    event_id: id,
    session_id: "session-1",
    site_id: 1,
    original_id: "video-1",
    episode_index: 0,
    event_type: "attempt",
  };
}

describe("playbackTelemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    flushPlaybackEvents();
    vi.mocked(reportPlaybackEvents).mockClear();
  });

  afterEach(() => {
    flushPlaybackEvents();
    vi.useRealTimers();
  });

  it("按时间批量发送事件", () => {
    queuePlaybackEvent(event("event-1"));
    queuePlaybackEvent(event("event-2"));
    expect(reportPlaybackEvents).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(reportPlaybackEvents).toHaveBeenCalledOnce();
    expect(vi.mocked(reportPlaybackEvents).mock.calls[0][0]).toHaveLength(2);
  });

  it("达到批量上限时立即发送", () => {
    for (let index = 0; index < 50; index += 1) {
      queuePlaybackEvent(event(`event-${index}`));
    }
    expect(reportPlaybackEvents).toHaveBeenCalledOnce();
    expect(vi.mocked(reportPlaybackEvents).mock.calls[0][0]).toHaveLength(50);
  });

  it("离开播放页时可以主动刷新队列", () => {
    queuePlaybackEvent(event("event-1"));
    flushPlaybackEvents();
    expect(reportPlaybackEvents).toHaveBeenCalledOnce();
  });
});
