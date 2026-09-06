# Phase 04: Chat Browsing - Research

**Researched:** 2026-09-06
**Domain:** Client-side chat browsing UI — conversation sidebar, WhatsApp-style bubble layout, media placeholders, paged windowing over Dexie keyset pagination, Tailwind v4 dark mode, adapter-static SPA routing
**Confidence:** HIGH (Dexie query strategy, keyset pagination consumption, routing, XSS posture), MEDIUM (hand-rolled windowing estimates, Tailwind v4 dark-variant syntax), LOW (none — no LOW items; all gaps are flagged as Open Questions instead)

## Summary

Phase 04 turns imported data into a browsable WhatsApp-style archive. All data primitives already exist: `ChatRepository.listChatsNewest` / `findChatByName` / `saveChat`, `MessageRepository.getLatestWindow` / `getOlderPage` (keyset pagination on the `[chatId+timestamp]` compound index), `commitImport` in `src/lib/import/commit.ts`, and parser `Message` types (`sender/timestamp/text/type/mediaType`) [VERIFIED: src/lib/db/repositories.ts, src/lib/db/db.ts, src/lib/import/commit.ts read 2026-09-06]. What is missing is entirely presentational + query-layer glue: (a) sidebar ordering by **most recent message** (current `listChatsNewest` sorts by `importedAt`, which is wrong per success criterion #1 — a re-imported old chat would sort above a recently-messaged chat); (b) a reactive query layer on Dexie `liveQuery()`; (c) bubble UI + sender colors + timestamp formatting; (d) typed media placeholders; (e) a DOM-node cap via paged windowing; (f) dark mode with system default + manual toggle; (g) a routing decision for where the chat UI lives.

**Primary recommendation:** Zero new dependencies. Denormalize `lastMessageAt` onto `ChatRecord` via a new Dexie `version(3)` migration (index it, backfill max-timestamp-per-chat, update it in `commitImport`), order the sidebar by `lastMessageAt` under `liveQuery()`, extend `+page.svelte` into a master-detail view with chat selection synced to the `?chat=<id>` query param (no new route files — avoids adapter-static prerender hazards), and cap DOM nodes with **paged windowing** (40-msg pages via the existing `getLatestWindow`/`getOlderPage`, max ~3 rendered pages / ~120–150 nodes, scroll-anchored prepend on scroll-to-top) built from pure testable helpers in a new `src/lib/chat/` module. Timestamps via stdlib `Intl` (no `date-fns` install); dark mode via Tailwind v4 `@custom-variant` + `.dark` class + `localStorage` + `matchMedia`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BROW-01 | Sidebar listing all imported conversations by group/contact name | Ordering strategy §Architecture Patterns Pattern 1 (`lastMessageAt`); reactive sidebar via `liveQuery()` Pattern 2 |
| BROW-02 | Click conversation → chat-style bubble UI | Master-detail layout Pattern 6 (extend `+page.svelte`, `?chat=` selection); bubble component Pattern 4 |
| BROW-03 | Sender name, timestamp, WhatsApp-style layout | Sender-color hash + `Intl` timestamp helpers Pattern 4; date-separator/day grouping helper |
| BROW-04 | Media attachments show as placeholders (e.g. "📷 Image" icon) | `mediaType → placeholder` mapping table Pattern 5; no media rendering, ever |
| SC-1 | Sidebar sorted by most recent message | Pattern 1 (denormalized `lastMessageAt`, indexed, migrated) — the only correct option; alternatives rejected with rationale |
| SC-4 | Rendered DOM nodes under ~200 regardless of total (100K+ chats) | Paged windowing Pattern 3 (40/page, ≤3 rendered pages, scroll anchoring); pitfalls §Pitfall 1, 6 |
| SC-5 | Dark mode respects `prefers-color-scheme` by default with manual toggle | Dark-mode Pattern 7 (v4 `@custom-variant`, inline init script against FOUC, `localStorage` key) |

No CONTEXT.md exists for this phase (phase directory is new) — there are no locked discuss-phase decisions to honor; the success criteria above (ROADMAP.md Phase 4 §Success Criteria) [VERIFIED: .planning/ROADMAP.md read 2026-09-06] are the binding constraints.

## Project Constraints (from AGENTS.md)

- **Use `bun` instead of `npm`** — all installs/run commands use `bun add`, `bun run`, `bunx`. (Never `npm install`.) [VERIFIED: AGENTS.md]
- **TypeScript strict, ES2022 target** (`strict: true`, `lib: ["ES2022","DOM"]`, `moduleResolution: bundler`) [VERIFIED: tsconfig.json read 2026-09-06]. Note: `WebWorker` lib is NOT in `lib` (relevant only if new workers are added — none are needed this phase).
- **Lint/format with Biome** (`bun run lint` = `biome check`, lineWidth 120, single quotes) [VERIFIED: package.json, biome.json] — all new `src/lib/chat/` + component code must pass.
- **Tests with Vitest 3.x** (`bun run test` = `vitest run`, `setupFiles: src/lib/db/__tests__/setup.ts` with `fake-indexeddb/auto`) [VERIFIED: vite.config.ts + setup.ts] — Phase 04 tests extend this; **no Playwright** (unit/integration only; DOM assertions via pure helpers, not a browser).
- **STACK.md blessed path**: SvelteKit 2.x (Svelte 5 runes) + Dexie 4.x + Tailwind 4.x + Vite + `adapter-static` + Vitest + Biome + `bun` [VERIFIED: AGENTS.md STACK.md]. This research stays on it; zero new deps recommended.
- Installed ground truth [VERIFIED: package.json read 2026-09-06]: `svelte ^5.57.0`, `@sveltejs/kit ^2.70.3`, `@sveltejs/adapter-static ^3.0.10`, `dexie 4.4.5` (pinned), `fflate 0.8.3`, `tailwindcss ^4.3.3` + `@tailwindcss/vite ^4.3.3`, `vitest ^3.0.0`, `fake-indexeddb 6.2.5`. `date-fns` is **not** installed (STACK.md lists it as supporting, but stdlib `Intl` covers this phase — no install).
- Root repo convention (parent AGENTS.md): web games follow `docs/GAMES.md` — not applicable to RagChat; ignore.
- `commit_docs: true` [VERIFIED: .planning/config.json] — RESEARCH.md/PLAN.md commits go through the commit flow.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sidebar list, bubble UI, placeholders, dark toggle, scroll container | Browser / Client (Svelte components) | — | Fully client-side app; no server exists or is wanted |
| Sidebar ordering (`lastMessageAt`) | Browser / Client (Dexie index + migration) | — | Ordering is a storage-index concern; UI just subscribes |
| Message windows (latest + older pages) | Browser / Client (existing `MessageRepository` keyset API) | — | Compound-index cursor pagination already proven in Phase 2; UI consumes, never reimplements |
| Reactive updates on import/commit | Browser / Client (`liveQuery()` subscriptions) | — | Dexie's observable query layer; no manual event bus |
| Timestamp/sender formatting | Browser / Client (pure `src/lib/chat/` helpers) | — | Deterministic, timezone-local, unit-testable without DOM |
| Theme persistence | Browser / Client (`localStorage` + `matchMedia`) | — | Per-device preference; never touches IndexedDB |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `svelte` + `@sveltejs/kit` (installed) | `5.57.0` / `2.70.3` range [VERIFIED: package.json + `bunx npm view` 2026-09-06] | Master-detail UI, runes state (`$state`/`$derived`/`$effect`), query-param selection | Already the app framework; Phase 3 components (`DropZone`, `PreviewCard`, `ProgressBar`) establish the thin-runes-component pattern to copy |
| `dexie` (installed, pinned) | `4.4.5` (published 2026-08-14) [VERIFIED: npm registry via `bunx npm view dexie version/time`] | Indexed `lastMessageAt` ordering, keyset reads, `liveQuery()` reactivity | No alternative; the entire storage layer is Dexie 4.x with versioned migrations |
| `tailwindcss` + `@tailwindcss/vite` (installed) | `4.3.3` [VERIFIED: package.json] | Bubble layout, sidebar, dark-mode variants | v4 CSS-first config (`src/app.css` currently one-line `@import "tailwindcss"`) [VERIFIED: src/app.css]; dark mode needs one `@custom-variant` line (Pattern 7) |
| `vite` (via SvelteKit) | `8.2.2` range [VERIFIED: Phase 03 research `bunx npm view`] | Dev/bundler; no config change needed | No worker, no new entry, no plugin this phase |
| `@sveltejs/adapter-static` (installed) | `3.0.10` [VERIFIED: package.json] | Static build with `fallback: '200.html'`, `strict: true` [VERIFIED: svelte.config.js] | `fallback` gives SPA behavior at runtime; combined with root `prerender = true` [VERIFIED: src/routes/+layout.ts] it constrains the routing decision (Pattern 6) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fake-indexeddb` (installed) | `6.2.5` [VERIFIED: package.json] | Repository + migration integration tests under Vitest | Already wired as global setup; new `lastMessageAt` migration + ordering tests reuse it |
| Stdlib `Intl.DateTimeFormat` | ES2022 built-in | "Yesterday", "12:30 PM", "14 Jun 2026" style labels + day separators | Always — replaces `date-fns` for this phase (formatting surface is 3–4 labels; `date-fns` adds a dependency for no capability gain) |
| Stdlib `IntersectionObserver` | DOM built-in | Scroll-to-top sentinel to trigger `getOlderPage` loads | Always — the prepend trigger for paged windowing (Pattern 3) |
| Stdlib `matchMedia('(prefers-color-scheme: dark)')` | DOM built-in | System-theme default for dark mode | Always — Pattern 7 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled paged windowing | `svelte-virtual-list@3.0.1` | **Reject.** Last published 2021-06-22, untouched since (modified 2022-05) [VERIFIED: npm registry `bunx npm view svelte-virtual-list time` 2026-09-06]; pre-Svelte-5 API, no maintenance. Pixel virtualization is also unnecessary — pages + caps satisfy the <200-node criterion. |
| Hand-rolled paged windowing | `@tanstack/virtual-core@3.17.8` (active, 2026-08-18) [VERIFIED: npm registry] | **Reject for MVP.** Legitimate, maintained library (TanStack monorepo) [CITED: github.com/TanStack/virtual], but it buys pixel-exact virtualization of variable-height bubbles — which requires measurement plumbing (`measureElement`, scroll-offset correction) that exceeds the success criterion. Leaves door open: adopt later only if 100K-chat scroll profiling shows jank. |
| `lastMessageAt` denormalization | Per-chat `max(timestamp)` query at sidebar render | **Reject.** N queries for N chats (N+1 reads on every sidebar paint); `liveQuery` cannot efficiently observe N derived maxes. Only acceptable as the one-time backfill *inside* the migration, never as the read path. |
| `lastMessageAt` denormalization | Compound-index trickery (e.g. order chats by join against messages) | **Reject.** Dexie/IndexedDB has no server-side join; any client join is a full-table scan (Pitfall 4). Denormalization is the standard IndexedDB pattern for "order parents by child aggregate". |
| `Intl` formatting | `date-fns@4.4.0` (latest stable 2026-05-29) [VERIFIED: npm registry] | **Defer.** STACK.md-blessed and tree-shakeable, but every label needed here (`HH:MM`, `Yesterday`, `D MMM YYYY`, day-divider) is ~5 lines of `Intl` + comparison. If Phase 5/calendar nav wants relative-time complexity, install then with a `checkpoint:human-verify`. |
| Extend `+page.svelte` + `?chat=` | New `/chat/[id]` route | **Reject for MVP.** Root layout sets `prerender = true` with `adapter-static strict:true`; dynamic `[id]` routes need per-page prerender opt-outs and entry generation for a dataset that only exists in the user's IndexedDB at runtime (nothing to prerender). Query-param selection keeps one prerenderable shell + full deep-linkability. |

**Installation:**
```bash
# No installs. Phase 04 is zero-new-deps by design.
bun install   # no-op sanity check only
```

**Version verification:** `bunx npm view` 2026-09-06: `dexie@4.4.5` (time 2026-08-14T19:53:41Z), `date-fns@4.4.0` (checked, NOT installed — intentionally unused), `svelte-virtual-list@3.0.1` (time 2021-06-22 — stale, rejected), `@tanstack/virtual-core@3.17.8` (time 2026-08-18 — active, deferred). (`gsd-tools query package-legitimacy check` could not run — binary not on PATH in this environment — so the audit below is signal-based from registry metadata; planner must still gate any future virtualization-lib install behind `checkpoint:human-verify`.)

## Package Legitimacy Audit

> No new packages are recommended. This audit exists to record the candidates that were evaluated and rejected/deferred, so a future planner does not re-litigate them without the checkpoint.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| *(none — zero-new-deps)* | — | — | — | — | — | Approved (no install step) |
| `svelte-virtual-list` | npm | 5+ yrs (3.0.1, Jun 2021; unmaintained) | low/stale | github mirror (`40000519/virtual-list.git` per registry `repository.url` — suspicious fork path, not the original author's repo) | SUS (stale + odd repo pointer) | REMOVED — do not install; hand-rolled windowing instead |
| `@tanstack/virtual-core` | npm | active (3.17.8, Aug 2026) | high (TanStack ecosystem) | github.com/TanStack/virtual | OK (signal-based; seam unavailable) | DEFERRED — planner may revisit only with `checkpoint:human-verify` + profiling evidence |
| `date-fns` | npm | active (4.4.0, May 2026) | very high | github.com/date-fns/date-fns | OK (signal-based; seam unavailable) | DEFERRED — install only if formatting needs outgrow `Intl`, with `checkpoint:human-verify` |

**Packages removed due to SLOP verdict:** none (no hallucinated names proposed).
**Packages flagged as suspicious (SUS):** `svelte-virtual-list` — stale + anomalous registry repo pointer; planner must NOT add it without human verification, and current recommendation is to never add it.

*Seam note: `gsd-tools` binary was not on PATH (`which gsd-tools` → not found) and Context7/MCP docs were unavailable (all search flags false in `.planning/config.json`), so legitimacy verdicts above are registry-metadata signals only [ASSUMED where stated], not seam verdicts. Confidence tiers below reflect this honestly.*

## Architecture Patterns

### System Architecture Diagram

```
WhatsApp .txt export ──(Phase 3: parse→preview→commit)──▶ IndexedDB (Dexie)
                                                            ├─ chats: ++id, name, importedAt, lastMessageAt◀── NEW v3 index
                                                            └─ messages: [chatId+timestamp], *terms, &dedupHash

User opens app (static shell, prerendered +page)
        │
        ▼
┌─ Sidebar ──────────────────────────────┐  ┌─ ChatView ───────────────────────────┐
│ liveQuery(chats.orderBy('lastMessageAt') │  │ ?chat=<id> selection                 │
│   .reverse()) ──▶ ChatList (name,       │  │   │                                   │
│   preview snippet, relative time)       │──▶│ liveQuery(getLatestWindow) initial  │
│ click ──▶ goto('?chat=<id>')            │  │   40 msgs (newest-first, flipped      │
└─────────────────────────────────────────┘  │   to chronological for render)       │
                                             │   │                                   │
                                             │   ▼                                   │
                                             │ IntersectionObserver top sentinel     │
                                             │ ──▶ getOlderPage(cursor) ──▶ prepend │
                                             │ ──▶ anchor scroll (scrollHeight Δ)   │
                                             │ ──▶ trim rendered pages to ≤3        │
                                             │                                      │
                                             │ Bubble ← senderColor(sender)         │
                                             │       ← formatTime/formatDay (Intl)  │
                                             │       ← mediaPlaceholder(mediaType)  │
                                             └──────────────────────────────────────┘
Theme: <html class="dark"> ← themeStore (localStorage → matchMedia fallback) ──▶ Tailwind dark: variants
```

File-to-implementation mapping belongs in Proposed Project Structure below, not in the diagram.

### Proposed Project Structure

```
src/
├── routes/
│   └── +page.svelte            # EXTEND: master-detail shell (Sidebar + ChatView + empty-state);
│                               # selection state synced to ?chat=<id> via goto/page store
├── lib/chat/                   # NEW MODULE (pure + query glue; all unit-testable)
│   ├── ordering.ts             # sidebar view-model: ChatSummary {id,name,lastMessageAt,messageCount,
│                               #   snippet,snippetSender} builders + sort comparator (pure; tests w/o Dexie)
│   ├── windows.ts              # paged-window state machine: WindowState {pages,selectedId},
│                               # prependPage(), trimToBudget(), cursorOf(), slice helpers (pure)
│   ├── formatting.ts           # formatClock(ts), formatDayLabel(ts), formatSidebarTime(ts),
│                               # senderColor(sender) (pure Intl + hash; no date-fns)
│   ├── placeholders.ts         # mediaPlaceholder(type, mediaType) → {icon,label} (pure map)
│   ├── queries.ts              # liveQuery wrappers: observeChats(cb), observeLatest(chatId,cb)
│                               # (thin, browser-guarded; tested via fake-indexeddb integration)
│   └── theme.ts                # resolveInitialTheme(), applyTheme(), theme toggle store (pure core +
│                               # tiny DOM adapter; FOUC script lives in app.html, not here)
├── lib/components/
│   ├── ChatSidebar.svelte      # NEW: list + search-less filter not needed; click → select
│   ├── ChatView.svelte         # NEW: scroll container + top sentinel + page render + bottom anchor
│   ├── MessageBubble.svelte    # NEW: bubble chrome (sender/color/time/tick), delegates body
│   ├── MediaPlaceholder.svelte # NEW: typed icon + label from placeholders.ts (no <img>/<video>/<audio>)
│   ├── DateSeparator.svelte    # NEW: day divider row (optional; may fold into ChatView)
│   ├── ThemeToggle.svelte      # NEW: manual toggle bound to theme store
│   └── (existing) DropZone / PreviewCard / ProgressBar — untouched; import UI coexists
│       in the same +page (tabs or sequential: import view ↔ browse view; planner decides,
│       recommend simple top-level tab/nav since +page currently IS the import page)
├── lib/db/
│   ├── db.ts                   # MODIFY: chats store adds `lastMessageAt` index (v3)
│   ├── migrations.ts           # MODIFY: applyMigrations gains version(3) + async backfill
│   └── repositories.ts         # MODIFY: saveChat accepts lastMessageAt; listChatsNewest orders
│                               # by lastMessageAt; commit.ts sets lastMessageAt = max(parsed ts)
├── app.css                     # MODIFY: +1 line @custom-variant for dark mode
└── app.html                    # MODIFY: +6-line inline theme-init script (FOUC guard)
```

### Pattern 1: Chat ordering via denormalized `lastMessageAt` (the #1 success-criterion fix)

**What:** Add `lastMessageAt: number` to `ChatRecord`, index it, backfill it, maintain it on every commit, and order the sidebar by it. This is the standard IndexedDB "order parents by child aggregate" pattern — there is no join, so the aggregate must live on the parent row [ASSUMED — standard Dexie/IndexedDB practice, consistent with Dexie docs on compound indexes and `orderBy` requiring an index; verify against https://dexie.org/docs/Table/orderBy() during planning].
**When to use:** Always for this phase — success criterion #1 cannot be met any other efficient way.

```typescript
// db.ts — version(3) RESTATES the full schema (Dexie versions are cumulative declarations):
// chats: '++id, name, importedAt, lastMessageAt',
// messages: '++id, chatId, timestamp, [chatId+timestamp], *terms, &dedupHash, sender' (carry v2 forward)
export interface ChatRecord {
  id?: number;
  name: string;
  importedAt: number;
  lastMessageAt: number; // max(messages.timestamp) — maintained by commitImport
  messageCount: number;
  participants: string[];
}
```

```typescript
// migrations.ts — version(3): indexed backfill. Upgrade runs in a transaction;
// per-chat max must be computed with plain gets (no liveQuery inside upgrade).
db.version(3)
  .stores({ chats: '++id, name, importedAt, lastMessageAt' })
  .upgrade(async (tx) => {
    const chats = tx.table<ChatRecord>('chats');
    const msgs = tx.table<MessageRecord>('messages');
    await chats.toCollection().modify(async (chat) => {
      if (typeof chat.lastMessageAt !== 'number') {
        const latest = await msgs
          .where('[chatId+timestamp]')
          .between([chat.id as number, Number.NEGATIVE_INFINITY], [chat.id as number, Number.POSITIVE_INFINITY])
          .reverse().limit(1).first();
        chat.lastMessageAt = latest?.timestamp ?? chat.importedAt;
      }
    });
  });
```

```typescript
// repositories.ts — the fixed query (indexed reverse, limit-bounded, never a scan):
async listChatsNewest(limit = 100): Promise<ChatRecord[]> {
  return this.db.chats.orderBy('lastMessageAt').reverse().limit(limit).toArray();
}
// commit.ts — after bulkSave: lastMessageAt = max(parsed timestamps) (or max(existing, new)
// on upsert-merge). New chats: set at saveChat time. Existing chats: update alongside messageCount.
```

**Snippet preview per row:** fetch the single newest message per visible chat lazily (`getLatestWindow(chatId, 1)` for the ~100 listed ids is 100 indexed point-reads — acceptable) or, better, store `lastSnippet`/`lastSender` denormalized alongside `lastMessageAt` at commit time. Recommend denormalizing the snippet too (same write, zero read fan-out); planner decides (cheap either way at ≤100 chats).

### Pattern 2: Reactive query layer with `liveQuery()` (browser-guarded)

**What:** Sidebar and active chat subscribe to Dexie observable queries; any `commitImport` (even from another tab context or a later import) repaints automatically. `liveQuery` is Dexie's documented reactivity primitive [CITED: https://dexie.org/docs/liveQuery() — API shape `liveQuery(querier).subscribe({next, error})`; exact import path `dexie` package root] [ASSUMED details — seam/docs unavailable; confirm import + Svelte-5 interop during Wave 0 spike].
**When to use:** Sidebar list (always); active-chat latest window (always). Older-page prepends stay imperative (not live) — live-updating history mid-scroll causes jump (Pitfall 1).

```typescript
// src/lib/chat/queries.ts
import { browser } from '$app/environment';
import { liveQuery } from 'dexie';
import { db } from '$lib/db/db';

export function observeChats(onNext: (rows: ChatRecord[]) => void): () => void {
  if (!browser) return () => {};
  const sub = liveQuery(() => db.chats.orderBy('lastMessageAt').reverse().limit(100).toArray())
    .subscribe({ next: onNext, error: (e) => console.error('observeChats', e) });
  return () => sub.unsubscribe();
}
// In component: let chats = $state<ChatRecord[]>([]);
// $effect(() => observeChats((rows) => (chats = rows)));  // cleanup returned automatically
```

Rules: subscribe only inside `$effect`/`onMount` behind the `browser` guard (prerender has no IndexedDB — Pitfall 3); one subscription per view; always unsubscribe (the `$effect` return); never `await liveQuery` (it is not a promise).

### Pattern 3: Paged windowing over keyset pagination (the <200-node guarantee)

**What:** Render budget, not pixel virtualization. Pages of 40 messages; initial load = newest page via `getLatestWindow(chatId, 40)`; scroll-to-top sentinel (`IntersectionObserver` on a 1px top guard) loads the next older page via `getOlderPage(chatId, cursor, 40)` and **prepends with scroll anchoring**; rendered pages trimmed to the newest 3 (≈120 message nodes + separators ≈ <150 DOM message rows, hard cap 200). Consumes the Phase-2 keyset API exactly as designed (reverse-chronological load, `(timestamp,id)` cursor, same-ms sibling tiebreak in JS) [VERIFIED: repositories.ts `getOlderPage` read 2026-09-06].
**When to use:** Every chat view. At 40/page × 3 pages the DOM stays ~150 nodes whether the chat has 400 or 100K messages; older pages are re-fetchable (cursor retained) so trimming loses no data.

```typescript
// src/lib/chat/windows.ts — pure state machine (fully unit-testable, no DOM):
export interface WindowState { chatId: number; pages: MessageRecord[][]; hasMore: boolean; loading: boolean; }
export const PAGE_SIZE = 40;
export const MAX_RENDERED_PAGES = 3;

export function cursorOf(state: WindowState): PageCursor | null {
  const oldest = state.pages[0]?.[0];
  return oldest ? { timestamp: oldest.timestamp, id: oldest.id as number } : null;
}
export function prependPage(state: WindowState, page: MessageRecord[]): WindowState {
  if (page.length === 0) return { ...state, hasMore: false, loading: false };
  const pages = [page, ...state.pages].slice(-MAX_RENDERED_PAGES); // keep NEWEST 3
  // NOTE: slice(-3) drops the OLDEST rendered page; its cursor is recomputed from the new
  // pages[0][0], so scrolling up again re-fetches it — no data loss, just a re-read. [ASSUMED logic — unit test must pin this]
  return { ...state, pages, hasMore: page.length === PAGE_SIZE, loading: false };
}
export function renderedCount(state: WindowState): number {
  return state.pages.reduce((n, p) => n + p.length, 0);
}
```

```svelte
<!-- ChatView scroll-anchoring sketch (logic, not final markup) -->
async function loadOlder() {
  if (loading || !hasMore) return;
  loading = true;
  const el = scrollContainer;
  const prevHeight = el.scrollHeight;
  const cursor = cursorOf(window);
  const page = await messages.getOlderPage(chatId, cursor!, PAGE_SIZE);
  window = prependPage(window, page);
  await tick(); // let Svelte flush DOM before measuring [ASSUMED Svelte 5 tick import from 'svelte']
  el.scrollTop += el.scrollHeight - prevHeight; // anchor: content grew above, hold position
  loading = false;
}
```

Display order: repository returns newest-first; reverse each page (and page order) to chronological for rendering, with the scroll container initially pinned to bottom (`scrollTop = scrollHeight` after initial `tick()`).

### Pattern 4: Bubble UI — sender color, timestamps, day separators (all pure helpers)

**What:** WhatsApp-style rows: group chats show a colored sender label per message; timestamps are small right-aligned `HH:MM`; a day divider separates calendar days. All formatting is pure functions in `formatting.ts` (unit tests, no DOM, no `date-fns`).
**When to use:** Every message row; sender labels may be suppressed for 1:1 chats only if participant count = 2 AND both messages share one sender — default to always-show (simpler, matches WhatsApp group behavior; planner's UI discretion).

```typescript
// src/lib/chat/formatting.ts
const SENDER_PALETTE = ['text-rose-600','text-sky-600','text-emerald-600','text-amber-600',
  'text-violet-600','text-pink-600','text-cyan-600','text-lime-600']; // dark: variants suffixed at call site
export function senderColor(sender: string): string {
  let h = 0; for (const c of sender) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return SENDER_PALETTE[h % SENDER_PALETTE.length]; // deterministic per sender [ASSUMED palette — any 8 distinct hues work]
}
export function formatClock(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}
export function formatDayLabel(ts: number, now = Date.now()): string {
  const day = new Date(ts); const today = new Date(now); const yest = new Date(now - 86_400_000);
  const sameDay = (a: Date, b: Date) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  if (sameDay(day, today)) return 'Today';
  if (sameDay(day, yest)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(day);
}
```

### Pattern 5: Media placeholders from parser `mediaType` (never render media)

**What:** Total mapping from stored `type`/`mediaType` to icon + label. Parser emits `MessageType = 'text'|'media'|'system'|'call'|'deleted'` and `MediaType = 'image'|'video'|'audio'|'document'|'sticker'|'gif'` [VERIFIED: src/lib/parser/types.ts]. v1 renders placeholders only (REQUIREMENTS Out of Scope: media rendering deferred).
**When to use:** Any message with `type === 'media'`; `system`/`call`/`deleted` render as centered event rows, never bubbles.

```typescript
// src/lib/chat/placeholders.ts
export function mediaPlaceholder(type: MessageType, mediaType?: MediaType): { icon: string; label: string } {
  if (type !== 'media') throw new Error('mediaPlaceholder: non-media message');
  switch (mediaType) {
    case 'image': return { icon: '📷', label: 'Image' };
    case 'video': return { icon: '🎬', label: 'Video' };
    case 'audio': return { icon: '🎤', label: 'Audio' };
    case 'document': return { icon: '📄', label: 'Document' };
    case 'sticker': return { icon: '⭐', label: 'Sticker' };
    case 'gif': return { icon: '🎞️', label: 'GIF' };
    default: return { icon: '📎', label: 'Media' }; // mediaType undefined — must not crash
  }
}
```

### Pattern 6: Routing — extend `+page.svelte`, selection in `?chat=`

**What:** `+page.svelte` (currently the import page, ~250 lines, runes state machine) [VERIFIED: src/routes/+page.svelte] becomes a shell with two views (Browse | Import) plus master-detail inside Browse. Selection = `?chat=<id>` synced both ways (`goto('?chat='+id)` on click; read `page.url.searchParams` on load for deep links). No new route files, no layout changes, no prerender config changes (`prerender=true` + `fallback:200.html` keep working: one static shell, data resolves client-side).
**When to use:** MVP. A `/chat/[id]` route is the wrong tool here — there is nothing to prerender per id (dataset lives in the user's IndexedDB) and it would force prerender opt-out plumbing for zero UX gain.

### Pattern 7: Dark mode — system default + manual toggle, no FOUC

**What:** Tailwind v4 class-based dark mode + a 6-line init script in `app.html` + a `theme.ts` store. Tailwind v4 defaults `dark:` to `prefers-color-scheme`; opting into class control requires declaring the custom variant in CSS [ASSUMED — Tailwind v4 documented `@custom-variant` mechanism; confirm exact syntax against installed 4.3.3 during implementation, Wave 0].
**When to use:** Always-on theming; every new component ships both `…` and `dark:…` classes (chat surfaces are the worst place for a half-themed view).

```css
/* app.css — append (keeps the existing @import line): */
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

```html
<!-- app.html <head>, before %sveltekit.head% — prevents white flash on dark users: -->
<script>(function(){try{var t=localStorage.getItem('ragchat:theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();</script>
```

```typescript
// theme.ts — resolveInitialTheme(): 'light'|'dark' (localStorage → matchMedia → 'light');
// applyTheme(t): document.documentElement.classList.toggle('dark', t==='dark'); localStorage set.
// Toggle component flips + persists; default (no stored pref) FOLLOWS the OS live (no listener needed
// for MVP — re-evaluated on reload; a matchMedia listener is a polish item).
```

### Anti-Patterns to Avoid

- **Dynamic `/chat/[id]` routes under adapter-static strict prerender:** nothing per-id exists at build time; use `?chat=` instead (Pattern 6).
- **`{@html}` for message bodies (XSS hole):** Svelte escapes `{text}` by default — keep it that way; links/phone numbers stay plain text in v1 (Pitfall 5).
- **`flex-col-reverse` chat containers:** breaks `scrollTop` math, screen-reader order, and anchor correction — render chronological top→bottom, pin with `scrollTop = scrollHeight`.
- **Subscribing `liveQuery` at module top-level or during prerender:** no `window`/`indexedDB` there — subscribe in `$effect` behind `browser` (Pitfall 3).
- **Re-sorting the sidebar in JS after fetching by `importedAt`:** the fix is the index (Pattern 1), not a client sort — client sorts can't page and can't go live.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reactive Dexie queries | Custom event bus / manual re-fetch after import | `liveQuery()` from `dexie` | Handles multi-write batching, error paths, teardown; hand-rolled buses desync (missed updates after upsert-merge) |
| Keyset pagination | `offset()`/`limit()` or `toArray()` + slice | Existing `getLatestWindow`/`getOlderPage` on `[chatId+timestamp]` | Offset drifts as imports land; full scans OOM on 100K chats; the tiebreak logic for same-ms siblings already exists and is tested |
| Date/time labels | Custom relative-time math | `Intl.DateTimeFormat` + day-compare helper | Locales, 12/24h, DST edges — stdlib handles; custom code fails non-US locales first |
| Zip/media decoding | Media renderers (`<img>`/`<video>` from export filenames) | Typed placeholders (Pattern 5) | Export files reference media NOT included in `.txt` exports — rendering attempts 404 by design; placeholders are the spec (BROW-04) |
| Pixel-exact virtualization | Custom offset-measurement virtualizer | Paged windowing (Pattern 3) | Variable-height bubbles need measurement + correction loops; the <200-node criterion is satisfiable with pages at 1/10th the bug surface |

**Key insight:** This phase is a *consumption* phase — every hard problem (parsing, dedup, chunked writes, keyset cursors, schema versioning) was solved in Phases 1–2. The failure mode to avoid is re-solving them in the UI layer instead of subscribing (liveQuery), paging (existing cursors), and indexing (`lastMessageAt`) what's already there.

## Unit-Testing Approach

Vitest only, existing `fake-indexeddb/auto` setup [VERIFIED: vite.config.ts + setup.ts]. No Playwright, no browser, no component-DOM tests — the architecture keeps all logic in pure helpers precisely so the suite stays headless.

| Layer | What | How | Example file |
|-------|------|-----|--------------|
| Pure helpers | `formatting` (clock/day/sidebar labels, sender color determinism), `placeholders` (all 6 mediaTypes + undefined + non-media throw), `windows` (prepend/trim/cursor/count incl. empty-page `hasMore=false`) | Plain `describe/it/expect`, boundary cases (midnight, DST-adjacent days, empty sender, same-ms pages) | `src/lib/chat/__tests__/formatting.test.ts`, `placeholders.test.ts`, `windows.test.ts` |
| Repository integration | v3 migration backfill (seed chats+messages → upgrade → assert `lastMessageAt` = max ts; empty-chat fallback = `importedAt`), `listChatsNewest` order after out-of-order commits, `saveChat`/`commitImport` maintenance of `lastMessageAt` | Real `RagChatDB` against `fake-indexeddb`, `applyMigrations` registered before `open` | `src/lib/db/__tests__/ordering.test.ts` (new) |
| State-machine | Selection sync (`?chat=` parse/serialize round-trip), theme resolution matrix (stored×system→resolved) | Pure-function tests of tiny helpers (`parseChatParam`, `resolveInitialTheme`) | `src/lib/chat/__tests__/selection.test.ts`, `theme.test.ts` |
| Scroll math | Anchor-delta formula (`newScrollTop = old + (newHeight − oldHeight)`), rendered-budget invariant (`renderedCount ≤ 200` for simulated 100K via stacked pages) | Pure arithmetic tests — no DOM needed | Fold into `windows.test.ts` |

Coverage bar: every pure helper at 100% branches; migration test must cover (a) normal backfill, (b) empty chat, (c) already-migrated idempotence, (d) v1→v3 fresh-install path (no v2 data).

## Common Pitfalls

### Pitfall 1: Scroll jump on prepend (content grows above viewport)
**What goes wrong:** Loading older messages teleports the user downward by the height of the prepended page.
**Why it happens:** `scrollHeight` increases above `scrollTop`; the browser keeps `scrollTop` constant, so the visible messages shift.
**How to avoid:** The `scrollHeight`-delta anchor in Pattern 3 (measure → prepend → `tick()` → adjust). Never `scrollIntoView` on prepend.
**Warning signs:** Manual-testing "jump" on every older-page load; fix is in the loader, not CSS.

### Pitfall 2: Reversed flex (`flex-col-reverse`) for bottom-pinning
**What goes wrong:** `scrollTop` becomes negative/zero-anchored, anchor math inverts, a11y order reverses, `IntersectionObserver` root margins misbehave.
**Why it happens:** It looks like a one-line trick for "chat starts at bottom".
**How to avoid:** Chronological DOM + explicit `scrollTop = scrollHeight` after initial load and after sending (no sending in v1 — only initial pin + "jump to latest" button as polish).
**Warning signs:** Any `column-reverse` in ChatView CSS during review — reject.

### Pitfall 3: SSR/prerender crash from IndexedDB access
**What goes wrong:** `db.chats…` or `liveQuery(…)` at module scope / in `$derived` during prerender throws (`indexedDB is not defined`), breaking `bun run build`.
**Why it happens:** Root `+layout.ts` sets `prerender = true` [VERIFIED]; prerender runs components in Node.
**How to avoid:** All Dexie contact behind `browser` (from `$app/environment`) inside `$effect`/`onMount`; initial `$state` is empty arrays + `loading=true` skeleton; verification must include a full `bun run build` (see Validation Architecture).
**Warning signs:** Build log errors mentioning `indexedDB`/`window`/`localStorage` at prerender time.

### Pitfall 4: Full-table scans for sidebar ordering or snippets
**What goes wrong:** Sidebar takes seconds on large libraries; fan-out reads per chat multiply.
**Why it happens:** `orderBy` on a non-indexed field throws (Dexie) so devs fall back to `toArray()` + JS sort, or fetch all messages per chat for previews.
**How to avoid:** Pattern 1 (indexed `lastMessageAt`, limit-bounded) + denormalized snippet at commit time. Review gate: no `toArray()` on `messages` without a `[chatId+timestamp]`-bounded query; no unindexed `orderBy`.
**Warning signs:** `chats.toArray()` or `.filter()` over full collections anywhere in `src/lib/chat/`.

### Pitfall 5: XSS via `{@html}` "linkification"
**What goes wrong:** Export text contains attacker-craftable payloads (`<img onerror=…>` as a message); rendering HTML executes it. Single-user archive ≠ safe — exports come from other people's messages.
**Why it happens:** Desire to auto-link URLs/phone numbers.
**How to avoid:** Escaped `{text}` interpolation only (Svelte default); no `{@html}` anywhere in Phase 4; linkification deferred to a phase that can afford a sanitizer (which would then be a new dep + audit).
**Warning signs:** `{@html` in any `.svelte` file — fail code review (Security Domain).

### Pitfall 6: 100K-row DOM blowup
**What goes wrong:** Rendering all loaded messages; tab freezes, scroll janks, memory climbs.
**Why it happens:** "Windowing" implemented as append-only without a trim budget, or per-message component state (timers/observers per bubble).
**How to avoid:** `MAX_RENDERED_PAGES` trim (Pattern 3) + `renderedCount` assertion in tests; one shared `IntersectionObserver` per ChatView, zero per-bubble observers; verification step counts DOM nodes on a seeded 100K chat (Validation Architecture).
**Warning signs:** `{#each}` over an unbounded array; per-row `use:` actions that allocate observers.

### Pitfall 7: Dark-mode flash (FOUC) + half-themed surfaces
**What goes wrong:** White flash on load for dark users; chat bubbles readable in light but low-contrast in dark.
**Why it happens:** Theme applied in `$effect` (after paint); `dark:` classes added to some components but not bubbles/separators/sidebar.
**How to avoid:** Inline init script in `app.html` (Pattern 7, runs before paint) + review checklist: every new `class="…"` with a color utility gets its `dark:` counterpart.
**Warning signs:** Any color class without a `dark:` sibling in MessageBubble/ChatSidebar/DateSeparator during review.

## Code Examples

### `liveQuery` sidebar subscription (browser-guarded, Svelte 5)

```typescript
// Source: Dexie liveQuery docs (https://dexie.org/docs/liveQuery()) — shape confirmed from
// training knowledge [ASSUMED]; pin import + options against installed dexie@4.4.5 in Wave 0.
import { browser } from '$app/environment';
import { liveQuery } from 'dexie';
import { db } from '$lib/db/db';
import type { ChatRecord } from '$lib/db/db';

let chats = $state<ChatRecord[]>([]);
let chatsLoading = $state(true);

$effect(() => {
  if (!browser) return;
  const sub = liveQuery(() =>
    db.chats.orderBy('lastMessageAt').reverse().limit(100).toArray()
  ).subscribe({
    next: (rows) => { chats = rows; chatsLoading = false; },
    error: (e) => { console.error('sidebar query failed', e); chatsLoading = false; }
  });
  return () => sub.unsubscribe();
});
```

### Keyset window loader (consumes Phase-2 API verbatim)

```typescript
// Source: existing repository API [VERIFIED: src/lib/db/repositories.ts] — no new queries needed.
import { MessageRepository } from '$lib/db/repositories';
import { db } from '$lib/db/db';

const repo = new MessageRepository(db);
const PAGE = 40;

// Initial (newest-first from Dexie → chronological for render):
const newestFirst = await repo.getLatestWindow(chatId, PAGE);
const initialPage = [...newestFirst].reverse();

// Older (cursor = oldest currently held message):
const oldest = pages[0][0];
const olderNewestFirst = await repo.getOlderPage(
  chatId, { timestamp: oldest.timestamp, id: oldest.id as number }, PAGE
);
const olderPage = [...olderNewestFirst].reverse();
// Malformed-cursor safety is already inside getOlderPage (returns [] — never a scan) [VERIFIED].
```

### Virtual-window slice helper (budget invariant)

```typescript
// Source: new helper for src/lib/chat/windows.ts (design from this research [ASSUMED logic —
// planner turns into tasks; windows.test.ts pins the invariant).
export function assertRenderBudget(state: WindowState, cap = 200): void {
  const n = renderedCount(state);
  if (n > cap) throw new Error(`render budget exceeded: ${n} > ${cap}`);
}
// MAX_RENDERED_PAGES=3 × PAGE_SIZE=40 = 120 message rows + ≤120 separators worst case ≈ 240 nodes
// → separators SHOULD be folded into bubble groups (one divider per day, and consecutive same-sender
// messages share one bubble header) to hold the true node count ≈ 130–160. Planner: make day-grouping
// + sender-grouping part of the ChatView acceptance criteria, not polish.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Order chats by `importedAt` | Order by denormalized `lastMessageAt` | This phase (v3 migration) | Sidebar meets SC-1 incl. re-import/merge flows |
| `svelte-virtual-list` for Svelte virtualization | Hand-rolled paging now; `@tanstack/virtual` family if pixel-virtualization ever needed | TanStack Virtual v3 stable 2024–2026; `svelte-virtual-list` abandoned 2021 | No dead dependency; upgrade path exists with evidence bar |
| Tailwind v3 `darkMode: 'class'` config | Tailwind v4 `@custom-variant dark (…)` in CSS | Tailwind v4 (2025) CSS-first model | One CSS line; no config file to maintain |
| `date-fns` for all date labels | Stdlib `Intl` for 4-label surface | This phase (footprint decision) | Zero new deps; revisit if relative-time needs grow |
| Per-route `/chat/[id]` pages | Single shell + `?chat=` selection | This phase (adapter-static prerender reality) | No prerender plumbing, full deep-linkability |

**Deprecated/outdated:**
- `svelte-virtual-list@3.0.1`: unmaintained since 2021, Svelte-4-era API — do not adopt.
- Client-side full-collection sort for ordering (`toArray()` + `Array.sort`): fails at scale; the index is the sort.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `liveQuery` is exported from `'dexie'` root with `.subscribe({next,error})` shape | Patterns 2, Code Examples | Import error at build; Wave-0 spike (10 min) confirms against installed 4.4.5 — low blast radius |
| A2 | Tailwind v4 class-mode syntax is exactly `@custom-variant dark (&:where(.dark, .dark *));` | Pattern 7 | Dark toggle silently no-ops; caught by first manual toggle test — verify against installed 4.3.3 in Wave 0 |
| A3 | Dexie `version(3).stores()` must restate ALL stores (chats + messages incl. v2 `sender` index) or undeclared stores are dropped/kept per `stores()` merge semantics | Pattern 1 | **HIGH if wrong:** schema loss on upgrade. Mitigation: migration test asserts v2 indexes survive; confirm `stores()` merge semantics in Dexie docs during planning |
| A4 | Upgrade callback can be `async` and can query other tables via `tx.table()` | Pattern 1 | Backfill fails to write; fallback is lazy backfill on first sidebar read — acceptable degraded path |
| A5 | `tick()` from `'svelte'` flushes DOM before scroll measurement in Svelte 5 | Pattern 3 | Anchor math reads stale `scrollHeight` → 1-frame jump; alternative `requestAnimationFrame` fallback noted |
| A6 | `svelte-virtual-list` registry `repository.url` pointing at an unfamiliar mirror indicates staleness risk | Audit | If wrong, still stale (2021) — disposition unchanged regardless |
| A7 | `@tanstack/virtual-core` / `date-fns` signal-based OK verdicts (seam unavailable) | Audit | Planner gates any future install behind `checkpoint:human-verify` anyway — contained |

## Open Questions

1. **Should the snippet (`lastSnippet`/`lastSender`) be denormalized onto `ChatRecord` at commit time, or fetched lazily per visible chat?**
   - What we know: ≤100 sidebar rows; lazy = 100 indexed point-reads per paint; denormalized = zero fan-out but wider write + migration backfill of snippet text.
   - What's unclear: Whether 100 point-reads under `liveQuery` cause perceptible sidebar lag on low-end devices.
   - Recommendation: Denormalize (same commit write already touches the chat row); make it part of the v3 migration backfill. Reversible later.

2. **Browse ↔ Import navigation shape (tabs vs sequential vs separate view)?**
   - What we know: `+page.svelte` is currently 100% import UI; both features share one route in the recommended design.
   - What's unclear: UX preference (persistent sidebar with import as a view vs import-first landing).
   - Recommendation: Agent's discretion — recommend persistent top-level tabs (Browse | Import) with Browse default when ≥1 chat exists, else Import. No research blocker.

3. **PWA/offline shell (`vite-plugin-pwa`) in this phase?**
   - What we know: Phase 03 research recommended deferring to the PWA phase; nothing in Phase 04 criteria needs a service worker.
   - Recommendation: Defer (out of scope); note as Deferred Idea for planner.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bun` (pkg mgr + scripts) | All install/test/lint commands | ✓ | 1.3.14 [VERIFIED: `bun --version`] | — |
| `node` (Vite/SvelteKit runtime) | Dev server, build, prerender | ✓ | v24.15.0 [VERIFIED: `node --version`] | — |
| Browser IndexedDB (prod) | Storage + liveQuery at runtime | ✓ (by platform) | — | n/a (core constraint: client-side only) |
| `fake-indexeddb` (test double) | All Vitest DB tests | ✓ | 6.2.5 [VERIFIED: package.json + setup.ts] | — |
| `IntersectionObserver` (browser) | Scroll-to-top sentinel | ✓ (all modern browsers) | — | Manual "Load older" button (planner: keep the button anyway as a11y fallback) |
| `matchMedia('(prefers-color-scheme: dark)')` | System theme default | ✓ (all modern browsers) | — | Default light |
| External services / CLIs / DBs | — | n/a | — | — (no external dependencies this phase) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none (zero-new-deps; every runtime API used is universal modern-browser surface).

Step 2.6 environment probes (`bun --version`, `node --version`, registry `bunx npm view` ×4, `which gsd-tools`, registry `repository.url` ×2) all executed 2026-09-06; only gap is the absent `gsd-tools` seam binary (noted, non-blocking).

## Validation Architecture

`workflow.nyquist_validation` is `true` [VERIFIED: .planning/config.json] — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (existing config, `fake-indexeddb/auto` setup) |
| Config file | `vite.config.ts` (`test.setupFiles`) — exists, no change |
| Quick run command | `bun run test -- src/lib/chat` (scoped) |
| Full suite command | `bun run test` + `bun run typecheck` + `bun run lint` + `bun run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| BROW-01 | Sidebar lists chats newest-first by *message* time (incl. re-import reorder) | integration (fake-indexeddb) | `bun run test -- src/lib/db/__tests__/ordering.test.ts` | ❌ Wave 0 (new) |
| BROW-01 | v3 migration backfills `lastMessageAt` (normal/empty/idempotent/fresh-install) | integration | same file (`migration backfill` block) | ❌ Wave 0 (new) |
| BROW-02 | Selection `?chat=` round-trips; unknown id → empty-state, no crash | unit | `bun run test -- src/lib/chat/__tests__/selection.test.ts` | ❌ Wave 0 (new) |
| BROW-03 | Clock/day/sidebar labels + deterministic sender color | unit | `bun run test -- src/lib/chat/__tests__/formatting.test.ts` | ❌ Wave 0 (new) |
| BROW-04 | All 6 mediaTypes + undefined map; non-media input throws; system/call/deleted → event-row kind | unit | `bun run test -- src/lib/chat/__tests__/placeholders.test.ts` | ❌ Wave 0 (new) |
| SC-4 | Window prepend/trim/cursor/count; budget invariant ≤200 at simulated 100K | unit (pure math) | `bun run test -- src/lib/chat/__tests__/windows.test.ts` | ❌ Wave 0 (new) |
| SC-4 | Real DOM node count <200 on seeded large chat | manual-only (no browser harness) | seed script + `document.querySelectorAll('[data-msg]').length` in devtools | n/a — manual UAT step |
| SC-5 | Theme resolution matrix (stored×system→resolved) + class application | unit (pure) + manual toggle check | `bun run test -- src/lib/chat/__tests__/theme.test.ts` | ❌ Wave 0 (new) |
| Guard | Prerender build passes (no IndexedDB at build) | build gate | `bun run build` | ✅ (existing script) |

### Sampling Rate

- **Per task commit:** `bun run test -- src/lib/chat src/lib/db/__tests__/ordering.test.ts` (scoped, <30s) + `bun run typecheck`
- **Per wave merge:** full `bun run test` + `bun run lint`
- **Phase gate:** full suite green + `bun run build` green (prerender guard) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/lib/chat/__tests__/formatting.test.ts` — BROW-03 (write helpers first, tracer-first)
- [ ] `src/lib/chat/__tests__/placeholders.test.ts` — BROW-04
- [ ] `src/lib/chat/__tests__/windows.test.ts` — SC-4 pure logic
- [ ] `src/lib/chat/__tests__/selection.test.ts` + `theme.test.ts` — BROW-02, SC-5
- [ ] `src/lib/db/__tests__/ordering.test.ts` — BROW-01 + v3 migration (needs `RagChatDB` + `applyMigrations` harness)
- [ ] Manual UAT checklist: 100K-seed DOM count, scroll-anchor feel, dark toggle × system switching, `?chat=` deep link, `bun run build` prerender

## Security Domain

Required: `security_enforcement` is enabled (default true; `security_asvs_level: 1`, `security_block_on: high`) [VERIFIED: .planning/config.json].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | Single-user local app, no accounts, no sessions |
| V3 Session Management | No | No sessions/tokens |
| V4 Access Control | No | No multi-user resources; local-only data |
| V5 Input Validation | **Yes** | `?chat=` param parsed as integer, unknown ids → empty-state (never interpolated into queries); file inputs unchanged from Phase 3 (validation already exists) |
| V6 Cryptography | No | No crypto; `localStorage` theme key is non-sensitive |
| V14 Configuration | Partial | `app.html` inline theme script is static, no dynamic construction; CSP-compatible (no `eval`, no inline event handlers added) |

### Known Threat Patterns for SvelteKit + Dexie (client-only) stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored XSS via chat text (`<img onerror>`, `<script>` in exports from other senders) | Tampering / Elevation | **Escaped `{text}` interpolation only; `{@html}` banned in Phase 4** (Pitfall 5). Svelte escapes by default — the control is "don't opt out". |
| `?chat=` injection (non-numeric / oversized ids) | Tampering | Strict parse (`Number.isInteger`, reject → empty-state); ids only ever used as Dexie primary-key gets, never string-concatenated |
| Data exfiltration via crafted export filenames | Information disclosure | Filenames already validated in Phase 3; sidebar renders names as text (escaped), never as HTML/attributes |
| Cache poisoning of theme key (`localStorage`) | Tampering | Non-sensitive preference; `resolveInitialTheme` allow-lists `'light'\|'dark'`, anything else → system default |

## Sources

### Primary (HIGH confidence)
- Repo ground truth read 2026-09-06: `src/lib/db/db.ts`, `repositories.ts`, `migrations.ts`, `src/lib/import/commit.ts`, `src/lib/parser/types.ts`, `src/routes/+page.svelte`, `+layout.ts`, `src/app.html`, `src/app.css`, `svelte.config.js`, `tsconfig.json`, `vite.config.ts`, `package.json`, `biome.json`, `.planning/config.json`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`
- npm registry via `bunx npm view` 2026-09-06: `dexie@4.4.5` (+ `time` incl. 4.4.4/4.4.5 dates), `date-fns@4.4.0` (+ `time`), `svelte-virtual-list@3.0.1` (+ `time`: created 2021-06-22, modified 2022-05-19; `repository.url` mirror path), `@tanstack/virtual-core@3.17.8` (+ `time`: 2026-08-18; `repository.url` github.com/TanStack/virtual)
- Environment probes: `bun 1.3.14`, `node v24.15.0`

### Secondary (MEDIUM confidence)
- Dexie `liveQuery()` API shape [CITED: https://dexie.org/docs/liveQuery()] — shape from training knowledge, not fetched this session (no docs seam available)
- TanStack Virtual monorepo as legitimate source [CITED: https://github.com/TanStack/virtual] (registry pointer only, not browsed)

### Tertiary (LOW confidence — flagged for Wave-0 confirmation, see Assumptions Log)
- Tailwind v4 `@custom-variant` exact syntax; Dexie `stores()` merge semantics for v3; `liveQuery` root import path; Svelte 5 `tick()` import path — all [ASSUMED], each with a named Wave-0 verification step, none load-bearing for the plan structure

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed versions verified in package.json + registry; zero-new-deps means no supply-chain exposure; deferred candidates dispositioned with dates.
- Architecture: HIGH — ordering/windowing/routing patterns derive directly from the read-and-verified Phase-2 API and adapter config; the one structural change (v3 migration) follows the existing `migrations.ts` precedent.
- Pitfalls: HIGH — each pitfall names a concrete file/mechanism in this repo (prerender flag, `getOlderPage` cursor shape, Svelte escaping default).
- Dark-mode CSS syntax / Dexie docs details: MEDIUM — training knowledge, Wave-0 verification steps assigned (A1–A5).

**Research date:** 2026-09-06
**Valid until:** 2026-10-06 (30 days; stable domain — Dexie 4.x / Svelte 5 / Tailwind v4 APIs move slowly; re-check only if `bun install` resolves new minors)
