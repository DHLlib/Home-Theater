# Frontend Bug Review — Home Theater v2

Project root: `D:/workspace_py/Home Theater v2`  
Review scope: `frontend/src/**/*.{ts,tsx,css}`  
Type-check: `npm run typecheck` ✅  
Tests: `npm test` ✅ (7/7)  
Build: `npm run build` ✅ (with chunk-size warning only)

---

## Critical / High

### 1. `ProgressCard` navigates to Player without `title`/`year`, breaking resume
- **File:** `frontend/src/pages/Progress.tsx`, lines 91–97
- **Severity:** High
- **Description:** The "recent" resume link only passes `site_id`, `original_id` and `ep`. `Player.tsx` reads `title` and `year` from the query string to load available sources, restore saved progress, and persist new progress.
- **Impact:** Resuming from **最近播放** silently disables source switching, progress restoration, and progress saving (the Player saves an empty title).
- **Evidence:**
  ```tsx
  navigate(
    `/player?site_id=${item.source_site_id}&original_id=${encodeURIComponent(
      item.source_video_id
    )}&ep=${item.episode_index}`
  );
  ```
  vs. `Player.tsx` lines 21–23, 82–87, 129–155, 157–200.

### 2. `lockMaxQuality` leaks the old interval when quality locks immediately
- **File:** `frontend/src/components/VideoPlayer.tsx`, lines 51–83
- **Severity:** High
- **Description:** When `tryLock()` succeeds on the first call, the function returns early without clearing `qualityTimerRef.current`. If an interval from a previous source is still running, it keeps executing against the old (possibly destroyed) HLS instance.
- **Impact:** Memory leak and potential errors / wrong state mutations after switching sources.
- **Evidence:**
  ```tsx
  if (tryLock()) return;   // line 67: skips cleanup of timerRef.current
  if (timerRef.current) {  // lines 69-72: cleanup only reached on failure
    clearInterval(timerRef.current);
    timerRef.current = null;
  }
  ```

### 3. Switching to an unsupported format leaves the previous video playing
- **File:** `frontend/src/components/VideoPlayer.tsx`, lines 248–254
- **Severity:** High
- **Description:** In the "player exists, src changed" effect, if the new suffix is unsupported the code only sets the local error state and returns. It does not pause or destroy the existing player.
- **Impact:** The previous source keeps playing audio/video behind the error overlay.
- **Evidence:**
  ```tsx
  if (!isDirectVideo) {
    const msg = `暂不支持播放该格式 (${suffix})`;
    setError(msg);
    onErrorRef.current?.(msg);
    return;   // playerRef.current is left untouched
  }
  ```

### 4. `useVideosInfinite` trims `pageParams` to the wrong length
- **File:** `frontend/src/hooks/useVideos.ts`, lines 113–117
- **Severity:** High
- **Description:** When capping in-memory pages, `pageParams` is sliced to `newPages.length + 1` instead of `newPages.length`, leaving a dangling next-page parameter.
- **Impact:** React Query’s infinite state becomes inconsistent and may trigger an extra or wrong page fetch.
- **Evidence:**
  ```tsx
  return {
    ...old,
    pages: newPages,
    pageParams: old.pageParams.slice(0, newPages.length + 1), // should be newPages.length
  };
  ```

### 5. iOS fullscreen events are attached to `document` instead of the `<video>` element
- **File:** `frontend/src/utils/fullscreen.ts`, lines 187–204
- **Severity:** High
- **Description:** `webkitbeginfullscreen` and `webkitendfullscreen` fire on the video element, but the listener is registered on `document`.
- **Impact:** On iOS, entering/exiting native video fullscreen never updates `useFullscreen` state, so fake-landscape/CSS and UI buttons stay out of sync.
- **Evidence:**
  ```ts
  document.addEventListener("webkitbeginfullscreen", handler);
  document.addEventListener("webkitendfullscreen", handler);
  ```

---

## Medium

### 6. Batch download reports success before tasks are actually created
- **File:** `frontend/src/components/DetailContent.tsx`, lines 193–206
- **Severity:** Medium
- **Description:** `handleConfirmBatchDownload` closes the dialog, clears selection, shows `"已开始创建下载任务"`, and then fires `createTasksAsync` without awaiting. If creation fails, the success toast has already been shown.
- **Impact:** Users receive misleading success feedback; failures surface later only through the generic API error toast.
- **Evidence:**
  ```tsx
  toastSuccess("已开始创建下载任务");
  createTasksAsync(source, indices, item); // fire-and-forget
  ```

### 7. Favorite remove button is hover-only (inaccessible on touch / keyboard)
- **File:** `frontend/src/pages/Favorites.tsx`, lines 112–137
- **Severity:** Medium
- **Description:** The remove button is hidden unless the card is hovered and has no focus-visible or touch fallback.
- **Impact:** Mobile/touch users and keyboard users cannot remove favorites.
- **Evidence:**
  ```tsx
  opacity: hovered ? 1 : 0;
  transform: hovered ? "scale(1)" : "scale(0.8)";
  ```

### 8. `VideoCard` always initializes favorited state as `false`
- **File:** `frontend/src/components/VideoCard.tsx`, line 76
- **Severity:** Medium
- **Description:** The heart icon starts empty regardless of whether the item is already favorited. It only updates after a manual toggle.
- **Impact:** UI does not reflect real favorite state; users may duplicate add/remove actions.
- **Evidence:**
  ```tsx
  const [favorited, setFavorited] = useState(false);
  ```

### 9. `SiteHealthDrawer` mutates its prop and leaves parent state stale
- **File:** `frontend/src/components/SiteHealthDrawer.tsx`, lines 116–125
- **Severity:** Medium
- **Description:** `toggleSite` does `site.enabled = !site.enabled` directly on the prop object. It refetches health locally but never tells the parent (`Settings`) to update its `sites` array.
- **Impact:** Closing and reopening the drawer reverts the displayed enabled state because the parent still holds the old object.
- **Evidence:**
  ```tsx
  updateSite(site.id, { enabled: !site.enabled }).then(() => {
    site.enabled = !site.enabled; // mutates prop
    ...
  });
  ```

### 10. In-flight progress restore can override an explicit episode selection
- **File:** `frontend/src/pages/Player.tsx`, lines 129–155
- **Severity:** Medium
- **Description:** `getProgress` is not cancellable. If the user clicks an episode before the restore request resolves, the response will overwrite `currentIndex` (and the delayed `seekTo` may seek the wrong episode).
- **Impact:** User picks episode X but app jumps back to the previously saved episode Y.
- **Evidence:**
  ```tsx
  getProgress(title, year).then((res) => {
    ...
    setCurrentIndex(res.episode_index);
    setTimeout(() => {
      playerRef.current?.seekTo(res.position_seconds);
    }, 500);
  })
  ```

### 11. Player arrow-key shortcuts are global and too aggressive
- **File:** `frontend/src/pages/Player.tsx`, lines 235–279
- **Severity:** Medium
- **Description:** ArrowLeft/ArrowRight listeners are attached to `window` and call `e.preventDefault()` for any target that is not an `<input>`/`<textarea>`. This hijacks arrow keys for other focusable elements while the Player is mounted.
- **Impact:** Accessibility navigation (e.g., focus rings, sliders, menus) breaks when viewing a video.
- **Evidence:**
  ```tsx
  window.addEventListener("keydown", handleKeyDown);
  ...
  e.preventDefault();
  ```

### 12. Direct episode play from detail list bypasses `SourcePicker`
- **File:** `frontend/src/components/DetailContent.tsx`, lines 360–379
- **Severity:** Medium
- **Description:** The per-source `EpisodeList` rendered in the detail view calls `navigate("/player?...")` directly. When only one source exists, the user never sees the explicit source picker required by the architecture.
- **Impact:** Violates the "no default source" rule for the play action.
- **Evidence:**
  ```tsx
  <EpisodeList
    episodes={s.episodes}
    onPick={(idx) => {
      navigate(`/player?site_id=${s.site_id}&original_id=...&ep=${idx}...`);
    }}
  />
  ```

---

## Low

### 13. `cache.ts` timeout promise leaks an unhandled rejection
- **File:** `frontend/src/utils/cache.ts`, lines 76–83
- **Severity:** Low
- **Description:** `withTimeout` races the real promise against a timeout promise that rejects. If the real promise wins, the timeout rejection is never caught.
- **Impact:** Unhandled promise rejection warnings in the console; may surface as errors in strict runtimes.
- **Evidence:**
  ```ts
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("IndexedDB timeout")), ms)
    ),
  ]);
  ```

### 14. `CategoryBar` menu hide timer is not cleared on unmount
- **File:** `frontend/src/components/CategoryBar.tsx`, lines 21, 75–79
- **Severity:** Low
- **Description:** `hideTimer` is never cleared in a cleanup effect. If the component unmounts while the timer is pending, it fires on an unmounted component.
- **Impact:** React warning / minor memory leak.
- **Evidence:**
  ```tsx
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  ...
  hideTimer.current = setTimeout(() => { setMenuOpen(null); }, 150);
  ```

### 15. `VideoPlayer` falls back poorly when `player.once` is unavailable
- **File:** `frontend/src/components/VideoPlayer.tsx`, lines 85–96
- **Severity:** Low
- **Description:** If the player instance has no `once` method, the `canplay` handler is never registered, so the secondary seek-to-zero on source switch is skipped.
- **Impact:** Source switches may briefly inherit the previous playback position.
- **Evidence:**
  ```tsx
  if (typeof (player as any).once === "function") {
    (player as any).once("canplay", handleCanPlay);
  }
  // no fallback attach via on()
  ```

### 16. POST/PUT/PATCH requests have no timeout
- **File:** `frontend/src/api/client.ts`, lines 40–45
- **Severity:** Low
- **Description:** Only `get()` accepts a `timeoutMs` argument. `post`, `put`, and `patch` call `request()` without a timeout, so long-running mutations can hang indefinitely.
- **Impact:** Hanging create/update/delete requests are never aborted.
- **Evidence:**
  ```ts
  export const post = <T>(path: string, body?: unknown) =>
    request<T>("POST", path, body);
  ```

### 17. `PosterImage` does not cancel in-flight image loads on candidate reset
- **File:** `frontend/src/components/PosterImage.tsx`, lines 61–65
- **Severity:** Low
- **Description:** When the candidate list changes, the component resets `currentIndex` but does not guard against a late `onLoad` from the previous image.
- **Impact:** Could cache/display a stale poster URL in edge cases.
- **Evidence:**
  ```tsx
  useEffect(() => {
    setCurrentIndex(0);
    setLoaded(false);
    hasFiredRef.current = false;
  }, [candidates.join("|")]);
  ```

### 18. `RecommendedCarousel` slides are not keyboard accessible
- **File:** `frontend/src/components/RecommendedCarousel.tsx`, lines 265–366
- **Severity:** Low
- **Description:** Carousel slides are `<div>` elements with `onClick` but no `role`, `tabIndex`, keyboard handlers, or ARIA labels.
- **Impact:** Keyboard and screen-reader users cannot select recommended videos.
- **Evidence:**
  ```tsx
  <div key={`${video.title}-${video.year ?? "null"}-${index}`}
       onClick={() => handleClick(index)} ...>
  ```

### 19. `DetailModalHost` `navAwayClose` can race with the path-ref effect
- **File:** `frontend/src/components/DetailModalHost.tsx`, lines 32–35, 69–73
- **Severity:** Low
- **Description:** `openPathRef` is set in a `useEffect`. If the user navigates away before that effect runs, `navAwayClose` may be `false`, causing an exit animation without a source card.
- **Impact:** Possible frozen/empty exit animation.
- **Evidence:**
  ```tsx
  useEffect(() => {
    if (active) openPathRef.current = location.pathname;
  }, [active, location.pathname]);
  ```

### 20. Player progress is only saved every 15 s or on `beforeunload`
- **File:** `frontend/src/pages/Player.tsx`, lines 157–200
- **Severity:** Low
- **Description:** Progress is persisted on a 15-second interval and via `beforeunload`. Normal in-app navigation (e.g., clicking the back button) does not force a final save.
- **Impact:** Up to ~15 seconds of progress can be lost when leaving the player normally.
- **Evidence:**
  ```tsx
  progressTimer.current = setInterval(() => { ... upsertProgress(...); }, 15000);
  window.addEventListener("beforeunload", handleBeforeUnload);
  ```

---

## Summary

- **Critical / High:** 5
- **Medium:** 7
- **Low:** 8
- **Total:** 20

The most user-visible issues are the broken **resume from recent** flow (#1), the **leaking HLS quality timer** (#2), and the **wrong infinite-scroll pageParams** (#4). The source-selection bypass (#12) also conflicts with the stated architecture rule.
