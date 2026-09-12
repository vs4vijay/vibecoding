# 05-02 SUMMARY — Search UI + Result Navigation

**Phase:** 05-full-text-search / Plan 02 (wave 2, depends on 05-01)
**Status:** executed 2026-09-12 — all automated gates green + 8/8 manual browser checks pass on localhost:4647 (real IndexedDB)
**Requirements:** SRCH-01, SRCH-02, SRCH-03 (UI halves) — SC-1..SC-5 verified end-to-end

## What was built

- `src/lib/chat/selection.ts` — `parseMessageParam` / `serializeMessageParam` (?at= codec, mirrors the chat codec)
- `src/lib/components/SearchResults.svelte` (new) — count line, per-result chat name (global mode), sender color, clock, snippet with `<mark>` element highlights; escaped interpolation only, no `{@html}`
- `src/lib/components/SearchBar.svelte` (new) — 300 ms debounce, monotonic request-id guard (RISK-2), limit-8 queries, Esc / blur / click-outside close, `role=listbox` results
- `src/routes/+page.svelte` — header `<SearchBar mode="global">`, `openChatAt` (?chat + ?at, tab='browse'), `selectedMsgId` derived, `highlightId` + `onselectMessage` passed to ChatView; `openChat` strips a stale `?at=` on same-chat clicks (RISK-3)
- `src/lib/components/ChatView.svelte` — `highlightId` / `onselectMessage` props; seek branch via `getWindowAt(chatId, highlightId, PAGE_SIZE*2)` + `seedWindow`, `scrollIntoView({block:'start'})` on the `data-msg-id` row, transient flash state; null → newest-open fallback with `console.warn`; in-chat `<SearchBar mode="chat">` under the header
- `src/lib/components/MessageBubble.svelte` — `data-msg-id` on both row kinds, `highlight` prop (ring + flash class)
- `src/app.css` — one-shot `search-flash` keyframes with dark variant
- `src/lib/chat/__tests__/selection.test.ts` — 5 new `parseMessageParam` cases (round-trip, rejects, bounds)

## Defects caught by gates during execution (all fixed)

1. **Invalid `{@html}` in SearchResults draft** — svelte-check parse error + own XSS rule violation; rewrote to element-based `<mark>` rendering via `splitByTerms` segments.
2. **Dropped `<script lang="ts">` tag** in +page.svelte after the import-block repair — svelte-check `js_parse_error` at a misleading line; restored.
3. **Biome `noNonNullAssertion` / formatting** across new files — guards + `--write`.
4. Missing `MessageRecord` import in search.ts (typecheck + svelte-check).

## Gates

- `bun run test` — 270/270 (265 prior + 5 codec)
- `bun run typecheck` — 0
- `bun run check` (svelte-check) — 0 errors, 0 warnings (407 files)
- `bunx biome check src` — clean (67 files)
- `bun run build` — exit 0, static output written

## Browser evidence

Full 8-check pass documented in `05-UAT.md` (same session, localhost:4647, Road Trip fixture re-imported after wiping a poisoned DB — see UAT notes on the `[object Object]` delivery failure, a harness artifact, not an app bug).
