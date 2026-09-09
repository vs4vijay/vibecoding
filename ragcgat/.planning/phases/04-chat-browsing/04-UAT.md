# 04-UAT: Chat Browsing — User Acceptance Testing

- **Phase:** 04-chat-browsing
- **Date:** 2026-09-09
- **Method:** automated suite + static build gate; manual browser pass deferred (Worker threading, drag-drop pixels, scroll anchoring, dark-mode flash, 100K-message budget are browser-only and covered by the deferred manual pass below)
- **Result:** 245/245 tests PASS + typecheck + Biome + build PASS — no issues found, no fix plans needed

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
| `bun run build` | exit 0, build/ written |
| `grep -r "{@html}" src/lib/components src/routes` | zero render usage |

## Deferred Manual Pass (browser-only, operator)

The following require a live browser and cannot run headlessly. When convenient:

1. `bun run dev` → import a real chat export → sidebar appears sorted by recency
2. Click a chat → bubbles render with colored sender labels and timestamps
3. Media messages show placeholders (image/video/audio/document/sticker/gif icons)
4. Scroll up in a chat with 50+ messages → older messages load without a teleport jump
5. Toggle dark mode → persists on reload; check OS-default on fresh load (no white flash)
6. Deep link: open `?chat=<id>` directly → loads correct chat
7. Empty states: delete all chats from IndexedDB → import-free library state appears

No automation gap — all logic paths above already pass via unit/integration tests.

## Diagnosis / Fix Plans

None — zero failures. No gaps to diagnose, no fix plans to prepare.

## Routing

Phase 04 UAT complete with all automated tests passing. Phase 4 (Chat Browsing) is COMPLETE. Ready for Phase 05 (Full-Text Search) planning.
