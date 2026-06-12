---
timestamp: 2026-06-11T13-28-42Z
slug: src-pages-player-tsx-frontend-src-pages-search-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeleton loaders good; progress-save invisible to user; download progress via SSE but no per-page indicator |
| 2 | Match System / Real World | 3 | Natural terminology; "source" concept may confuse first-timers; VideoCard hover play button skips explicit source selection (violates product contract) |
| 3 | User Control and Freedom | 2 | Can cancel SourcePicker; but VideoCard hover play has no escape from auto-first-source; no back buttons on Detail/Player/Search |
| 4 | Consistency and Standards | 2 | borderRadius values diverge (4px token vs 6px/8px hardcoded); opacity hardcoded instead of tokens; HeartIcon uses #ff4081 outside design system; alert() vs toast inconsistency |
| 5 | Error Prevention | 2 | Download root check good; empty episode check good; dangerouslySetInnerHTML is a security hole; VideoCard play can pick empty source set |
| 6 | Recognition Rather Than Recall | 3 | Categories visible; current episode highlighted; no search history; no recently-watched list |
| 7 | Flexibility and Efficiency of Use | 2 | Keyboard seek (arrow keys + long-press) is excellent; no batch download; no keyboard shortcut map; no power-user accelerators beyond seek |
| 8 | Aesthetic and Minimalist Design | 3 | Deep-black theme is cohesive; card hover glow elegant; hardcoded opacity/borderRadius and #ff4081 heart create visual noise |
| 9 | Error Recovery | 2 | Search shows inline errors well; Detail uses native alert() which breaks immersion; play errors only console.error; no retry affordance |
| 10 | Help and Documentation | 1 | No help, no tooltips, no onboarding, no contextual guidance for "source" concept |
| **Total** | | **24/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: This does not read as AI-generated. The deep-black cinema theme is intentional and consistent, with a disciplined single-accent palette (breathing green). No gradient text, no hero-metrics, no numbered eyebrows, no side-stripe borders. The skeleton shimmer, card hover overlay, and scroll-row fade edges show craft. Two slop-like tells: (1) hardcoded `borderRadius: 6` and `8` values that don't match the committed token system, suggesting later edits without design-system discipline; (2) `#ff4081` heart icon for favorites—a gratuitous accent color that breaks the "one breath" rule. Otherwise the aesthetic is bespoke, not templated.

**Deterministic scan**: CLI detector found 1 issue, but it lives in `Dashboard.tsx` (`transition: width` layout animation)—outside the four target pages. The four pages (Home, Detail, Player, Search) are clean from detector perspective. No false positives to report.

**Visual overlays**: Not attempted—no browser automation injection performed for this run.

## Overall Impression

The interface has a strong visual identity: the private-cinema dark room is convincing, the card interactions are polished, and the hero billboard creates impact. The biggest opportunity is tightening execution discipline—design tokens are partially ignored in inline styles, core product rules (explicit source selection) are violated by shortcut affordances, and error handling regresses to native alerts that shatter the carefully built atmosphere.

## What's Working

1. **Card hover overlay**. The desktop hover state on VideoCard (gradient mask, action buttons, scale transform, title color shift to green) is exactly the right amount of interactivity for a cinema-themed media library. It reveals without shouting.
2. **Skeleton loading**. The shimmer animation on skeleton bars fits the dark theme and provides meaningful loading feedback during the initial 20-40 minute sync window.
3. **Keyboard seek with long-press**. The arrow-key handler (short 15s jump, hold 2s for continuous 5s increments) is a thoughtful power-user feature that fits the playback context perfectly.

## Priority Issues

**[P0] VideoCard hover play button violates explicit-source-selection contract**
- **Why it matters**: The product's core rule is "users must explicitly choose a source before playing." The hover overlay's "播放" button navigates directly to Player using `sources[0]`, silently auto-selecting. This undermines user trust and breaks the multi-source design promise.
- **Fix**: Remove the direct-play shortcut from hover overlay. Both "播放" and "详情" buttons should navigate to Detail. If a quick-play is truly needed, it must open a SourcePicker first.
- **Suggested command**: `/impeccable harden` (fix contract violation)

**[P1] dangerouslySetInnerHTML in Detail intro**
- **Why it matters**: `detail[0].intro` is injected raw. This is an XSS vector and can also inject unexpected styles/fonts that break the visual system. A rogue `<font color="red">` in scraped data would appear in the UI.
- **Fix**: Sanitize with DOMPurify and strip all tags except a short whitelist (e.g. `<br>`), or render as plain text.
- **Suggested command**: `/impeccable harden`

**[P1] Design token drift in inline styles**
- **Why it matters**: The design system defines rounded tokens (2/4/16/100) and opacity should be expressed via color variables. Hardcoded values create inconsistency that erodes the "precision instrument" feel.
- **Fix**: Audit all inline `borderRadius` and `opacity` values:
  - `Search.tsx` input/error boxes: `borderRadius: 6` → `4px` (or add `--rounded-sm` token if 6px is intentional)
  - `Home.tsx` skeleton: `borderRadius: 8` → `4px` or `var(--rounded-md)`
  - `Detail.tsx` meta lines: `opacity: 0.8/0.75` → `color: var(--text-secondary)`
  - `VideoCard.tsx` heart icon: `#ff4081` → `var(--primary)` or `var(--danger)` per design system
- **Suggested command**: `/impeccable polish`

**[P1] Native alert() breaks immersion**
- **Why it matters**: Four `alert()` calls in Detail.tsx (download root missing, empty episodes, download created, parse failure) and one in the download episode handler. Native browser dialogs are modal, unstyled, and jarring against the dark glass aesthetic.
- **Fix**: Replace all `alert()` with the existing toast system (`toastSuccess`, add `toastError`).
- **Suggested command**: `/impeccable harden`

**[P2] No back navigation on Detail/Player/Search**
- **Why it matters**: Users entering Detail from a direct link or refreshing lose the browser history stack. No in-app back button means they can't return to browsing without using browser chrome.
- **Fix**: Add a subtle back arrow (top-left of page content, or in top-nav) that navigates to `/`.
- **Suggested command**: `/impeccable layout`

**[P2] Player keyboard control relies on fragile focus**
- **Why it matters**: Keyboard events are bound to `containerRef` with `tabIndex={0}`. If the user clicks anywhere else (e.g. a browser extension UI, the address bar, or inside the video player), the container loses focus and arrow keys stop working.
- **Fix**: Use global `window` keydown/keyup with a check that no input/textarea is focused, or ensure the player container refocuses after click.
- **Suggested command**: `/impeccable harden`

## Persona Red Flags

**Alex (Power User)**
- VideoCard hover "播放" auto-picks first source without asking—Alex realizes the app makes choices for him and loses trust in the multi-source abstraction.
- No keyboard shortcut reference. Alex discovers arrow-key seek by accident but has no way to learn other shortcuts.
- No batch download. Alex wants to queue an entire season; must click each episode individually in the download picker.

**Jordan (First-Timer)**
- "源" is never explained. Jordan sees "选择播放源" and doesn't know what a source is or why it matters.
- Player grouped episodes show labels like "线路 1" / "线路 2" with no explanation. Jordan doesn't know what a "线路" is.
- No onboarding or empty-state guidance beyond "请先去设置页添加资源站点." Jordan doesn't know what a "资源站点" is or where to find one.

**Casey (Distracted Mobile User)**
- MobileSearchBar sits at the top of Home—out of thumb reach on large phones.
- Player mobile bottom drawer for episodes is good, but the "选集" button is small (min-height 44px meets target, but padding is tight).
- No state persistence for sidebar open/closed preference; Casey closes sidebar, rotates phone, sidebar reopens.

## Minor Observations

- `Player.tsx` `height: "calc(100dvh - 80px)"` hardcodes nav height; fragile if nav height changes.
- `Search.tsx` has no loading skeleton—just button text change from "搜索" to "搜索中...".
- HeroSection uses `clamp(36px, 6vw, 60px)` which exceeds the Design.md Display token `clamp(1.5rem, 4vw, 3rem)` (~24-48px). At 60px it may feel oversized.
- Back-to-top button uses `box-shadow`—violates the No-Shadow Rule; replace with subtle `backdrop-filter` glass.
- `VideoCard.tsx` `loading="lazy"` is good, but no placeholder transition—images pop in abruptly.
- Category dropdown in global.css uses `box-shadow: 0 8px 32px rgba(0,0,0,0.5)`—minor shadow violation.

## Questions to Consider

- Should the VideoCard hover overlay even have a "播放" button, or should it be single-purpose (click card → Detail)? The shortcut saves one click but breaks a core product rule.
- If we can't remove the scraped HTML from intros, what subset of tags is actually useful to viewers? Would plain text with line-breaks suffice?
- The "线路" grouping in the player is technically correct (multi-line episodes from the same source), but is this abstraction useful to viewers, or should episodes always be a flat list with line markers?
