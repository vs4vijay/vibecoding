# Phase 02: Storage Layer - Research

**Researched:** 2026-09-06
**Domain:** Client-side persistence — IndexedDB via Dexie.js v4, batch ingestion, keyset pagination, word-token multiEntry search index
**Confidence:** HIGH (schema/bulk/pagination/test-shim all confirmed against official Dexie docs + MDN fetched this session)

## Summary

Phase 02 persists Phase 01 parser output (`Message` with epoch-ms `timestamp`, `dedupHash`, `type`/`mediaType`; `Chat` aggregate, both in `src/lib/parser/`) into IndexedDB behind Dexie.js v4. The recommended schema is two tables: `chats` (auto-increment `++id`, indexes on `name`/`importedAt`) and `messages` (`++id` primary key, compound `[chatId+timestamp]` index for windowed reads, multiEntry `*terms` index for keyword search). Dexie's schema-string syntax supports exactly this combination — compound and multiEntry indexes are both first-class, with the single documented limitation that a compound index itself cannot be multiEntry [CITED: https://dexie.org/docs/Version/Version.stores()] [CITED: https://dexie.org/docs/MultiEntry-Index].

Bulk ingestion uses `bulkPut()` in chunks of 500–1000 inside one `db.transaction('rw', ...)` per chunk, catching `BulkError` per chunk so one duplicate `dedupHash` does not abort the whole import [CITED: https://dexie.org/docs/Table/Table.bulkPut()]. Reads use keyset pagination on the compound index (`where('[chatId+timestamp]').below/above(...)`), never `offset().limit()` for deep pages and never `getAll()`/`toArray()` on the full store — Dexie's own docs state `offset(N)` cost is proportional to N and "not well-suited to paging in general" [CITED: https://dexie.org/docs/Collection/Collection.offset()]. Unit tests run under the existing Vitest 3.x setup with the `fake-indexeddb` shim (`import 'fake-indexeddb/auto'` in a setup file); `navigator.storage.persist()` is fire-and-forget behind a `typeof navigator` guard so tests and non-secure contexts degrade gracefully [CITED: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist].

**Primary recommendation:** Subclass `Dexie` with `EntityTable`-typed tables (`chats`, `messages` with `[chatId+timestamp]` + `*terms`), ingest via chunked `bulkPut` in explicit `rw` transactions, paginate via compound-index keyset cursors, tokenize into `terms` with a shared pure `tokenize()` helper, and test with `fake-indexeddb/auto`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMPR-06 | System stores all data locally in IndexedDB | Dexie v4 schema + transactions + bulk APIs below; all client-side, no server |
| SC-1 | `chats` + `messages` tables, compound `[chatId+timestamp]` index, multiEntry `*terms` index | Schema sketch §Architecture Patterns Pattern 1; syntax per stores() + MultiEntry docs |
| SC-2 | Bulk inserts of 500–1000 messages per transaction, no per-message transactions | Pattern 2 chunked `bulkPut` in one `rw` transaction per chunk |
| SC-3 | Cursor-based pagination, never `getAll()` on full message store | Pattern 3 keyset pagination on compound index; `offset()` rejected per official perf notes |
| SC-4 | `navigator.storage.persist()` requested on first data write | Pattern 5 guarded fire-and-forget helper |
| SC-5 | Database versioning + migration path for future schema changes | Pattern 4 `version(2).stores(...).upgrade()` example |

## Project Constraints (from AGENTS.md)

- **Use `bun` instead of `npm`** — all installs/run commands use `bun add`, `bun run`, `bunx`. (Never `npm install`.)
- **TypeScript strict, ES2022 target** (`tsconfig.json`: `strict: true`, `target ES2022`, `moduleResolution bundler`). Dexie typings must satisfy `strict` (explicit entity interfaces, no implicit any).
- **Lint/format with Biome** (`biome check`) — storage code must pass `bun run lint`.
- **Tests with Vitest 3.x** (`bun run test` = `vitest run`) — new `fake-indexeddb` shim wires into this; no Jest, no Playwright needed for this phase.
- **No SvelteKit scaffold yet** — storage layer must be framework-free pure TS under `src/lib/` (importable later by SvelteKit or anything else). Do not introduce Svelte dependencies.
- Root repo convention (parent AGENTS.md): web games follow `docs/GAMES.md` — not applicable to RagChat; ignore.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Message/chat persistence, indexes | Browser / Client (IndexedDB) | — | Single-user local-first app; no backend exists or is wanted (IMPR-06) |
| Full-text keyword search (v1, `*terms`) | Browser / Client (Dexie multiEntry query) | — | Phase 02 scope is keyword search only; Orama/RAG is a later phase and must not be introduced here |
| Storage durability (`persist()`) | Browser / Client (StorageManager API) | — | Browser grants persistence per-origin; nothing to do server-side |
| Schema migration | Browser / Client (Dexie versioning) | — | IndexedDB upgrade transactions run in the browser that owns the data |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `dexie` [VERIFIED: npm registry + official docs] | 4.4.5 (latest 2026-08-14, ~1.95M downloads/wk) | IndexedDB wrapper: schema, transactions, bulk ops, queries | Project-blessed in STACK.md; WhatsApp Web itself uses Dexie patterns; v4 adds `EntityTable` typing; actively maintained (release < 1 month old at research time) |
| `fake-indexeddb` [ASSUMED — name from community sources, version verified on registry] | 6.2.5 (latest 2025-11-07) | In-memory IndexedDB implementation for Vitest/Node tests | De-facto standard shim for testing Dexie/idb code in Node; `fake-indexeddb/auto` one-line global install is the documented pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none — stdlib only) | — | Tokenizer, chunking helper | `tokenize()` and `chunk()` are ~15-line pure functions; no dependency warranted |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dexie.js | `idb` (Jake Archibald) | ~1 KB vs ~26 KB, but no schema versioning/migration API — SC-5 would be hand-built. Reject. |
| Dexie.js | Raw IndexedDB | Enormous boilerplate, manual transaction lifetime management. Reject. |
| `fake-indexeddb` | Real headless browser (Playwright) | Heavier, slower; unnecessary for repository unit tests. Playwright stays reserved for later E2E import-flow tests. |

**Installation:**
```bash
bun add dexie
bun add -D fake-indexeddb
```

**Version verification:** `bunx npm view dexie version` → `4.4.5`, `time.modified 2026-08-14` [VERIFIED: npm registry]. `bunx npm view fake-indexeddb version` → `6.2.5`, `time.modified 2025-11-07` [VERIFIED: npm registry]. (Note: `gsd-tools query package-legitimacy check` could not run — `gsd-tools` binary not on PATH in this environment — so legitimacy verdicts below are signal-based, and installs should be human-verified at plan time.)

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `dexie` | npm | ~12 yrs (since 2014, org Awarica AB) | ~1.95M/wk | github.com/dexie/Dexie.js (13k+ stars) | OK | Approved — official docs at dexie.org confirm this is the canonical package |
| `fake-indexeddb` | npm | ~7+ yrs, v6.2.5 Nov 2025 | high (standard test dep across ecosystem) | github.com/dumbmatter/fakeIndexedDB | OK (signal-based) | Approved with checkpoint — seam gate unavailable; planner adds `checkpoint:human-verify` before install |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious (SUS):** none (no SUS signals observed; `fake-indexeddb` checkpoint is procedural, not suspicion-driven, because the automated legitimacy seam could not run here)

*`fake-indexeddb` as a package name is [ASSUMED] (sourced from community docs/discussions, not Dexie official docs — Dexie issue #790 acknowledges it as a known-compatible implementation, which corroborates but does not officially bless it). The planner must gate its install behind a `checkpoint:human-verify` task.*

## Architecture Patterns

### System Architecture Diagram

```
WhatsApp .txt export
        │
        ▼
Phase 01 parser (src/lib/parser/) ──► Message[] + Chat aggregate (in memory)
        │
        ▼ (import path)
┌───────────────────────────────────────────────┐
│ Storage layer (src/lib/storage/ — NEW, pure TS)│
│                                                │
│  tokenize(text) ──► terms: string[]            │
│        │                                       │
│        ▼                                       │
│  ChatRepository.saveChat()  (chats table)      │
│  MessageRepository.bulkSave() (500–1000/chunk, │
│     one rw transaction per chunk)              │
│        │                                       │
│        ▼                                       │
│  ┌─────────────┐   ┌────────────────────────┐  │
│  │ chats table │   │ messages table         │  │
│  │ ++id, name, │   │ ++id, [chatId+         │  │
│  │ importedAt  │   │ timestamp], *terms,    │  │
│  │             │   │ &dedupHash             │  │
│  └─────────────┘   └────────────────────────┘  │
│        ▲                                       │
│  MessageRepository.getWindow()/searchTerms()   │
│  (keyset pagination on compound index)         │
└───────────────────────────────────────────────┘
        │
        ▼
navigator.storage.persist() (once, first write)
```

File-to-implementation mapping belongs in PLAN.md; proposed module split (`db.ts`, `tokenize.ts`, `repositories.ts`, `persistence.ts`) is in Pattern notes below.

### Recommended Project Structure
```
src/lib/
├── parser/              # Phase 01 (exists — DO NOT modify)
└── storage/             # Phase 02 (new)
    ├── db.ts            # RagChatDB extends Dexie, v1 schema, EntityTable types
    ├── tokenize.ts      # Pure tokenize() helper (shared by writer + tests)
    ├── repositories.ts  # ChatRepository + MessageRepository (bulk/pagination/search)
    ├── persistence.ts   # ensurePersistence() guard wrapper
    └── __tests__/
        ├── setup.ts         # import 'fake-indexeddb/auto' (+ indexedDB deleteDatabase reset)
        ├── repositories.test.ts
        └── tokenize.test.ts
```

### Pattern 1: Dexie v4 schema with compound + multiEntry indexes
**What:** Single `version(1).stores()` declaration; `++id` auto-increment primary keys; `[chatId+timestamp]` compound index for ordered windowed reads; `*terms` multiEntry index over a precomputed string array; `&dedupHash` unique index for idempotent re-imports. [CITED: https://dexie.org/docs/Version/Version.stores()] [CITED: https://dexie.org/docs/MultiEntry-Index]
**When to use:** Always — this is the v1 schema.
**Example:**
```typescript
// Source: schema-string syntax per https://dexie.org/docs/Version/Version.stores()
// and multiEntry semantics per https://dexie.org/docs/MultiEntry-Index
import Dexie, { type EntityTable } from 'dexie';

export interface ChatRecord {
  id?: number;            // auto-increment (optional on insert — EntityTable rule)
  name: string;
  importedAt: number;     // epoch ms
  messageCount: number;
  participants: string[]; // NOT indexed (arrays of names need no index in v1)
}

export interface MessageRecord {
  id?: number;
  chatId: number;         // foreign key → ChatRecord.id (logical; IndexedDB has no FK enforcement)
  timestamp: number;      // epoch ms, from parser Message.timestamp
  sender: string;
  text: string;           // full text STORED but NOT indexed (see Pitfall 1)
  type: MessageType;
  mediaType?: MediaType;
  dedupHash: string;      // unique — enables idempotent re-import via bulkPut
  terms: string[];        // lowercased word tokens — THE indexed search field
}

export class RagChatDB extends Dexie {
  chats!: EntityTable<ChatRecord, 'id'>;
  messages!: EntityTable<MessageRecord, 'id'>;

  constructor(name = 'ragchat') {
    super(name);
    this.version(1).stores({
      chats: '++id, name, importedAt',
      // compound index [chatId+timestamp] = ordered per-chat reads;
      // *terms = multiEntry keyword index; &dedupHash = unique idempotency key
      messages: '++id, chatId, timestamp, [chatId+timestamp], *terms, &dedupHash',
    });
  }
}
```
**Notes for planner:**
- `EntityTable<T, 'id'>` (new in Dexie 4) makes `id` optional on `add()`/`put()` inputs but required on reads — use it instead of legacy `Table` generics [CITED: https://dexie.org/docs/EntityTable].
- `chatId` and `timestamp` are also declared as single indexes (cheap, enables `where('chatId')` fallbacks); the compound index is what pagination actually uses.
- A compound index **cannot** be multiEntry (IndexedDB limitation) — hence `terms` is a separate single-field multiEntry index, not part of the compound key [CITED: https://dexie.org/docs/MultiEntry-Index].
- Only index what appears in a `where()`/`orderBy()` clause (official rule of thumb); `text`, `sender`, `participants` stay unindexed in v1 [CITED: https://dexie.org/docs/Version/Version.stores()].

### Pattern 2: Chunked bulk write — one transaction per 500–1000 chunk
**What:** Split the message array into chunks; wrap each chunk's `bulkPut` in an explicit `db.transaction('rw', ...)`; catch `BulkError` per chunk (log `failures.length`, continue). Use `bulkPut` (upsert on `dedupHash`... see Pitfall 3 — upsert is on primary key; dedup handled by pre-query or unique-index catch) rather than `bulkAdd` for re-import tolerance. [CITED: https://dexie.org/docs/Table/Table.bulkPut()] [CITED: https://dexie.org/docs/Table/Table.bulkAdd()] [CITED: https://dexie.org/docs/Dexie/Dexie.transaction()]
**When to use:** Every import path; chunk size 500 (default) with 1000 as upper bound.
**Example:**
```typescript
// Source: bulkPut + BulkError semantics per https://dexie.org/docs/Table/Table.bulkPut()
const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkSaveMessages(db: RagChatDB, records: MessageRecord[]): Promise<void> {
  for (const c of chunk(records, CHUNK_SIZE)) {
    await db.transaction('rw', db.messages, async () => {
      // bulkPut = upsert by primary key; BulkError caught per-chunk so one
      // bad record aborts only its chunk-transaction, not the whole import.
      await db.messages.bulkPut(c).catch((e) => {
        if (e?.name === 'BulkError') {
          console.warn(`chunk: ${c.length - e.failures.length}/${c.length} written`);
        } else throw e;
      });
    });
  }
}
```
**Notes:** Do NOT `await` non-IDB work (fetch, crypto) inside the transaction callback — IndexedDB auto-commits when the transaction goes idle, causing `TransactionInactiveError` [CITED: https://dexie.org/docs/Dexie/Dexie.transaction()]. Compute tokens/hashes BEFORE opening the transaction. Parallelize chunks sequentially (not `Promise.all` over one Dexie instance's write tx) — parallel writes on the same store from one connection serialize anyway and complicate error attribution.

### Pattern 3: Keyset pagination on the compound index (no offset, no getAll)
**What:** Page with `where('[chatId+timestamp]').below/above([chatId, tsBoundary]).reverse().limit(n)`; the last item of each page supplies the next cursor. Initial (latest) page uses `.reverse().limit(n)` on the chat-scoped compound query. [CITED: https://dexie.org/docs/Collection/Collection.offset()] (documents why offset is unsuitable + endorses index-based paging)
**When to use:** All message-window reads (chat view, infinite scroll in both directions).
**Example:**
```typescript
// Keyset pagination — O(pageSize) per page regardless of depth.
// (offset(N) is O(N) per page and explicitly discouraged for paging:
//  "offset() is not well-suited to paging in general" — Collection.offset() docs)
export interface PageCursor { timestamp: number; id: number }

async function getLatestWindow(db: RagChatDB, chatId: number, limit: number) {
  return db.messages
    .where('[chatId+timestamp]').equals(chatId) // prefix match impossible — see Pitfall 2
    .reverse() // newest-first needs sort handling — see Pitfall 2 for exact form
    .limit(limit)
    .toArray();
}
```
⚠️ The sketch above is intentionally simplified — the exact query shape (compound `between([chatId, -Inf],[chatId, +Inf])` prefix + tiebreak on `id`) is detailed in **Pitfall 2**, which the planner must read before writing tasks. The normative rule: **cursor = `[timestamp, id]` pair; filter `below`/`above` on the compound key; `limit(n)`; never `offset()`; never unbounded `toArray()`**.

### Pattern 4: Versioned migration path (concrete v2 example)
**What:** Dexie ≥3 rule — keep version declarations that carry an `upgrade()` fn; plain index/table additions only need the version number bumped. Future v2 example: add a `sender` index + backfill a new field. [CITED: https://dexie.org/docs/Tutorial/Design] (Database Versioning section)
**When to use:** Any future schema change; ship the v2 skeleton as a commented example or a tested migration test — planner's call.
**Example:**
```typescript
// Source: upgrade pattern per https://dexie.org/docs/Tutorial/Design ("Database Versioning")
// Hypothetical v2: index sender + backfill a derived `day` field for date-grouped reads.
this.version(2).stores({
  messages: '++id, chatId, timestamp, [chatId+timestamp], *terms, &dedupHash, sender, day',
}).upgrade((tx) => {
  return tx.table('messages').toCollection().modify((msg) => {
    msg.day = new Date(msg.timestamp).toISOString().slice(0, 10); // backfill
  });
});
```
**Rules for planner:** (a) never edit the `version(1)` block after first release — add versions only; (b) new versions need only list *changed* tables; (c) dropping an index = omitting it in the new version; dropping a table = `tableName: null`; (d) upgrade errors roll back the whole upgrade transaction, so keep `modify()` callbacks pure and synchronous [CITED: https://dexie.org/docs/Tutorial/Design].

### Pattern 5: `navigator.storage.persist()` — guarded fire-and-forget
**What:** Feature-detect (`navigator.storage?.persist`), call once after the first successful write, never `await` it on the import critical path. Returns `Promise<boolean>`; browser may decline. Not available in workers; absent in Node/tests. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist]
**When to use:** Exactly once per fresh database (first import), then optionally re-check via `persisted()`.
**Example:**
```typescript
// Source: MDN example, hardened for test/SSR environments
// https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
let persistRequested = false;

export async function ensurePersistence(): Promise<boolean> {
  try {
    if (persistRequested) return true;
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return false; // Node/Vitest, workers, old browsers
    persistRequested = true;
    return await storage.persist(); // true = persistent, false = may be evicted
  } catch {
    return false; // opaque origin / storage disabled (TypeError) — non-fatal
  }
}
// Call AFTER first successful bulkSave, do not block import on it:
// void ensurePersistence().then((p) => console.info('persistent storage:', p));
```

### Anti-Patterns to Avoid
- **`offset().limit()` deep pagination:** cost ∝ N skipped; use keyset cursors (Pattern 3).
- **`toArray()` / `getAll()` on the whole `messages` store:** loads every record into memory; always scope by `chatId` + `limit()`.
- **Per-message `add()` in a loop:** one transaction per message is ~10–100× slower than chunked `bulkPut`; also risks half-written imports on failure.
- **Non-IDB awaits inside transactions:** `fetch`/timers between reads and writes → auto-commit → `TransactionInactiveError`. Precompute everything first.
- **Storing tokens but querying raw text:** queries must tokenize the query string with the same `tokenize()` fn (see Tokenization section).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IndexedDB promises/transactions/versioning | Custom IDB wrapper | Dexie.js v4 | Transaction lifetime, upgrade orchestration, compound/multiEntry query planning — years of edge cases |
| Test-time IndexedDB | In-memory mock of Dexie API | `fake-indexeddb` | A hand mock won't exercise real index semantics (compound ranges, multiEntry, uniqueness) — the exact things tests must verify |
| Persistent-storage permission | Custom quota/eviction logic | `navigator.storage.persist()` | Only the browser can grant durability; custom code can't influence eviction |
| Tokenizer with stemming/stopwords (v1) | NLP pipeline | 15-line `tokenize()` + later Orama | v1 needs keyword containment, not relevance ranking; Orama phase replaces it anyway |

**Key insight:** Every deceptively-complex piece here (transaction auto-commit, multiEntry query semantics, upgrade rollback) is already solved inside Dexie/IndexedDB. The storage layer's custom code should be: schema declaration, `tokenize()`, `chunk()`, two repository classes, one `ensurePersistence()` helper — everything else is Dexie API calls.

## Tokenization for the `*terms` multiEntry Index

**Approach (prescriptive):** store `terms: string[]` = `tokenize(message.text)` computed at import time, where:
```typescript
// Pure, framework-free, identical fn used at write time AND query time.
export function tokenize(text: string): string[] {
  const terms = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u) // unicode-aware: keeps accented letters, digits, CJK runs
    .filter((t) => t.length >= 2); // drop single chars (noise + index bloat)
  return [...new Set(terms)]; // dedupe within a message — multiEntry matches
                              // the same record once per distinct term anyway
}
```
- **Lowercase at write; lowercase the query too** (`where('terms').equals(tokenize(q)[0])`, multi-token queries via `anyOf(tokens).distinct()`). Case-insensitive operators (`equalsIgnoreCase`) force the slow JS-iteration path — avoid them [CITED: https://dexie.org/docs/Collection/Collection.offset()] (simple-vs-advanced query table).
- **Where it lives:** `src/lib/storage/tokenize.ts`, imported by the repository writer AND the search reader AND unit tests. Never duplicate the regex.
- **Size considerations:** index entries ≈ distinct terms/message (~20–60 for chat). 100K messages ≈ ~2–5M index keys — fine for IndexedDB. Cap risk: pathological messages (pasted logs/URLs) → truncate tokenization input to first ~2,000 chars and cap `terms` at ~200 entries/message [ASSUMED sizing — standard practice, not measured this session; planner should add a perf smoke test, not a hard requirement].
- **Non-text messages:** `media`/`system`/`call`/`deleted` types still get rows (timeline completeness) with `terms` derived from `text` if present else `[]`; sender-name search is out of scope for v1 (no `sender` index) — note as follow-up.
- **Always append `.distinct()`** on multiEntry queries — one record can match multiple keys and otherwise return duplicates [CITED: https://dexie.org/docs/MultiEntry-Index].
- **Do NOT index `text` itself** (see Pitfall 1). The `terms` array IS the search surface.

## Unit-Testing Dexie under Vitest (Node)

**Dev dependency:** `fake-indexeddb` (add with `bun add -D fake-indexeddb`; version 6.2.5 [VERIFIED: npm registry]).

**Setup (three options, in preference order):**
1. **Global setup file (recommended):** create `src/lib/storage/__tests__/setup.ts` containing `import 'fake-indexeddb/auto';` and reference it from a `vitest.config.ts` (`test.setupFiles`) — or, with no config file currently in repo, import it explicitly at the top of each Dexie test file. The `/auto` entry populates `globalThis.indexedDB` + `IDBKeyRange` so `new Dexie()` works unmodified [CITED: community-verified pattern — Jest/Vitest discussions + fake-indexeddb README; LOW-MEDIUM confidence on exact Vitest wiring, see Open Questions].
2. **Explicit injection (no globals):** `new Dexie('test', { indexedDB: fakeIndexedDB, IDBKeyRange: FDBKeyRange })` — avoids global mutation; useful if the repo later runs browser + node tests in one process.
3. **Per-test DB lifecycle:** unique DB name per test file (`new RagChatDB('test-' + randomUUID())`), `await db.delete()` in `afterEach`/`afterAll`. Never reuse the production `'ragchat'` name in tests. `fake-indexeddb` is in-memory only — no disk cleanup needed.

**Dexie configuration needed:** none beyond the shim — no flags, no plugins. Keep `tsconfig lib: ES2022` as-is; Dexie types compile under `strict` (verify with `bun run typecheck`).

**What to test (planner input):** schema opens at v1; chunked import of ~2,500 messages writes all rows; duplicate `dedupHash` re-import is idempotent; compound index returns newest-N window in order; keyset cursor pages without overlap/gaps; `terms` search finds case-insensitively; `persist()` helper returns `false` (not throw) under Node.

## Common Pitfalls

### Pitfall 1: Indexing the full `text` field
**What goes wrong:** Indexing a huge string creates a gigantic, unstable index; writes slow to a crawl, IDB can bloat or fail.
**Why it happens:** Intuition that "search needs the field indexed" — but multiEntry search indexes the *token array*, not the source text.
**How to avoid:** Schema indexes `*terms` only; `text` is stored unindexed. This is the official guidance: "Never index properties containing … large (huge) strings. Store them in IndexedDB, yes! but just don't index them!" [CITED: https://dexie.org/docs/Version/Version.stores()].
**Warning signs:** Import throughput collapses as message length grows; `.storage/estimate()` balloons disproportionately.

### Pitfall 2: Compound-index prefix queries and newest-first ordering need care
**What goes wrong:** `where('[chatId+timestamp]').equals(chatId)` doesn't work — compound `equals()` needs the full key tuple. `orderBy` + `reverse` on compound keys can silently sort by the wrong bound.
**Why it happens:** Compound keys sort lexicographically as tuples; a "chat prefix" is a *range*, not a point lookup.
**How to avoid:** Scope with `between([chatId, -Infinity], [chatId, Infinity])` (or `where('chatId').equals(chatId).sortBy('timestamp')` for small chats), apply `.reverse()` for newest-first, then `.limit(n)`. Cursor for next-older page = `[lastTimestamp, lastId]` with `.below(cursorTuple)`. Tiebreak concern: equal timestamps within a chat (same ms, e.g. rapid messages) — include `id` in the cursor comparison or sort in JS within equal-timestamp groups [ASSUMED — standard keyset practice; planner must cover same-ms messages in tests].
**Warning signs:** Pages with missing/duplicate messages at boundaries; newest-first returning oldest-first.

### Pitfall 3: `bulkPut` upserts on PRIMARY KEY, not on `&dedupHash`
**What goes wrong:** Expecting re-imported messages to dedupe automatically — they won't: auto-increment `id` differs, so `bulkPut` inserts duplicates; the unique `&dedupHash` index then throws `BulkError` (good) but the strategy must be deliberate.
**Why it happens:** Confusing "put = upsert" (true, but keyed on primary key) with "put = dedupe on my domain key."
**How to avoid:** Recommended: pre-query existing hashes for the chat (`where('dedupHash').anyOf(batchHashes).primaryKeys()`), filter them out, then `bulkAdd` the remainder. Fallback: `bulkPut` + catch `BulkError` and treat constraint failures as already-present. Either way, dedup is explicit repository logic, not automatic.
**Warning signs:** Message counts grow on every re-import of the same file.

### Pitfall 4: Awaiting non-IDB work inside a transaction
**What goes wrong:** `TransactionInactiveError` / premature commit mid-import.
**Why it happens:** IndexedDB auto-commits an idle transaction; any `await fetch()/crypto/timers` between DB ops lets it commit.
**How to avoid:** Tokenize/hash/chunk BEFORE `db.transaction(...)`; transaction body contains only Dexie ops chained with Dexie/native promises. [CITED: https://dexie.org/docs/Dexie/Dexie.transaction()].
**Warning signs:** Flaky `TransactionInactiveError` only on large imports.

### Pitfall 5: `offset()`-based or unbounded reads
**What goes wrong:** Chat view loads all messages (OOM/jank on 50K+ chats) or deep pages get linearly slower.
**Why it happens:** `toArray()` without `limit`, or `offset(page*n).limit(n)`.
**How to avoid:** Keyset cursors (Pattern 3); every read path ends in `.limit(n)`; code-review rule: no `toArray()` without a preceding `limit()` or explicit `// full-scan justified` comment.
**Warning signs:** UI freeze on large chats; tests passing on 100 rows but failing on 10K.

### Pitfall 6: Forgetting `distinct()` on `*terms` queries
**What goes wrong:** Same message appears multiple times in search results.
**Why it happens:** MultiEntry matches one record per matching key.
**How to avoid:** Always chain `.distinct()` after multiEntry `where()` clauses [CITED: https://dexie.org/docs/MultiEntry-Index].

## Code Examples

### Chat + first message chunk, transactional (import entry point)
```typescript
// Orchestration sketch — precompute everything, then transact.
import { parseString } from '../parser/index.js';
import { tokenize } from './tokenize.js';

async function importChatText(db: RagChatDB, name: string, raw: string): Promise<number> {
  const chat = parseString(raw); // Phase 01 — pure, no DB inside
  const chatId = await db.chats.add({
    name, importedAt: Date.now(),
    messageCount: chat.messageCount, participants: chat.participants,
  });
  const records: MessageRecord[] = chat.messages.map((m) => ({
    chatId: chatId as number,
    timestamp: m.timestamp, sender: m.sender, text: m.text,
    type: m.type, mediaType: m.mediaType, dedupHash: m.dedupHash,
    terms: tokenize(m.text),
  }));
  await bulkSaveMessages(db, records); // Pattern 2
  void ensurePersistence(); // Pattern 5 — fire-and-forget, SC-4
  return chatId as number;
}
```

### Keyword search over `*terms`
```typescript
// Source: query semantics per https://dexie.org/docs/MultiEntry-Index
async function searchMessages(db: RagChatDB, query: string, limit = 50) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return db.messages
    .where('terms').anyOf(tokens) // OR semantics across tokens
    .distinct()                   // required for multiEntry (Pitfall 6)
    .limit(limit)
    .toArray();
}
```

### Vitest setup file
```typescript
// src/lib/storage/__tests__/setup.ts
import 'fake-indexeddb/auto'; // installs global indexedDB + IDBKeyRange for Node
```
```typescript
// vitest.config.ts (new file — planner: create in Wave 0)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { setupFiles: ['src/lib/storage/__tests__/setup.ts'] },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Table<T, Key>` generics | `EntityTable<T, 'id'>` | Dexie 4 (2024) | Insert types get optional PK for free; use EntityTable in all new code |
| Keep ALL old `version()` blocks forever | Keep only versions carrying `upgrade()` fns (Dexie ≥3/4) | Dexie 3 | v1 block here has no upgrader → a future v2 can subsume it; still: never *edit* v1 after release |
| `offset().limit()` paging | Keyset/index paging | Long-standing guidance, reaffirmed 2021 | Offset cost ∝ N; keyset is O(page) |
| localForage / raw IDB | Dexie v4 | Project decision (STACK.md) | Locked — not revisited |

**Deprecated/outdated:**
- Dexie v2/v3 APIs (`Table` generics style, `db.open()` manual handling) — use v4 `EntityTable` + auto-open. Do NOT install `dexie@3`.
- `whatsapp-chat-parser` npm package — already rejected in STACK.md; parser stays Phase-01 custom code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fake-indexeddb` (name, API `fake-indexeddb/auto`) is the right shim — sourced from community docs, not Dexie official docs | Standard Stack, Testing | LOW — widely used, but planner's human-verify checkpoint confirms before install |
| A2 | 500–1000/chunk is a good batch size (Dexie docs demo 100K-row bulk ops without chunking, but chunking bounds transaction size/memory) | Pattern 2 | LOW — chunk size is tunable; tests will confirm throughput |
| A3 | `terms` capped ~200/message + 2,000-char tokenize window is sufficient | Tokenization | LOW — only affects pathological messages; smoke test validates |
| A4 | Same-millisecond messages need `id` tiebreak in cursor | Pitfall 2 | MEDIUM — if parser timestamps collide often, pagination tests will catch; design already includes cursor pair |
| A5 | Vitest `setupFiles` wiring works with `fake-indexeddb/auto` under this repo's Vitest 3.x (no config file yet) | Testing | LOW — fallback is per-file import; both are standard |

## Open Questions

1. **Vitest setup-file vs per-file shim import**
   - What we know: `fake-indexeddb/auto` global install is the documented pattern for Jest; Vitest community reports confirm `setupFiles` works.
   - What's unclear: repo has no `vitest.config.ts` yet — whether planner prefers creating one (recommended) or per-file imports.
   - Recommendation: create `vitest.config.ts` in Wave 0 with `setupFiles`; it will be needed for future phases anyway.
2. **Sender-name search in v1?**
   - What we know: SC only requires `*terms` on message text.
   - What's unclear: whether searching "messages by Alice" matters for v1 UX.
   - Recommendation: out of scope — record as deferred; a `sender` index is a trivial v1.1 `version(2)` addition (Pattern 4 example already shows it).
3. **Orama index persistence interplay**
   - What we know: a later phase adds Orama; Orama can persist a serialized index into Dexie.
   - What's unclear: nothing for Phase 02 — just don't design anything that blocks it.
   - Recommendation: no action; `terms` tokens can seed the Orama index later.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun | installs, test, typecheck | ✓ | 1.3.14 | — |
| node | Vitest runtime | ✓ | v24.15.0 | — |
| IndexedDB (browser) | runtime persistence | ✗ (Node env) | — | `fake-indexeddb` in tests; real IDB in browser at runtime |
| `navigator.storage.persist` | SC-4 | ✗ (Node env) | — | guarded helper returns `false`; real behavior in browser |

**Missing dependencies with no fallback:** none (all runtime APIs are browser-native; all test gaps closed by `fake-indexeddb`).
**Missing dependencies with fallback:** browser IndexedDB/`persist` under Node → `fake-indexeddb` + guard (planned, not a blocker).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (existing, `bun run test` = `vitest run`) |
| Config file | none — see Wave 0 (`vitest.config.ts` with `setupFiles`) |
| Quick run command | `bun run test -- src/lib/storage` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMPR-06 | Messages persist and re-load across DB close/reopen | integration (fake-indexeddb) | `bun run test -- src/lib/storage/__tests__/repositories.test.ts` | ❌ Wave 0 |
| SC-1 | Schema has `[chatId+timestamp]`, `*terms`, `&dedupHash` indexes; ordered window correct | integration | same file — `db.messages.schema` assertions + window query test | ❌ Wave 0 |
| SC-2 | 2,500-msg import completes; all rows present; single chunk failure doesn't lose prior chunks | integration | same file — bulk import test | ❌ Wave 0 |
| SC-3 | Keyset pages cover N messages with no overlap/gaps; no unbounded `toArray` in src | integration + lint rule (grep) | same file + `grep -rn "toArray()" src/lib/storage --include=*.ts` review | ❌ Wave 0 |
| SC-4 | `ensurePersistence()` returns boolean, never throws, under Node (no navigator) | unit | `bun run test -- src/lib/storage/__tests__/persistence.test.ts` | ❌ Wave 0 |
| SC-5 | v2 upgrade example migrates v1 data (backfill) without loss | integration | `bun run test -- src/lib/storage/__tests__/migration.test.ts` (deferred ok) | ❌ Wave 0 (optional) |
| Tokenizer | lowercases, dedupes, unicode-safe, `[]` on empty | unit | `bun run test -- src/lib/storage/__tests__/tokenize.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test -- src/lib/storage` + `bun run typecheck`
- **Per wave merge:** `bun run test` (full) + `bun run lint`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` — `setupFiles` pointing at storage test setup
- [ ] `src/lib/storage/__tests__/setup.ts` — `import 'fake-indexeddb/auto'`
- [ ] `src/lib/storage/__tests__/tokenize.test.ts` — covers tokenizer
- [ ] `src/lib/storage/__tests__/repositories.test.ts` — covers IMPR-06, SC-1..SC-3
- [ ] `src/lib/storage/__tests__/persistence.test.ts` — covers SC-4
- [ ] Framework install: `bun add dexie` + `bun add -D fake-indexeddb` (behind `checkpoint:human-verify`)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user local app, no accounts |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Same-origin IndexedDB isolation is browser-enforced |
| V5 Input Validation | yes | `tokenize()` operates on already-parsed strings; parser output treated as untrusted for index-size purposes → truncate + cap terms (Tokenization section) |
| V6 Cryptography | no | `dedupHash` is an integrity/dedup key, not a security control — never present it as one |

### Known Threat Patterns for Dexie/IndexedDB local-only stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Maliciously crafted import file (giant lines → index bloat / OOM) | Denial of service | Parser caps (Phase 01 `capWarning`) + tokenizer truncation/term-cap; chunked writes bound transaction memory |
| Cross-origin data access | Information disclosure | Browser same-origin policy on IndexedDB — no action; do not weaken with shared workers across origins |
| Stale schema after downgrade (user runs old build against v2 DB) | Tampering / availability | Never edit released version blocks; Dexie throws on version regression rather than corrupting — surface the error, don't catch-and-ignore |

## Sources

### Primary (HIGH confidence)
- Dexie `Version.stores()` schema syntax — https://dexie.org/docs/Version/Version.stores/ — compound `[A+B]`, `*` multiEntry, `&` unique, "don't index huge strings" rule
- Dexie MultiEntry Index — https://dexie.org/docs/MultiEntry-Index — `*` marking, `equals`/`anyOf` query semantics, mandatory `.distinct()`, compound-can't-be-multiEntry limit
- Dexie `Table.bulkPut()` / `Table.bulkAdd()` — https://dexie.org/docs/Table/Table.bulkPut() + /Table.bulkAdd() — upsert semantics, BulkError partial-failure model
- Dexie `Dexie.transaction()` — https://dexie.org/docs/Dexie/Dexie.transaction/ — modes, auto-commit/idle rule, nested transactions
- Dexie Database Versioning (`Tutorial/Design`) — https://dexie.org/docs/Tutorial/Design — upgrade() + modify() pattern, version-keeping rules
- Dexie `Collection.offset()` — https://dexie.org/docs/Collection/Collection.offset/ — O(N) offset cost, "not well-suited to paging", index-based paging endorsement
- MDN `StorageManager.persist()` — https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist — feature-detect example, secure-context/worker notes
- npm registry (via `bunx npm view`, 2026-09-06): `dexie@4.4.5` (modified 2026-08-14, ~1.95M/wk, Apache-2.0); `fake-indexeddb@6.2.5` (modified 2025-11-07)

### Secondary (MEDIUM confidence)
- Dexie `EntityTable` docs — https://dexie.org/docs/EntityTable — v4 typing helper (found via web search, corroborated by npm latest v4)
- fake-indexeddb README + Vitest/Jest community discussions — `fake-indexeddb/auto` global-shim pattern, Dexie compatibility (community sources, consistent across 3+ independent reports)

### Tertiary (LOW confidence)
- Tokenizer size caps (~200 terms, 2,000-char window) — standard practice, not measured; needs smoke test (A3)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions registry-verified; Dexie officially documented; only `fake-indexeddb` name is assumed (procedural checkpoint, not a risk signal)
- Architecture: HIGH — schema/bulk/pagination/migration all confirmed against official Dexie docs fetched this session
- Pitfalls: HIGH — 4 of 6 pitfalls cite official docs; remaining 2 are standard keyset/idempotency practice flagged as assumed
- Testing: MEDIUM — shim pattern is community-corroborated but not officially blessed; two wiring options given with fallback

**Research date:** 2026-09-06
**Valid until:** ~30 days (Dexie 4.x is stable; re-check only if `dexie@5` appears)
