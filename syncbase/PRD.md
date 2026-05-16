# PRD: syncbase

*Stateful API Ingest with DB-Layer Versioning*

| | |
|---|---|
| **Status** | Draft v1 |
| **Author** | viz |
| **Date** | 2026-05-13 |
| **Codename** | **syncbase** — *snaps the state of an API and keeps every version* |

---

## 1. Problem Statement

We need a lightweight system that periodically pulls data from a growing set of HTTP APIs and lands it in a versioned store. The store must distinguish three states per record on every run:

- **new** — first time we've seen this entity → store it
- **changed** — content differs from what we last saw → snapshot the prior version, store the new one
- **unchanged** — content is byte-identical → write nothing, do nothing

Doing this in application code at scale is fragile (diff bugs, ORM races, partial writes) and means every new API requires bespoke ingest logic. We want the versioning logic to live in the **database layer** so it's transactional, atomic, and identical for every source. Adding a new API source should require **config, not code**.

syncbase lets each source decide whether its data lands in a **shared generic table** (zero DDL, JSONB-only) or in its **own dedicated typed table** (per-source schema, named columns) — with identical versioning behavior either way.

A small admin surface (CLI + web app) lets a human inspect what's been ingested, browse history, watch a live change feed, and manage schedules.

## 2. Goals

| # | Goal |
|---|---|
| G1 | Pull from arbitrary REST APIs on a schedule and adhoc |
| G2 | Detect and version changes **inside the database** (not the app) |
| G3 | Skip unchanged records with zero writes — runs against an idle source must produce no new rows |
| G4 | Adding a new API source = inserting one row of config (no code edits, no redeploy) |
| G5 | Surface changes as both a **durable outbox** (queryable history) and a **live feed** (push notifications) |
| G6 | Provide a web UI and a CLI sharing one codebase |
| G7 | Run identically against real Postgres (prod) and embedded PGLite (dev/test), behind an ORM abstraction |
| G8 | Stay lightweight — single deployable, no message broker, no external scheduler |
| **G9** | **Per-source storage choice — generic shared table or dedicated typed table, picked by the operator when creating the source** |

## 3. Non-Goals

- Not a full ETL platform — no transformations, joins, or warehouse modeling.
- Not a data sync product like Airbyte/Fivetran — no connector marketplace, no managed cloud.
- Not a CDC tool for *outgoing* changes — we ingest from external APIs only.
- No support for GraphQL or streaming source protocols in v1 (REST GETs only).
- No multi-tenant isolation. Single team, single namespace.

## 4. Users & Use Cases

| Persona | Use Case |
|---|---|
| **Operator** (the dev running syncbase) | Add a new API source via the web UI in <5 min; pick storage mode; verify it parses via "Test"; save. |
| **Analyst / Investigator** | Browse current entities; inspect a specific entity's version history; diff two versions side-by-side; subscribe to a live feed of changes. |
| **Automation consumer** | Subscribe (via SSE or polling `change_log`) to events for downstream processing — alerts, Slack messages, webhooks. |
| **CLI user** | Run `bun bin/cli.ts run --source X` in a script, ad-hoc cron, or CI job. |

## 5. Functional Requirements

### 5.1 Source Management
- **FR-1** Create / edit / delete an API source via REST API and web UI.
- **FR-2** A source consists of: `name`, HTTP config (method, url, headers, params, auth), pagination config, `external_id_path`, `records_path`, `hash_fields` (optional subset of keys that defines "changed"), `schedule_cron`, **`storage_mode`** (`generic` | `dedicated`), and `typed_columns` (optional list of `{name, jsonpath, sql_type, indexed}`).
- **FR-3** "Test" action fetches the first page only, parses, returns up to 5 records without writing to the DB.
- **FR-4** Toggle `enabled` flag without deleting; disabled sources can't be run.

### 5.2 Storage Modes (the hybrid)
- **FR-5** When `storage_mode = 'generic'`, the source writes to the shared `entities` table keyed by `(source, external_id)`.
- **FR-6** When `storage_mode = 'dedicated'`, syncbase auto-creates a per-source table `entities_<source_slug>` with the standard versioning columns plus the source's `typed_columns`. A paired `entities_<source_slug>_versions` table is created the same way.
- **FR-7** `typed_columns` are realized as `GENERATED ALWAYS AS (payload->>'<jsonpath>') STORED`, optionally indexed. They work in both storage modes.
- **FR-8** The versioning trigger function is **table-agnostic** (uses `TG_TABLE_NAME`); the same function is attached to the shared `entities` table and to every dedicated table.
- **FR-9** Switching a source's `storage_mode` after creation is **not supported in v1** (it would require data migration). It's a create-time decision.

### 5.3 Ingestion
- **FR-10** Adhoc trigger: `POST /api/sources/:id/run` and `bun bin/cli.ts run --source NAME` produce identical results via the same code path.
- **FR-11** Scheduled trigger: cron expressions per source; the **same** code path is invoked.
- **FR-12** Support pagination styles: `none`, `page` (`?page=N`), `cursor` (JSONPath into response), `link_header` (RFC 8288).
- **FR-13** Each run is recorded in a `runs` table with start/end timestamps, status, and per-state counts (`records_seen`, `records_created`, `records_updated`, `records_skipped`).

### 5.4 Versioning (DB layer)
- **FR-14** A record with content identical to the current version (by hash) MUST result in zero new rows and zero notifications.
- **FR-15** A record with content differing from the current version MUST: snapshot the prior version into the paired `*_versions` table (append-only), update the live row, bump `version_num`, write one row to `change_log`, fire one `pg_notify`.
- **FR-16** A record for a new `(source, external_id)` MUST: insert into the storage table, write one `change_log` row (`change_type='created'`), fire one `pg_notify`.
- **FR-17** Hash computation MUST be deterministic across runs given the same input (canonical JSON, sorted keys, stable separators).
- **FR-18** When `hash_fields` is set, only those keys participate in the hash — changes to fields outside the subset are intentionally ignored.

### 5.5 Notifications
- **FR-19** Every change is recorded as one row in `change_log` (durable outbox), regardless of storage mode.
- **FR-20** Every change emits one `pg_notify('entity_changed', payload)`.
- **FR-21** Web UI exposes a Server-Sent Events stream at `/api/changes/stream` that surfaces NOTIFY payloads in <1s.
- **FR-22** `change_log.consumed_at` tracks consumption; SSE is an optimization, not the source of truth.

### 5.6 Web App
- **FR-23** Pages: dashboard, sources list/edit, runs history, entity browser, entity history+diff, live changes feed, schedule manager.
- **FR-24** JSON editor (Monaco/CodeMirror) for source HTTP config with schema validation.
- **FR-25** Source-creation form has a clear toggle between `generic` and `dedicated`; dedicated mode reveals the `typed_columns` builder.
- **FR-26** Side-by-side diff viewer for any two versions of an entity, working on both generic and dedicated storage.
- **FR-27** Entity browser respects storage mode — filters and search use typed columns when available.

### 5.7 CLI
- **FR-28** Commands: `dev`, `api`, `worker`, `run`, `sources [list|add|edit|rm]`, `changes [--since|--watch]`, `history`, `init`, `migrate-source <name>` (re-applies DDL for a dedicated source).
- **FR-29** CLI commands share library code with web routes; behavior must match.

## 6. Non-Functional Requirements

| # | Requirement |
|---|---|
| NFR-1 | **Idempotent**: re-running the same source against unchanged upstream data is a no-op. |
| NFR-2 | **Transactional**: a partial run failure rolls back; no zombie `change_log` rows. DDL for dedicated sources runs in a single transaction. |
| NFR-3 | **Portable**: identical behavior against Postgres (prod) and PGLite (dev/test) for both storage modes. One env var swap. |
| NFR-4 | **Single deployable**: one Bun process (or two if you separate worker from web). No message broker. |
| NFR-5 | **Bun + AGENTS.md compliance**: `bun` not `npm`. Match repo conventions. |
| NFR-6 | **Latency**: SSE delivery <1s under normal load; ingest throughput limited by upstream API. |
| NFR-7 | **Observability**: every run leaves a `runs` row; every change leaves a `change_log` row. Every DDL operation logs to a `ddl_log` table for audit. |
| NFR-8 | **DDL safety**: runtime DDL (for dedicated tables) only via the controlled migration path; the API never accepts free-form SQL. |

## 7. Technical Design

### 7.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | **Next.js (App Router)** on **Bun** | Route Handlers cover REST + SSE; one runtime; no separate backend service. |
| DB access | **Drizzle ORM** | First-class PGLite driver, same schema as Postgres, raw SQL escape hatch for triggers and runtime DDL. |
| Prod DB | **Postgres** + `pg_cron` | JSONB, generated columns, LISTEN/NOTIFY, in-DB scheduling. |
| Dev/test DB | **PGLite** (`@electric-sql/pglite`) | Embedded WASM Postgres; same dialect. |
| Scheduler | `pg_cron` (PG) / `croner` (PGLite) | Abstracted behind a `Scheduler` interface. |
| Worker + CLI | Bun scripts importing `lib/` | Same code as Next.js routes. |
| HTTP client | `ofetch` | Retries, timeouts. |
| Validation | `zod` | Source configs validated before save. |
| CLI framework | `citty` | Typed argv. |
| JSON paths | `jsonpath-plus` | Path resolution. |
| Diff viewer | `deep-object-diff` + React diff component | For entity version comparison. |

### 7.2 Architecture

```
+---------------------------------+
|     Next.js (Bun runtime)       |    <-- single deployable
|                                  |
|  app/                            |
|    (admin UI pages)              |
|    api/sources, runs, entities,  |    <-- Route Handlers (REST)
|        changes/stream (SSE)      |
|                                  |
|  lib/                            |    <-- shared with worker + CLI
|    db/   (Drizzle + driver swap) |
|    pipeline/ (fetch + upsert)    |
|    scheduler/ (pg_cron | croner) |
|    ddl/      (runtime migration  |
|              for dedicated mode) |
+---------------------------------+
            ^             ^
            | imports     | imports
+-----------+----+   +----+-----------------+
| bin/cli.ts     |   | bin/worker.ts        |
+----------------+   +----------------------+
            \         /
             v       v
        +-----------------------------------+
        |     Postgres OR PGLite            |
        |  (same schema, same triggers)     |
        |                                   |
        |  sources, runs, change_log,       |
        |  ddl_log                          |
        |                                   |
        |  Generic mode:                    |
        |    entities, entities_versions    |
        |                                   |
        |  Dedicated mode (one set per src):|
        |    entities_<src>, _versions      |
        |                                   |
        |  Single trigger function          |
        |  (TG_TABLE_NAME-aware) attached   |
        |  to every storage table           |
        +-----------------------------------+
```

### 7.3 Data Model

**Core tables (always present):**
```
sources          id, name, enabled, http(JSONB), pagination(JSONB),
                 records_path, external_id_path, hash_fields[],
                 schedule_cron,
                 storage_mode ('generic' | 'dedicated'),
                 typed_columns(JSONB)    -- [{name, jsonpath, sql_type, indexed}]
                 storage_table TEXT      -- materialized: 'entities' or 'entities_<slug>'

runs             id, source_id, source_name, trigger, started_at, ended_at,
                 status, records_seen, records_created, records_updated,
                 records_skipped, error_message

change_log       id, run_id, entity_id, storage_table, source, external_id,
                 change_type, old_hash, new_hash, changed_at, consumed_at

ddl_log          id, applied_at, source_id, statement(TEXT), kind, success, error
```

**Generic storage (one shared table, default for new sources):**
```
entities             id, source, external_id, payload(JSONB), content_hash,
                     version_num, first_seen_at, updated_at
                     [unique (source, external_id)]
entities_versions    id, entity_id, version_num, payload(JSONB), content_hash,
                     valid_from, valid_to, run_id
```

**Dedicated storage (one set per source with `storage_mode='dedicated'`):**
```
entities_<slug>          id, source, external_id, payload(JSONB), content_hash,
                         version_num, first_seen_at, updated_at,
                         <typed_col_1>, <typed_col_2>, ...   -- GENERATED columns
                         [unique (source, external_id)]
entities_<slug>_versions id, entity_id, version_num, payload(JSONB), content_hash,
                         valid_from, valid_to, run_id
```

Dedicated tables always carry the same core columns. The only variation is the appended `typed_columns`, which are `GENERATED ALWAYS AS (payload->>'<jp>') STORED` and may be indexed. This keeps the trigger function generic and means hash-recomputation always works against `payload`.

### 7.4 The Versioning Trigger (table-agnostic via `TG_TABLE_NAME`)

```sql
CREATE OR REPLACE FUNCTION entities_diff() RETURNS trigger AS $$
DECLARE
  current_run_id BIGINT := nullif(current_setting('app.run_id', true), '')::bigint;
  versions_table TEXT := TG_TABLE_NAME || '_versions';
  ev JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO change_log(run_id, entity_id, storage_table, source, external_id,
                           change_type, new_hash)
    VALUES (current_run_id, NEW.id, TG_TABLE_NAME, NEW.source, NEW.external_id,
            'created', NEW.content_hash);
    ev := jsonb_build_object('type','created','table',TG_TABLE_NAME,'source',NEW.source,
                             'external_id',NEW.external_id,'hash',NEW.content_hash);
    PERFORM pg_notify('entity_changed', ev::text);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.content_hash = NEW.content_hash THEN RETURN NEW; END IF;
    EXECUTE format(
      'INSERT INTO %I (entity_id, version_num, payload, content_hash, valid_from, valid_to, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)', versions_table
    ) USING OLD.id, OLD.version_num, OLD.payload, OLD.content_hash,
            OLD.updated_at, now(), current_run_id;
    NEW.version_num := OLD.version_num + 1;
    NEW.updated_at  := now();
    INSERT INTO change_log(run_id, entity_id, storage_table, source, external_id,
                           change_type, old_hash, new_hash)
    VALUES (current_run_id, OLD.id, TG_TABLE_NAME, OLD.source, OLD.external_id,
            'updated', OLD.content_hash, NEW.content_hash);
    ev := jsonb_build_object('type','updated','table',TG_TABLE_NAME,'source',OLD.source,
                             'external_id',OLD.external_id,
                             'old_hash',OLD.content_hash,'new_hash',NEW.content_hash);
    PERFORM pg_notify('entity_changed', ev::text);
    RETURN NEW;
  END IF;
END $$ LANGUAGE plpgsql;

-- Attached once to the shared table:
CREATE TRIGGER entities_diff_trg
BEFORE INSERT OR UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION entities_diff();
-- And to every dedicated table at creation time (see §7.5).
```

### 7.5 Storage Modes — DDL Generation Pipeline

When a source is created with `storage_mode='dedicated'`, the API issues a transactional DDL bundle via `lib/ddl/generate.ts`. **No free-form SQL** — only this generator constructs DDL, ensuring identifiers are quoted via `format('%I', ...)` and types are validated against an allowlist.

```typescript
// lib/ddl/generate.ts (sketch)
export function generateDedicatedTableDDL(src: SourceRow): string[] {
  const slug = sanitize(src.name);                  // [a-z0-9_]+, max 40 chars
  const table = `entities_${slug}`;
  const vers  = `${table}_versions`;
  const cols  = src.typed_columns.map(c => `
    ${quoteIdent(c.name)} ${allowedType(c.sql_type)}
      GENERATED ALWAYS AS ((payload->>${escapeText(c.jsonpath)})::${allowedType(c.sql_type)}) STORED`);
  const indexes = src.typed_columns.filter(c => c.indexed).map(c =>
    `CREATE INDEX ${quoteIdent(table + '_' + c.name + '_idx')} ON ${quoteIdent(table)}(${quoteIdent(c.name)});`
  );
  return [
    `CREATE TABLE ${quoteIdent(table)} (
       id BIGSERIAL PRIMARY KEY,
       source TEXT NOT NULL,
       external_id TEXT NOT NULL,
       payload JSONB NOT NULL,
       content_hash TEXT NOT NULL,
       version_num INTEGER NOT NULL DEFAULT 1,
       first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()${cols.length ? "," : ""}
       ${cols.join(",\n")}
       , UNIQUE (source, external_id)
     );`,
    `CREATE TABLE ${quoteIdent(vers)} (
       id BIGSERIAL PRIMARY KEY,
       entity_id BIGINT NOT NULL,
       version_num INTEGER NOT NULL,
       payload JSONB NOT NULL,
       content_hash TEXT NOT NULL,
       valid_from TIMESTAMPTZ NOT NULL,
       valid_to TIMESTAMPTZ NOT NULL,
       run_id BIGINT
     );`,
    `CREATE TRIGGER ${quoteIdent(table + '_diff_trg')}
       BEFORE INSERT OR UPDATE ON ${quoteIdent(table)}
       FOR EACH ROW EXECUTE FUNCTION entities_diff();`,
    ...indexes,
  ];
}

export async function applyDedicatedDDL(src: SourceRow) {
  const stmts = generateDedicatedTableDDL(src);
  const db = getDb();
  await db.transaction(async tx => {
    for (const stmt of stmts) {
      await tx.execute(sql.raw(stmt));
      await tx.insert(ddlLog).values({
        source_id: src.id, kind: detectKind(stmt), statement: stmt, success: true,
      });
    }
  });
}
```

Properties:
- One transaction; partial failure rolls back the whole bundle.
- Every statement logged in `ddl_log` for forensic audit.
- Identifiers quoted, types allowlisted (`text`, `integer`, `bigint`, `boolean`, `numeric`, `timestamptz`, `date`, `jsonb`) — no SQL injection surface.
- The same code path runs against PG and PGLite; PGLite supports all the DDL we issue.

When a dedicated source is **dropped**, the system issues `DROP TABLE entities_<slug>_versions; DROP TABLE entities_<slug>;` in a single transaction, also logged to `ddl_log`. Hard-delete; soft-delete only sets `enabled=false`.

### 7.6 Skip-Unchanged Statement (used for both modes)

```sql
INSERT INTO <storage_table> (source, external_id, payload, content_hash)
VALUES ($1, $2, $3, $4)
ON CONFLICT (source, external_id) DO UPDATE
  SET payload = EXCLUDED.payload,
      content_hash = EXCLUDED.content_hash
  WHERE <storage_table>.content_hash IS DISTINCT FROM EXCLUDED.content_hash
RETURNING (xmax = 0) AS inserted;
```

The worker reads `sources.storage_table` once at the start of the run and templates that into the prepared statement — single hot statement, same skip-unchanged semantics, same trigger fires.

### 7.7 Driver Abstraction (PG ↔ PGLite swap)

```typescript
// lib/db/index.ts
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

let _db: any;
let _listen: (channel: string, cb: (p: string) => void) => Promise<() => void>;

export function getDb() {
  if (_db) return _db;
  if (process.env.DB_DRIVER === "postgres") {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    _db = drizzlePg(pool, { schema });
    _listen = makePgListen(pool);
  } else {
    const client = new PGlite(process.env.PGLITE_PATH ?? "./local.pglite");
    _db = drizzlePglite(client, { schema });
    _listen = makePgliteListen(client);
  }
  return _db;
}

export const listen = (channel: string, cb: (p: string) => void) => _listen(channel, cb);
```

Every other file calls `getDb()` / `listen()`. Nothing else knows which engine is behind it. The DDL generator emits the same SQL for both.

### 7.8 Scheduler Abstraction

```typescript
export interface Scheduler {
  register(name: string, cron: string, run: () => Promise<void>): Promise<void>;
  unregister(name: string): Promise<void>;
}
// PgCronScheduler  -> INSERTs into cron.job; the job NOTIFYs 'run_due'
// CronerScheduler  -> in-process croner on PGLite; on tick, NOTIFYs 'run_due'
```

Both downstream paths receive identical `pg_notify('run_due', source_name)` events.

### 7.9 Project Layout

```
S:/GitHub/vibecoding/syncbase/
  package.json                # bun; deps: next, react, drizzle-orm, @electric-sql/pglite,
                              #   pg, croner, citty, zod, jsonpath-plus, ofetch,
                              #   deep-object-diff, @monaco-editor/react
  bun.lock
  tsconfig.json
  drizzle.config.ts
  docker-compose.yml          # Postgres + pg_cron for prod-like local
  migrations/
    0000_init.sql             # core tables (drizzle-generated)
    0001_triggers.sql         # entities_diff() + trigger on generic entities
    0002_pgcron.sql           # CREATE EXTENSION pg_cron (PG only)
                              # Per-source dedicated tables are NOT in this folder —
                              # they are generated at runtime by lib/ddl and logged to ddl_log.
  app/                        # Next.js App Router (UI + API routes)
  lib/
    db/                       # Drizzle + driver swap
    pipeline/                 # fetch + upsert + hash
    scheduler/                # pg_cron | croner
    ddl/                      # runtime DDL generator for dedicated sources
    sse/                      # LISTEN -> ReadableStream
  bin/
    cli.ts
    worker.ts
  tests/
    versioning.test.ts        # same payload twice -> 0 new rows
    change.test.ts            # mutate -> versions row + change_log entry
    hash-subset.test.ts       # hash_fields limits what counts as a change
    sse.test.ts               # LISTEN/NOTIFY round-trip
    pglite-vs-pg.test.ts      # same suite passes on both drivers
    storage-modes.test.ts     # generic vs dedicated parity
    ddl-safety.test.ts        # identifier quoting, type allowlist, txn rollback
  .env.example                # DB_DRIVER=pglite|postgres
  PRD.md                      # this document
  README.md
```

No existing files in the monorepo modified.

### 7.10 API Surface

```
GET    /api/sources                       list
POST   /api/sources                       create (provisions dedicated table if requested)
GET    /api/sources/:id                   detail (incl. storage_table, typed_columns)
PATCH  /api/sources/:id                   update (cannot change storage_mode)
DELETE /api/sources/:id                   soft-delete by default; ?hard=true drops the
                                          dedicated table+versions (logged to ddl_log)
POST   /api/sources/:id/test              dry-run, no DB write
POST   /api/sources/:id/run               adhoc trigger; returns run_id

GET    /api/runs                          paginated
GET    /api/runs/:id                      detail + linked change_log

GET    /api/entities                      filter by source; auto-routes to correct table
GET    /api/entities/:storage_table/:id   current (table identifier required)
GET    /api/entities/:storage_table/:id/history
GET    /api/entities/:storage_table/:id/diff?v1=&v2=

GET    /api/changes                       paginated; carries storage_table for each row
GET    /api/changes/stream                SSE feed (event payload includes storage_table)
POST   /api/changes/:id/consume

GET    /api/schedules                     list
PATCH  /api/schedules/:source_id          enable/disable, edit cron

GET    /api/ddl-log                       audit trail of runtime DDL operations
```

### 7.11 CLI Surface

```
bun bin/cli.ts dev                     # next dev + worker in one process
bun bin/cli.ts api                     # next start
bun bin/cli.ts worker                  # standalone LISTEN loop
bun bin/cli.ts run [--source NAME]
bun bin/cli.ts sources list|add|edit|rm
bun bin/cli.ts changes [--since T] [--watch]
bun bin/cli.ts history <storage_table> <entity-id>
bun bin/cli.ts init                    # apply migrations (driver auto-detected)
bun bin/cli.ts migrate-source <name>   # re-applies DDL for one dedicated source
```

## 8. Acceptance Criteria

Every criterion must pass against **both** `DB_DRIVER=postgres` and `DB_DRIVER=pglite`, and where applicable, against **both** storage modes.

| # | Criterion |
|---|---|
| AC-1 | First run of a new source creates N entities in its storage table, N `change_log` rows (`created`), 0 versions rows. |
| AC-2 | Re-run against unchanged upstream: **0** new rows in entities / versions / change_log. Runs row records `records_skipped=N`. |
| AC-3 | A field changed upstream but NOT in `hash_fields` still produces 0 versions. |
| AC-4 | A field changed upstream IN `hash_fields` produces exactly 1 new versions row, exactly 1 new `change_log` row, `version_num++`. |
| AC-5 | `/api/entities/:storage_table/:id/history` returns versions ordered by `valid_from`; diff viewer highlights the delta. |
| AC-6 | SSE client receives the change within 1s of the upsert; payload includes `storage_table`. |
| AC-7 | `change_log.consumed_at` remains NULL until explicitly POSTed. |
| AC-8 | A scheduled tick (pg_cron on PG / croner on PGLite) creates a `runs` row with `trigger='schedule'`. |
| AC-9 | Editing `schedule_cron` updates the underlying scheduler. |
| AC-10 | Adding a new **generic** source requires zero TypeScript edits, zero file-based migrations. |
| AC-11 | The same test suite passes under both drivers. |
| AC-12 | Killing the worker mid-run leaves the `runs` row with `status='error'`, no partial change_log rows. |
| **AC-13** | **Creating a source with `storage_mode='dedicated'` issues exactly the DDL bundle (table + versions + trigger + indexes) in one transaction; `ddl_log` records each statement.** |
| **AC-14** | **All of AC-1 through AC-9 hold identically for a dedicated source (parity test).** |
| **AC-15** | **`typed_columns` are populated automatically as STORED generated columns and are queryable + indexable; values match `payload->>'<jp>'`.** |
| **AC-16** | **DDL generator rejects unsafe identifiers (regex `^[a-z][a-z0-9_]{0,39}$`) and types not in the allowlist; returns 400 with a clear error.** |
| **AC-17** | **Hard-deleting a dedicated source drops both tables in one transaction; partial failure rolls back.** |
| **AC-18** | **A source's `storage_mode` cannot be changed after creation — PATCH returns 409.** |

## 9. Risks & Open Questions

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `pg_cron` not available on chosen managed PG. | All realistic providers support it; fallback `CronerScheduler` env var. |
| R-2 | PGLite extensions differ from PG. | We use only core features supported in both. |
| R-3 | LISTEN/NOTIFY [doesn't scale to high volume](https://news.ycombinator.com/item?id=44490510). | `change_log` is the durable source of truth; SSE is a latency optimization. |
| R-4 | OAuth/refresh-token APIs need stateful auth. | v1 supports static bearer tokens + API keys via headers. OAuth is v2. |
| R-5 | Many dedicated sources → many tables → schema sprawl. | Acceptable trade-off; that's the *point* of dedicated mode. Web UI shows table count and lets operators audit via `ddl_log`. |
| R-6 | **Runtime DDL is sensitive.** | Allowlisted types, regex-validated identifiers, transactional bundle, full `ddl_log` audit trail. No free-form SQL accepted from API. |
| R-7 | **Inconsistency between dedicated tables if the trigger function is updated.** | Function is shared by name; any future change to `entities_diff()` propagates to every table automatically (single source of truth). |

### Open Questions
- **OQ-1** Storage-mode default when creating a source — `generic` or prompt the user? *Recommendation: default to `generic` and let the operator opt into `dedicated` with a clear "Why?" tooltip.*
- **OQ-2** Admin UI auth in v1? *Default: no — local / trusted network.*
- **OQ-3** Multi-instance worker? *Default: single; advisory-lock guard for later scale-out.*
- **OQ-4** Retention policy for `*_versions` and `change_log`? *Default: keep forever; archival in v2.*
- **OQ-5** Allow operator to write a custom `payload->>'x'` JSONPath that fails on some records (e.g., field absent)? *Recommendation: STORED generated columns return NULL when JSONPath misses — safe and matches Postgres default. Surface as warnings in `/api/sources/:id/test`.*

## 10. Out of Scope (Future Considerations)

- Migrating data between storage modes after creation.
- Webhook / Slack / email change notifiers.
- OAuth-with-refresh auth flow.
- Backfill / replay tooling (re-process historical data against a new `hash_fields` or `typed_columns` definition).
- Multi-tenant / per-user source isolation.
- Cross-source linking (FKs between entities from different sources).
- GraphQL or streaming-API sources.
- Auto-suggested `typed_columns` from observed payload shape (schema inference).

## 11. References

- [Drizzle ORM — PGLite driver](https://orm.drizzle.team/docs/connect-pglite) · [PGLite ORM support](https://pglite.dev/docs/orm-support)
- [PGLite API — listen / unlisten / onNotification](https://pglite.dev/docs/api)
- [pg_cron](https://github.com/citusdata/pg_cron)
- [Next.js SSE pattern](https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/) · [Route Handler streaming caveats](https://github.com/vercel/next.js/discussions/48427)
- [croner](https://github.com/Hexagon/croner)
- [Sequin — all the ways to CDC in Postgres](https://blog.sequinstream.com/all-the-ways-to-capture-changes-in-postgres/)
- [Postgres LISTEN/NOTIFY doesn't scale (HN)](https://news.ycombinator.com/item?id=44490510)
- [temporal_tables](https://github.com/arkhipov/temporal_tables) · [periods SYSTEM VERSIONING](https://github.com/xocolatl/periods)
- [dlt — SCD2 mechanics (reference)](https://dlthub.com/docs/general-usage/merge-loading)
- [Meltano](https://meltano.com/) · [Airbyte vs Meltano](https://airbyte.com/compare/meltano-vs-airbyte) — heavier prior art
