---
phase: 05-full-text-search
plan: '01'
completed: 2026-09-12
status: passed
requirements-completed:
- SRCH-01
- SRCH-02
- SRCH-03
---

# 05-01 SUMMARY — Search engine + highlight lib

**Phase:** 05-full-text-search / Plan 01 (wave 1)
**Status:** executed 2026-09-12 — all gates green (265/265 tests at the time, later 270 with 05-02's codec tests)

## What was built

- `src/lib/db/repositories.ts` — deleted `searchTerms`/`searchTermsInChat` (no production callers; tests migrated); added:
  - `searchMessages(query, { chatId?, limit?, candidateCap? })` → `{ total, results }` — exact count via `Collection.primaryKeys()` on the filter-before-distinct multiEntry `terms` collection (zero record materialization for counting); candidates = primary keys sorted descending then capped at 200 (anyOf+distinct primaryKeys are grouped per-term, not globally ordered — sort is required); records via `bulkGet`, final order timestamp desc + id desc tiebreak, sliced to limit (default 50)
  - `getWindowAt(chatId, msgId, limit)` → `{ messages (chronological), targetId } | null` — bounded window around a target message for scroll-to-result navigation; every read path explicitly `.limit()`-ed (keeps the repo-layer "every read path limit-bounded" source-lint green); null for missing/foreign-chat targets
- `src/lib/chat/windows.ts` — `seedWindow(chatId, messages)`: seeds the windowing state machine from a `getWindowAt` result; keeps `pages[0][0]` cursor semantics so `loadOlder`/`trimToBudget` work unchanged
- `src/lib/search/highlight.ts` — `splitByTerms` (regex-escaped, longest-first alternation, case-insensitive; returns plain-text segments) and `makeSnippet` (first-match window, space-snapped, `…` padding); no HTML output anywhere
- `src/lib/search/search.ts` — `searchAll` / `searchChat` orchestrators: `SearchResult = { message, chatName }`, chat names via one `bulkGet`
- Tests: repositories.test.ts migrated + new (ordering, count-vs-limit split, getWindowAt middle/newest/oldest/null); windows.test.ts seedWindow block; new highlight.test.ts + search.test.ts

## Checkpoint decisions

- **Dexie multiEntry over Orama** (user-confirmed 2026-09-12, ROADMAP Research Flags resolved): index/tokenizer/query layer already existed since schema v1; zero new deps; native IndexedDB persistence avoids the documented in-memory-Orama blowout pitfall; v2 RAG needs its own embedding/vector storage regardless.
- **Filter before distinct** on multiEntry anyOf (Dexie documented order — matches the deleted `searchTermsInChat` pattern).
- **Sort primaryKeys descending before candidate slice** — the per-term grouping of anyOf+distinct keys would otherwise silently drop the newest matches when total > candidateCap.

## Verification

- `bun run test` — 265/265 (migrated search assertions, 12 repository tests incl. 3 new, 28 window tests incl. 4 seedWindow, 10 highlight, 3 search integration)
- `bun run typecheck`, `bun run check` (svelte-check), `bunx biome check src`, `bun run build` — all exit 0
- Source-lint test "every read path limit-bounded" stays green (explicit `.limit()` on all new reads)

Consumed verbatim by 05-02 (see 05-02-SUMMARY.md).
