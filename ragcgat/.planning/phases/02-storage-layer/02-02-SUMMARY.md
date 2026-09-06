---
phase: 02-storage-layer
plan: '02'
subsystem: storage
tags: [dexie, indexeddb, repositories, keyset-pagination, migration, vitest, fake-indexeddb]
requires: [02-storage-layer-repositories-tracer, 01-parser-library]
provides: [repository-layer, keyset-pagination, keyword-search, import-entry-point, v2-migration-path]
affects: [search-phase, ui-phase]
tech-stack:
  added: []
  patterns: [dedup-before-write bulkAdd, compound-index keyset cursor with id tiebreak, multiEntry anyOf distinct search, additive Dexie version upgrade]
key-files:
  created:
    - src/lib/db/repositories.ts
    - src/lib/db/migrations.ts
    - src/lib/db/__tests__/repositories.test.ts
    - src/lib/db/__tests__/migration.test.ts
  modified:
    - src/lib/db/index.ts
decisions:
  - Dedup pre-query uses where(dedupHash).anyOf().keys() (index keys), not primaryKeys
  - Same-ms pagination resolved by id tiebreak in JS, merged newest-first
  - v2 migration adds sender index plus unindexed day backfill; version(1) block untouched
metrics:
  duration: ~15 min
  completed: 2026-09-06
  tasks: 2
  tests: 10 new (127 full suite green)
status: complete
---

# Phase 02 Plan 02: Repositories plus Migration Summary

Full storage layer on top of the verified v1 schema: idempotent 500-chunk bulk writes, gap-free keyset pagination with same-millisecond tiebreak, shared-tokenizer keyword search, the `importChatText` parser-to-DB entry point with fire-and-forget persistence, and a tested v1-to-v2 migration path — 10 new tests, full suite 127/127 green, typecheck and Biome clean.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| auto | Repositories: bulk import, keyset paging, keyword search | 1dc1a30 | repositories.ts, __tests__/repositories.test.ts |
| auto | Versioned migration path with upgrade test | a19c1e4 | migrations.ts, __tests__/migration.test.ts, index.ts |

## Key Decisions

- **Dedup via index keys:** pre-query uses `where('dedupHash').anyOf(hashes).keys()` — the index keys ARE the hash values. First attempt used `.primaryKeys()` (row ids), which never matched and pushed dedup onto the BulkError fallback path.
- **Same-ms tiebreak in JS:** `getOlderPage` fetches `equals([chatId, cursorTs])` siblings, filters `id < cursor.id`, sorts desc, and merges ahead of the strictly-older `between(..., false)` range — newest-first, exactly `limit` rows.
- **Cursor validation:** malformed cursors (NaN/Infinite/non-positive limit) return `[]` instead of risking a full scan (T-02-09).
- **Additive v2 only:** `migrations.ts` exports side-effect-free `applyMigrations()` registering `version(2)` (sender index + `day` backfill via pure sync `modify`); the `version(1)` block in db.ts was never edited.

## Verification Outcomes

- `bun run test -- src/lib/db/__tests__/repositories.test.ts src/lib/db/__tests__/migration.test.ts` — 2 files, 10 tests, all pass
- `bun run test` (full suite) — 10 files, 127 tests, all pass
- `bun run typecheck` — exit 0
- `bunx biome check src/lib/db` — clean after `--write` (format + import-type + import-sort fixes)
- Grep gate: 6 `toArray()` sites in non-test code, every one preceded by `.limit()`; no `.offset(` anywhere

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dedup pre-query compared row ids against hashes**
- **Found during:** Task 1, re-import test run (chunk logged `wrote 0/200` via BulkError path)
- **Issue:** `where('dedupHash').anyOf(hashes).primaryKeys()` returns auto-increment ids, so the `seen` set never matched and every re-import fell through to `bulkAdd` + constraint-error fallback
- **Fix:** Switched to `.keys()` (the index keys are the dedupHash values); re-import now short-circuits to `written: 0` with no error path
- **Commit:** 1dc1a30

**2. [Rule 3 - Blocking] Biome format/lint findings in new files**
- **Found during:** Task 2 verify (`bunx biome check` reported format + `useImportType` + import-sort)
- **Issue:** Chained `db.version(2).stores(...).upgrade(...)` formatting, `import { type ... }` style, unsorted migration-test import
- **Fix:** `bunx biome check --write src/lib/db`; re-ran full suite green afterwards
- **Commit:** a19c1e4 (files committed post-fix)

## Known Stubs

None — repository layer is complete; Orama/RAG search is an explicitly later phase, not a stub.

## Threat Flags

None — all plan threat-register mitigations applied (T-02-05 chunking + per-chunk isolation; T-02-06 shared tokenize caps + limit on every search; T-02-07 pure sync backfill with transactional rollback; T-02-08 hash is local dedup key only; T-02-09 cursor validation + grep gate).

## Self-Check: PASSED

- All 4 created files + index.ts edit exist on disk
- Commits 1dc1a30 and a19c1e4 exist in git log
- Full suite (127), typecheck, and Biome all green; grep shows no unbounded reads
