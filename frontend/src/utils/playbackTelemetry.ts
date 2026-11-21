import { reportPlaybackEvents } from "../api/play";
import type { PlaybackEventInput } from "../types";

const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 50;

let pendingEvents: PlaybackEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function createPlaybackId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function flushPlaybackEvents(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingEvents.length === 0) return;

  const events = pendingEvents;
  pendingEvents = [];
  void reportPlaybackEvents(events);
}

export function queuePlaybackEvent(event: PlaybackEventInput): void {
  pendingEvents.push(event);
  if (pendingEvents.length >= MAX_BATCH_SIZE) {
    flushPlaybackEvents();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flushPlaybackEvents, FLUSH_INTERVAL_MS);
  }
}
