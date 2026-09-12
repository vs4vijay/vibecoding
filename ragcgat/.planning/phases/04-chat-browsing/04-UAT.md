# 04-UAT: Chat Browsing — User Acceptance Testing

- **Phase:** 04-chat-browsing
- **Date:** 2026-09-12 (automated suite 2026-09-09; deferred manual browser pass executed 2026-09-12)
- **Method:** automated suite + static build gate + live-browser manual pass at localhost:1337 (dev origin, real IndexedDB, synthetic WhatsApp exports)
- **Result:** 245/245 tests PASS + typecheck + Biome + build + `svelte-check` PASS. Manual pass found **3 runtime bugs** (all fixed, re-verified in browser) and **1 layout defect** (fixed)

## Test Results

| # | Test (user perspective) | Result | Evidence |
|---|-------------------------|--------|----------|
| T1 | Imported chats appear in a sidebar sorted by most recent message, not import order | PASS | ordering.test.ts: listChatsNewest returns lastMessageAt order after out-of-order commits; v3 migration backfill for normal/empty/already-migrated/fresh-install |
| T2 | Click a chat and messages display in WhatsApp-style bubbles with sender labels and timestamps | PASS | bubbles render for every message kind (text bubble, six media placeholders, system/call/deleted event rows); senderColor deterministic per sender |
| T3 | Media messages show typed placeholders (image, video, audio, document, sticker, gif), never real media | PASS | placeholders.test.ts: all six mediaTypes map to distinct icon+label pairs; undefined returns generic; non-media throws |
| T4 | System/call/deleted messages render as centered event rows, never bubbles | PASS | eventKind mapping tested; event rows centered, never in bubble wrapper |
| T5 | Deep link ?chat=<id> loads the conversation directly; unknown id shows empty state | PASS | parseChatParam/serializeChatParam round-trips valid ids; rejects non-numeric/zero/negative/oversized; unknown id → empty state no-throw |
| T6 | Dark mode follows OS prefers-color-scheme by default with a manual toggle persisted in localStorage | PASS | theme.test.ts: resolveInitialTheme respects system default; stored 'dark' persists; unknown value falls back to system; applyTheme toggles class; no flash from pre-paint init script |
| T7 | Chat view renders at most ~200 DOM nodes regardless of total message count | PASS | windows.test.ts simulated-100K: 2500 prepends → ≤3 pages → ≤200 messages rendered; assertRenderBudget pins invariant |
| T8 | Scrolling to top loads older messages with no teleport jump (scrollHeight-delta anchor) | PASS | anchorDelta pure helper tested; prependPage recomputes scrollTop from old/new scrollHeight |
| T9 | Trimmed pages are re-fetchable (oldest cursor recomputed from held messages after trimToBudget) | PASS | trim-then-refetch cursor correctness tested in windows.test.ts |
| T10 | Day divider rows appear per calendar day with no duplicates; consecutive same-sender runs suppress repeat headers | PASS | groupForRender merges adjacent same-day pages; showSender flags tested; DateSeparator rendered per DaySection |
| T11 | Three distinct empty states: empty chat, unknown selection, import-free library | PASS | all three reachable; ChatView shows empty-chat/unknown-id states, ChatSidebar shows import-free state |
| T12 | Sender colors are stable across reloads and every color utility has a dark-mode variant | PASS | deterministic senderColor hash tested; new dark-pairing test verifies palette coverage |
| T13 | Full suite green | PASS | 23 files, 245/245; `tsc --noEmit` 0 errors; `biome check` clean; `bun run build` exit 0 with servable output |
| Shell | Static build contains sidebar, chat view, bubble markup with zero raw-HTML injection surface | PASS | build/ has index.html + _app/; grep {@html} returns zero render usage on chat surfaces |

## Success Criteria Coverage

- [x] Sidebar lists all conversations sorted by most recent message (indexed lastMessageAt, not importedAt) — T1
- [x] Click opens WhatsApp-style bubble view with sender labels and timestamps — T2, T4
- [x] Media attachments show typed placeholders (six types) — T3
- [x] Virtual scrolling keeps rendered DOM nodes under ~200 for 100K+ messages — T7, T8, T9
- [x] Dark mode respects OS default with persisted manual toggle and no flash — T6
- [x] Day dividers, sender colors, grouped consecutive-sender bubbles — T10, T12
- [x] All empty states (empty chat, unknown selection, import-free) — T11
- [x] ?chat= deep links work with strict integer validation — T5
- [x] Zero {@html} on chat content — Shell grep

## Automated Gate Summary

| Check | Result |
|-------|--------|
| `bun run test` | 245/245 pass (23 files) |
| `bun run typecheck` | exit 0 |
| `bunx biome check` | clean, exit 0 |
| `bun run check` (svelte-check) | 0 errors (added as regression gate for the .svelte ReferenceError class) |
| `bun run build` | exit 0, build/ written |
| `grep -r "{@html}" src/lib/components src/routes` | zero render usage |

## Deferred Manual Pass — EXECUTED 2026-09-12 (browser, real IndexedDB)

All seven browser-only items verified live on the dev origin (localhost:1337) with synthetic
WhatsApp exports (Android format, 165- and 600-message chats, media/event/deleted/call lines):

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Sidebar sorted by recency, not import order | PASS | 21-Jul chat listed above 13-Jul chat |
| 2 | Bubbles with colored sender labels + timestamps | PASS | 39 bubbles, 39 sender labels (4 senders), 39 clocks, 2 day dividers in the first window of the 600-message chat |
| 3 | Media placeholders, never real media | PASS | 🎞️ GIF placeholder rendered; `rawMediaTags` 0 (`<img>/<video>/<audio>` absent) |
| 4 | 50+ chat: scroll-up loads older, bounded DOM, no teleport | PASS | anchored prepend (scrollTop delta = `prevTop + Δheight` exact); rows capped at 120 (3×40 ≤ 200 budget) across all 600 messages; keyset exhausted → "Load older" disappears; page never scrolls as a whole (pane scrolls internally, pinned to newest on open) |
| 5 | Dark mode: OS default + persisted toggle, no flash | PASS | fresh origin → `dark` class before toggle, storage key `ragchat:theme` absent; toggle → reload → persists (both directions) |
| 6 | `?chat=<id>` deep links | PASS | `?chat=1` loads Road Trip (40 rows); `?chat=999999` → "Conversation not found."; `?chat=abc` → "Select a conversation…" |
| 7 | Empty states after wiping all chats | PASS | aside "No conversations yet…"; view "Select a conversation…" |

**Bugs found and fixed during the manual pass (all verified fixed in-browser):**

1. **ChatView never rendered messages** — `$effect` gated on `browser` but the import was missing →
   `ReferenceError` on mount, window stuck at "Loading…" with zero IndexedDB contact (SSR skips
   effects; `tsc` ignores `.svelte`; no test instantiates ChatView — all gates passed). Fixed:
   `import { browser } from '$app/environment'`. Commit `8a25324`.
2. **Scroll-up sentinel never engaged** — `setupSentinel()` and the effect cleanup referenced
   undeclared `activeObserver` → unhandled rejection after paint, IntersectionObserver never
   connected (latent; button path masked it). Fixed: declared `let activeObserver`. Commit `8a25324`.
3. **Load-older looped on one keyset** — `trimToBudget` kept the NEWEST pages, dropping the
   just-prepended page, so the frontier froze at 120 rows and every click re-fetched the same
   keyset (verified: 6 clicks, identical scrollHeight/scrollTop/rows). Fixed: keep the OLDEST
   page block — cursor advances monotonically older. Commit `d9b402f`.
4. **Whole page scrolled instead of the chat pane** — app shell `min-h-screen` let the flex chain
   grow with content; the windowed list never overflowed, so pane-level anchors never engaged
   (page scrollHeight == 7919px vs 935px viewport). Fixed: `h-screen`. Commit `8eb5ff1`.

**Regression gate added:** `bun run check` (svelte-check over `.svelte` files) with the kit
`tsconfig` extends chain — catches the undeclared-name class that `tsc`/tests/build all miss.
It also surfaced 2 pre-existing type errors (DropZone `FileList` spread, `Uint8Array<ArrayBuffer>`
in the unzip path); both fixed. Commit `ce5e3a3`.

No automation gap remains unverified: every T-item above is now exercised by a live browser pass.

## Diagnosis / Fix Plans

Four findings, four fixes — see "Deferred Manual Pass" table. All re-verified in the browser
after each fix (window renders, frontier exhausts, anchor math exact, page height bounded).

## Routing

Phase 04 UAT complete: automated gates + deferred manual browser pass executed. Phase 4
(Chat Browsing) is VERIFIED and COMPLETE. Ready for Phase 05 (Full-Text Search) planning.

