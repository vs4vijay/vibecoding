# 05-UAT — Full-Text Search browser verification

**Date:** 2026-09-12 · **Origin:** http://localhost:4647 (dev server, `bun run dev`) · **DB:** fresh IndexedDB (wiped pre-pass)
**Fixture:** `/tmp/Road Trip Plans.txt` (165 messages, 2 senders) — preview confirmed `Messages:165, New:165, Skipped:0` before confirm
**Result:** 8/8 PASS

## Setup note (harness artifact, not an app bug)

The first drop delivered `[object Object]` (1 line) instead of the fixture: the outer eval `read()` helper returned an object, and `JSON.stringify` of it was never the file text. The app faithfully imported what it received (1 preamble-only message, `captured 1 lines`). Verified the parser yields 165 locally, wiped via `indexedDB.deleteDatabase('ragchat')`, re-imported with a `Bun.file(...).text()` payload (verified 11,329 chars in-page). Lesson: always capture the preview count before confirming.

## Checks

1. **Header search (SC-1)** — PASS. Typed `spare` in "Search all chats": dropdown opened.
2. **Result content (SC-3)** — PASS. `5 results for "spare"`, 5 rows, 6 `<mark>` nodes (one row double-matched), each row: chat name + sender + clock time + snippet.
3. **Result count (SC-5)** — PASS. Exact count line rendered (`5 results for "spare"`; `8 results for "lake"` in-chat).
4. **Click-to-navigate (SC-4)** — PASS. Clicked 3rd `spare` result → `?chat=1&at=75`, target row at scroller top (delta 0px), flash + ring present, 80 rows in pane (2×PAGE_SIZE seed), scrollTop mid-conversation (not pinned).
5. **Deep-link reload (SC-4)** — PASS. Reload of `?chat=1&at=75` re-seeks to delta 0 with flash.
6. **In-chat search (SC-2)** — PASS. "Search this chat" → `lake` → `8 results for "lake"`, sender + time, no chat names, 8 marks.
7. **Unknown ?at= fallback** — PASS. `?chat=1&at=999999` → newest-open pinned to bottom, 40 rows, no error surface.
8. **Dropdown close** — PASS. Esc closes; blur closes.
9. **RISK-3 fix (stale ?at=)** — PASS. Same-chat sidebar click with `?at=999999` in URL → `?chat=1` (param stripped), newest-open.
10. **Theme** — PASS (smoke). Toggle dark→light persisted `ragchat:theme='light'` across reload; search UI unaffected.

## Harness notes for future passes

- `tab.run` executes outside the page in this harness — use `tab.evaluate` with sync IIFE strings; async via flag-polling.
- Bare `return` at evaluate top level throws — always wrap in `(() => { ... })()`.
- Element typing via `tab.id(n).type(...)`; `tab.type` needs different params.
- Re-shim rAF on every fresh page load; locate the chat scroller via `[data-msg]` rows (first `.overflow-y-auto` is the sidebar).
