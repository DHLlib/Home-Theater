---
timestamp: 2026-06-11T13-42-48Z
slug: src-pages-player-tsx-frontend-src-pages-search-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeleton loaders good; progress-save invisible to user |
| 2 | Match System / Real World | 3 | Natural terminology; "source" concept still un-explained for first-timers |
| 3 | User Control and Freedom | 3 | VideoCard hover play removed; back buttons added to Detail/Player/Search |
| 4 | Consistency and Standards | 3 | borderRadius/opacity tokens now aligned; alert() unified to toast; HeartIcon uses var(--danger) |
| 5 | Error Prevention | 3 | dangerouslySetInnerHTML removed; download root and empty episode checks remain |
| 6 | Recognition Rather Than Recall | 3 | Categories visible; current episode highlighted; no search history yet |
| 7 | Flexibility and Efficiency of Use | 3 | Keyboard seek fixed (global listener + input focus guard) |
| 8 | Aesthetic and Minimalist Design | 3 | Deep-black theme cohesive; minor noise from PosterPlaceholder opacity and back-to-top shadow |
| 9 | Error Recovery | 3 | All alert() replaced with toast; search inline errors preserved |
| 10 | Help and Documentation | 1 | No help, no tooltips, no onboarding |
| **Total** | | **29/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment**: The interface continues to read as intentionally designed, not AI-templated. The fixes eliminated the two strongest slop-like tells: off-token borderRadius values and the gratuitous `#ff4081` accent. No new anti-patterns introduced by the fixes.

**Deterministic scan**: Zero findings in target pages (Home, Detail, Player, Search, VideoCard). The only detector hit remains in Dashboard.tsx (`transition: width`), outside scope.

## Overall Impression

The fixes delivered measurable improvement. Score moved from 24 (Acceptable) to 29 (Good). The P0 contract violation and all three P1 issues are resolved. What remains are polish-tier items: a few lingering opacity hard-codes, the back-to-top shadow, and the perennial absence of help/documentation.

## What's Working (post-fix)

1. **Explicit source selection is now enforced**. VideoCard hover only offers "详情" and "收藏"—no more silent auto-play. The product contract is restored.
2. **Error handling no longer shatters the mood**. Native `alert()` dialogs are gone; toast notifications slide in with the same glass aesthetic as the rest of the UI.
3. **Design token discipline is largely restored**. borderRadius, text colors, and accent colors now route through CSS variables instead of hardcoded magic numbers.

## Priority Issues (remaining)

**[P2] Player episode-group labels use hardcoded opacity**
- **Where**: `Player.tsx` lines 411 and 501: `opacity: 0.6` on group headers (e.g. "线路 1")
- **Fix**: Replace with `color: var(--text-muted)` for proper token alignment.
- **Suggested command**: `/impeccable polish`

**[P2] Back-to-top button uses box-shadow**
- **Where**: `Home.tsx` line 763: `boxShadow: "0 2px 8px rgba(0,0,0,0.15)"`
- **Fix**: Remove shadow; rely on glass background (`backdrop-filter`) for elevation, per the No-Shadow Rule.
- **Suggested command**: `/impeccable polish`

**[P2] PosterPlaceholder opacity hardcoded**
- **Where**: `VideoCard.tsx` lines 48 and 55: `opacity: 0.4` and `0.5`
- **Fix**: Use `color: var(--text-muted)` on parent and let inheritance handle it.
- **Suggested command**: `/impeccable polish`

**[P3] No help or contextual guidance**
- **Where**: Entire app
- **Fix**: Add tooltips to ambiguous concepts ("源", "线路"), or a one-time contextual hint on first Detail visit.
- **Suggested command**: `/impeccable onboard`

## Minor Observations

- `Player.tsx` `height: "calc(100dvh - 80px)"` still hardcodes nav height.
- `Search.tsx` has no loading skeleton—only button text changes.
- `HeroSection` display font `clamp(36px, 6vw, 60px)` still exceeds the Design.md token ceiling.

## Questions to Consider

- Should the "线路" abstraction in the player be surfaced to users at all, or would a flat episode list with source badges be clearer?
- Is 20-40 minutes of empty-state waiting on first launch acceptable, or should there be a "demo mode" with sample content?
