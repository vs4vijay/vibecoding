# 02-UAT: Storage Layer — User Acceptance Testing

- **Phase:** 02-storage-layer
- **Date:** 2026-09-06
- **Method:** direct execution against the built library (temporary Vitest driver under `src/lib/db/__tests__/`, since deleted — Phase 02 is pure infrastructure with no UI; `fake-indexeddb/auto` shim does not install under the `bun` runtime so the driver ran under Vitest/Node like the repo suite), exercising each phase success criterion from the user's perspective
- **Result:** 10/10 PASS — no issues found, no fix plans needed

## Test Results

| # | Test (user perspective) | Result | Evidence |
|---|-------------------------|--------|----------|
| T1 | Importing my iOS export saves the chat and I can read it back newest-first | PASS | `sample-ios.txt` → 8 msgs written, 8 read back, descending timestamps confirmed |
| T2 | Re-importing the same export does not duplicate anything | PASS | second import wrote 0 rows, count stable |
| T3 | A large import (2500 messages) completes with every row present | PASS | 2500/2500 written and counted |
| T4 | Scrolling back through 120 messages in pages of 30 shows each message exactly once (incl. 20 same-millisecond messages) | PASS | 4×30 pages, 120 unique ids, zero overlap/gaps |
| T5 | Searching "MEETING" finds my messages regardless of case, each once, and in-chat search agrees | PASS | 2 hits, once-each, in-chat=2, nonsense query=0 |
| T6 | My data is still there after closing and reopening the app | PASS | count 8 before close = 8 after reopen |
| T7 | A database upgrade keeps all my messages and backfills the new field | PASS | rows 8→8, `day='2024-07-09'`, sender index returns 3 hits |
| T8 | First import requests durable storage without crashing outside a browser | PASS | `ensurePersistence()` returns false (not throw) under Node, repeat-safe |
| T9 | Search tokenization handles case, unicode, and junk input | PASS | `Hello HELLO world`→`[hello,world]`; singles/empty→`[]`; `Café naïve München`→3 terms |
| T10 | Chat/message tables carry the compound, multiEntry, and unique indexes | PASS | `[chatId+timestamp]` + `*terms` (multi) + `&dedupHash` (unique) all present |
| Suite | Full automated suite green | PASS | `bun vitest run` 127/127, `tsc --noEmit` 0 errors, `biome check src/lib/db` clean |

## Success Criteria Coverage

- [x] Chat + message tables with compound `[chatId+timestamp]` and multiEntry `terms` indexes — T10, T1
- [x] Bulk inserts of 500–1000 per transaction, no per-message transactions — T3 (500-chunk `bulkSave`)
- [x] Cursor-based pagination, never `getAll()` on the full store — T4, grep gate (6 non-test `toArray()` all `limit()`-bounded, no `offset()`)
- [x] `navigator.storage.persist()` requested on first data write — T8 (`importChatText` fires `ensurePersistence` after first write)
- [x] Database versioning and migration path — T7 (v1 block frozen, additive v2 with backfill)

## Diagnosis / Fix Plans

None — zero failures. No gaps to diagnose, no fix plans to prepare.

## Routing

Phase 02 UAT complete with all tests passing. Ready for Phase 03 (Import Feature) planning.
