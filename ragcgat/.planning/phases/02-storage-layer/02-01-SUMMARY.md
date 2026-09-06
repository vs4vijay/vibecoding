---
phase: 02-storage-layer
plan: '01'
subsystem: storage
tags: [dexie, indexeddb, tokenize, persistence, vitest, fake-indexeddb]
requires: [01-parser-library]
provides: [db-schema-v1, shared-tokenizer, persistence-guard, db-test-harness]
affects: [02-storage-layer-repositories, search-phase]
tech-stack:
  added: [dexie@4.4.5, fake-indexeddb@6.2.5(dev)]
  patterns: [EntityTable typing, chunked bulkPut, keyset pagination on compound index, multiEntry terms search]
key-files:
  created:
    - src/lib/db/db.ts
    - src/lib/db/tokenize.ts
    - src/lib/db/persistence.ts
    - src/lib/db/index.ts
    - src/lib/db/__tests__/setup.ts
    - src/lib/db/__tests__/tracer.test.ts
    - src/lib/db/__tests__/tokenize.test.ts
    - src/lib/db/__tests__/persistence.test.ts
  modified:
    - package.json
    - bun.lock
    - tsconfig.json
    - vitest.config.ts
decisions:
  - Dexie IndexSpec introspection uses `multi` (not `multiEntry`) for the multiEntry flag assertion
  - Tracer transaction body uses a narrowed local const to satisfy Biome noNonNullAssertion
  - Followed PLAN paths src/lib/db/ over RESEARCH.md src/lib/storage/ sketch per plan instruction
metrics:
  duration: ~10 min
  completed: 2026-09-06
  tasks: 2
  tests: 12 new (117 full suite green)
status: complete
---

# Phase 02 Plan 01: Storage Tracer Slice Summary

Proved the storage architecture end-to-end: Dexie v1 schema (compound `[chatId+timestamp]`, multiEntry `*terms`, unique `&dedupHash`) plus shared tokenizer plus persistence guard, verified by a 20-message write-then-read round trip and 10 unit tests — all green under Vitest, typecheck, and Biome.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| tracer | Schema plus tokenizer plus persistence plus round trip | 820535d | db.ts, tokenize.ts, persistence.ts, index.ts, setup.ts, tracer.test.ts, package.json, tsconfig.json, vitest.config.ts |
| auto | Unit tests for tokenizer and persistence helper | b0a0f52 | tokenize.test.ts, persistence.test.ts, tracer.test.ts (lint fix) |

## Key Decisions

- **PLAN paths over research sketch:** used `src/lib/db/` as normatively required by the plan's files/actions, not the `src/lib/storage/` sketch in RESEARCH.md.
- **Dexie v4 `EntityTable` typing** for chats/messages tables (optional `id` on inserts, required on reads).
- **Tokenizer bounds:** truncate input to first 2000 chars, cap output at 200 terms (T-02-02 mitigation).
- **`ensurePersistence()` never throws:** module once-flag, `globalThis.navigator` feature-detect, try-catch returning false outside browsers, never awaited on critical paths.

## Verification Outcomes

- `bun run test -- src/lib/db` — 3 files, 12 tests, all pass
- `bun run test` (full suite) — 8 files, 117 tests, all pass
- `bun run typecheck` — exit 0
- `bunx biome check src/lib/db` — clean, no findings
- No unbounded reads: no `toArray()` in production code under `src/lib/db` (test-only, all `limit()`-scoped)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong relative import in db.ts**
- **Found during:** Tracer task, first test run
- **Issue:** `../../parser/types` does not resolve from `src/lib/db/`; typecheck failed
- **Fix:** Corrected to `../parser/types`
- **Commit:** 820535d

**2. [Rule 1 - Bug] Dexie IndexSpec property name in schema assertion**
- **Found during:** Tracer task, first test run
- **Issue:** Test asserted `idx.multiEntry`, but Dexie's `IndexSpec` exposes the flag as `multi`; assertion failed and typecheck errored
- **Fix:** Assert `idx.multi === true`
- **Commit:** 820535d

**3. [Rule 3 - Blocking] Biome `noNonNullAssertion` + import sort + format**
- **Found during:** Unit-test task verify (`bunx biome check` reported 3 errors)
- **Issue:** `db!` non-null assertion inside tracer transaction; unsorted import; long format lines
- **Fix:** Narrowed `db` into a typed local `database` const; `biome check --write` for sort/format
- **Commit:** b0a0f52

Or: checkpoint gate (package legitimacy for dexie/fake-indexeddb) was pre-approved by the user this session per executor instructions — installs ran via `bun add` only.

## Known Stubs

None — tracer slice is complete; repositories/pagination/migration are explicitly later plans, not stubs.

## Threat Flags

None — all threat-register mitigations applied (T-02-01 human gate pre-approved; T-02-02 truncation+cap in tokenize.ts; T-02-03 version(1) block fresh, never edited).

## Self-Check: PASSED

- All 8 created files exist on disk
- Commits 820535d and b0a0f52 exist in git log
- Full test suite (117), typecheck, and Biome all green
