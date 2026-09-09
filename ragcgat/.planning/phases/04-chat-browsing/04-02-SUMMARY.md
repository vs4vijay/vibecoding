---
phase: 04-chat-browsing
plan: '02'
subsystem: chat-browse
tags: [sveltekit, svelte-5-runes, dexie, keyset-pagination, intersection-observer, vitest, fake-indexeddb, dark-mode, tailwind-v4]
requires: [04-chat-browsing-01]
provides: [virtualized-windowing, scroll-anchoring, day-dividers, sender-grouping, empty-states]
affects: []
tech-stack:
  added: []
  patterns: [paged-window state machine over keyset cursors, scrollHeight-delta anchor after tick, one shared IntersectionObserver per view, pure grouping helpers over thin runes components]
key-files:
  created:
    - src/lib/components/DateSeparator.svelte
  modified:
    - src/lib/chat/windows.ts
    - src/lib/components/ChatView.svelte
    - src/lib/components/MessageBubble.svelte
    - src/lib/chat/__tests__/windows.test.ts
    - src/lib/chat/__tests__/formatting.test.ts
decisions:
  - prependPage now delegates its newest-3-page trim to a standalone trimToBudget helper; dropped pages stay reachable because cursorOf recomputes from pages[0][0] (a re-read, never data loss)
  - Scroll anchoring uses the scrollHeight-delta formula after a Svelte tick flush; flex-col-reverse banned and scrollIntoView never used on prepend
  - One shared IntersectionObserver per ChatView watches a 1px top sentinel; zero per-bubble observers; loading+hasMore guards serialize fetches
  - The initial-load sentinel guard was removed after review: the observer is created only after the scroll pin, so no race exists and a stale-guard bug (guard never cleared) would have blocked older-page loads
  - Day grouping (groupForRender) merges adjacent same-day pages into one section and suppresses repeat sender headers inside same-sender runs; MessageBubble consumes showSender as a prop
metrics:
  duration: ~45 min
  completed: 2026-09-09
  tasks: 2
  tests: 17 new (245 full suite green)
status: complete
---

# Phase 04 Plan 02: Virtualized Window + Grouped Bubbles Summary

Expanded the 04-01 tracer into the full browsing experience: paged-window virtualization with a hard 200-node budget (Simulated-100K test pins ≤3 rendered pages after 2500 prepends), scroll-anchored older-page loads via a single shared IntersectionObserver, day dividers with sender grouping and deterministic sender colors, a complete set of distinct empty states, and full test coverage — verified by 17 new Vitest tests, a 245-test full suite, typecheck, Biome, and a green static build.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| auto | Virtualized windowing plus scroll anchoring in ChatView | f42f1d8 | windows.ts, ChatView.svelte, windows.test.ts (+ DateSeparator.svelte, MessageBubble.svelte prop — see Deviations) |
| auto | Date dividers plus sender colors plus empty states plus phase-green suite | 5beddcc | ChatView.svelte (empty-chat state), formatting.test.ts |

## Key Decisions

- **trimToBudget as the enforced invariant:** `prependPage` delegates its `slice(-MAX_RENDERED_PAGES)` trim to a standalone `trimToBudget` helper; `assertRenderBudget` stays the test-enforced hard cap. The dropped oldest page lives on in IndexedDB — the recomputed `pages[0][0]` cursor makes it re-fetchable on scroll-up (pinned by a trim-then-refetch test).
- **ScrollHeight-delta anchoring (Pitfall 1):** `loadOlder` measures `scrollHeight` before the page read, prepends, `await tick()`s, then sets `scrollTop = prevTop + (scrollHeight − prevHeight)`. Never `scrollIntoView` on prepend; initial load pins `scrollTop = scrollHeight` after tick. Chronological DOM only — no `flex-col-reverse` (Pitfall 2).
- **One shared IntersectionObserver (Pitfall 6):** a 1px top sentinel inside the scroll container is observed by a single observer per ChatView, created only after the initial pin; `loading + hasMore` guards serialize fetches. The initial-load guard flag was cut during review (see Deviations #4).
- **Grouping stays in the pure layer:** `groupForRender` folds chronological pages into `DaySection[]` (one section per calendar day via `formatDayLabel`, adjacent same-day pages merged) and marks consecutive same-sender messages `showSender: false` after the first in each run; `isSameDay` backs day boundaries. ChatView renders `DateSeparator` per section; MessageBubble gates its colored header on `showSender`.
- **Three distinct empty states:** empty chat (`ChatView`: "This conversation has no messages."), unknown selection (`ChatView`: "Conversation not found."), import-free library (`ChatSidebar`: "No conversations yet — switch to Import…" plus the existing `+page.svelte` tab default of Import when no chats exist).
- **Dark pairing everywhere (Pitfall 7):** every new/existing color utility on chat surfaces carries a `dark:` sibling; `SENDER_PALETTE` entries were already self-paired in 04-01 and are now pinned by a dedicated formatting test.

## Verification Outcomes

- `bun run test -- src/lib/chat/__tests__/windows.test.ts` — 24 tests, all pass (cursor, prepend, budget invariant, trim-then-refetch, anchor math, day grouping, sender-run suppression, simulated-100K)
- `bun run test -- src/lib/chat/__tests__/formatting.test.ts` — 13 tests, all pass (incl. new palette dark-pairing)
- `bun run test` (full suite) — 23 files, 245 tests, all pass (228 pre-existing + 17 new)
- `bun run typecheck` — exit 0 (lib TS; .svelte covered by build per plan)
- `bunx biome check src/lib/chat src/lib/components src/routes` — clean, exit 0 (23 files)
- `bun run build` — exit 0; static `build/` output written
- `grep {@html}` over chat components, chat lib, and `+page.svelte` — zero render usage (comment mentions of the ban only); `flex-col-reverse` absent from ChatView; exactly one `new IntersectionObserver` in ChatView
- Manual browser pass (anchor stability on prepend, divider/sender rendering in both themes, empty-state reachability, `?chat=` deep link) deferred to operator; all automatable gates green

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DateSeparator needed by Task 1's ChatView, created in Task 1 commit**
- **Found during:** Task 1 implementation (ChatView renders `groupForRender` sections; the component did not exist yet)
- **Issue:** ChatView compiles only with `DateSeparator` present; the plan files it under Task 2
- **Fix:** Created `DateSeparator.svelte` (final form) in Task 1's commit — a plan-listed file, just moved earlier; Task 2's commit then needed no further change to it
- **Files modified:** src/lib/components/DateSeparator.svelte
- **Commit:** f42f1d8

**2. [Rule 1 - Bug] MessageBubble.showSender prop landed in Task 1 commit**
- **Found during:** Task 1 implementation (ChatView passes `showSender={group.showSender}`)
- **Issue:** The header-suppression prop is consumed by Task 1's grouping render; the plan lists MessageBubble under Task 2
- **Fix:** Added the `showSender` prop and gated the sender span in Task 1's commit; the rest of the 04-02 MessageBubble spec (senderColor label, formatClock right-aligned, MediaPlaceholder bodies, centered event rows, escaped interpolation) was already present from 04-01, so Task 2 needed no further MessageBubble change
- **Files modified:** src/lib/components/MessageBubble.svelte
- **Commit:** f42f1d8

**3. [Rule 1 - Bug] First windows-test draft had reversed prepend order and UTC-noon fixtures**
- **Found during:** Task 1 verify (4 failing tests: budget throw, trim cursor, isSameDay cases)
- **Issue:** Loop prepended pages chronologically (production prepends newer-first, i.e. oldest page first… reversed); `Date.UTC` timestamps broke `isSameDay` in non-UTC timezones; a "midnight" fixture was actually noon+15h
- **Fix:** Rewrote fixtures: prepend loop newest→oldest, local-time date constructors, direct 6-page state for the over-cap case; all 24 tests pass
- **Files modified:** src/lib/chat/__tests__/windows.test.ts
- **Commit:** f42f1d8

**4. [Rule 3 - Blocking] Initial-load sentinel guard removed (would have stuck true and blocked all older-page loads)**
- **Found during:** Task 1 review of ChatView's observer wiring
- **Issue:** The guard-clearing `$effect` runs during the render flush, before the async continuation set `loadOlderGuard = true` after `await tick()` — so the guard would never clear
- **Fix:** Removed the guard and its clearing effect. It was unnecessary: the observer is created only after the scroll pin, so the browser's initial intersection callback cannot race the pin; `loading + hasMore` in `loadOlder` already serialize fetches
- **Files modified:** src/lib/components/ChatView.svelte
- **Commit:** f42f1d8

Pre-existing repo modifications (`README.md`, `dave-dangerous/`, `lf2-web`, `.planning/STATE.md`) left untouched — out of scope.

## Known Stubs

None — all plan behaviors are wired. Explicitly deferred (not stubs): per-bubble measurement / pixel-exact virtualization (`@tanstack/virtual-core` stays deferred per RESEARCH.md), `date-fns` (Intl suffices), Playwright E2E and the manual browser verification pass.

## Threat Flags

None — all register mitigations applied and tested: T-04-07 escaped interpolation only, `grep {@html}` clean on all chat surfaces (comment mentions only); T-04-08 `loading + hasMore` guards serialize observer fetches, trim bounds memory, cursor recompute prevents duplicate re-read loops; T-04-09 `MAX_RENDERED_PAGES` trim enforced in `prependPage` via `trimToBudget` plus `assertRenderBudget` and the simulated-100K unit test (2500 prepends, ≤3 pages, under the 200 cap); T-04-10 cursors come only from repository-returned records, `getOlderPage`'s malformed-cursor-returns-empty guard reused verbatim; T-04-SC zero new dependencies, no installs ran.

## Self-Check: PASSED

- All 5 created/modified files exist on disk (verified via test/build runs against them)
- Commits f42f1d8 and 5beddcc exist in git log (plus this summary commit); post-commit status clean inside ragcgat/
- Scoped windows (24) and formatting (13) suites, full suite (245), typecheck, Biome (23 files), and static build all green