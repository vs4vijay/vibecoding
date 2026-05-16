# plan.md — syncbase Implementation Plan

*Vertical-sliced phases. Each phase is mergeable, demoable, and validates a defined slice of the [PRD's acceptance criteria](./PRD.md#8-acceptance-criteria).*

> **First source under test (all phases dogfood this):** RERA Rajasthan project list — a POST + form-urlencoded + page-number-paginated endpoint. The curl that defines it:
>
> ```bash
> curl -X POST 'https://rera.rajasthan.gov.in/Home/GetProjectsList' \
>   -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0' \
>   -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
>   -H 'Origin: https://rera.rajasthan.gov.in' \
>   --data-raw 'v=&District=1063&teshil=&projectName=&promoterName=&certificateNo=&applicationStatus=3&PageSize=200&page=1'
> ```
>
> Translated to a `sources` row (config-only, seeded in Phase 1):
>
> ```jsonc
> {
>   "name": "rera_raj_projects",
>   "enabled": true,
>   "http": {
>     "method": "POST",
>     "url": "https://rera.rajasthan.gov.in/Home/GetProjectsList",
>     "headers": {
>       "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
>       "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
>       "Origin": "https://rera.rajasthan.gov.in"
>     },
>     "form": {
>       "v": "",
>       "District": "1063",
>       "teshil": "",
>       "projectName": "",
>       "promoterName": "",
>       "certificateNo": "",
>       "applicationStatus": "3"
>     }
>   },
>   "pagination": {
>     "style": "page",
>     "page_param": "page",
>     "size_param": "PageSize",
>     "size": 200,
>     "start_page": 1,
>     "stop_when": "empty_records"
>   },
>   "records_path": "$.Data",              // confirm via Phase 1 "Test" button before finalizing
>   "external_id_path": "$.RegNo",         // confirm via Test
>   "hash_fields": null,                   // start with whole-record hash
>   "schedule_cron": null,                 // adhoc-only until Phase 4
>   "storage_mode": "generic"              // dedicated mode arrives in Phase 5
> }
> ```
>
> The exact `records_path` and `external_id_path` are confirmed in Phase 1 via the `/test` endpoint — that's the whole point of building Test first.

---

## Phase 0 — Skeleton (≈ half a day)

**Goal.** Project boots. A `bun dev` server serves a Next.js page that reads from PGLite via Drizzle. Proves the toolchain.

**In scope.**
- `bun init` at `S:/GitHub/vibecoding/syncbase/`.
- Add deps: `next`, `react`, `react-dom`, `drizzle-orm`, `drizzle-kit`, `@electric-sql/pglite`, `pg`, `zod`, `citty`.
- `lib/db/index.ts` with the driver-swap stub (PGLite-only path lit up).
- `lib/db/schema.ts` with a single `health` table.
- `migrations/0000_health.sql` (generated).
- `app/api/health/route.ts` — returns DB-driven JSON.
- `app/page.tsx` — minimal landing page.
- `bin/cli.ts` with one command: `init` (applies migrations).
- `.env.example`, `tsconfig.json`, `drizzle.config.ts`, `.gitignore`.
- Copy PRD into `PRD.md`, this file into `plan.md`.

**Out of scope.** Everything else.

**Demo.**
```
bun install
bun bin/cli.ts init
bun dev
# visit http://localhost:5555 → health row visible
# curl http://localhost:5555/api/health → {"ok":true,"db":"pglite",...}
```

**Validates.** Build & deploy pipeline only — no PRD AC yet.

---

## Phase 1 — First End-to-End Ingest (≈ 2 days) 🏗️ MVP

**Goal.** Operator creates the RERA Rajasthan source via the web UI, clicks **Run now**, sees N rows land in the `entities` table and the browser. Re-clicking **Run now** produces zero writes (the core skip-unchanged property).

**In scope.**
- Migrations:
  - `0001_core.sql` — `sources`, `entities`, `entities_versions`, `runs`, `change_log`, `ddl_log` tables.
  - `0002_triggers.sql` — `entities_diff()` PL/pgSQL function + trigger on `entities` (the table-agnostic version from [PRD §7.4](./PRD.md#74-the-versioning-trigger-table-agnostic-via-tg_table_name)).
- `lib/db/schema.ts` — Drizzle definitions for the tables above.
- `lib/pipeline/`:
  - `hash.ts` — `canonicalHash(record, fields)` (sha256 of sorted-key JSON).
  - `extract.ts` — `jsonpath-plus` wrappers.
  - `fetch.ts` — page-number pagination dispatch; **must support POST + form-urlencoded body with page/size injected into the form, not the URL** (the RERA constraint).
  - `run.ts` — the `runPipeline()` function from [PRD §7.6](./PRD.md#76-skip-unchanged-statement-used-for-both-modes), wrapping fetch + upsert with `SET LOCAL app.run_id`.
- Route Handlers:
  - `POST /api/sources` — create (zod-validated against the JSONB http/pagination shape).
  - `GET  /api/sources` — list.
  - `GET  /api/sources/:id` — detail.
  - `POST /api/sources/:id/test` — fetch one page, return parsed records side-by-side with raw response. **Use this to confirm `records_path` and `external_id_path` for RERA.**
  - `POST /api/sources/:id/run` — adhoc trigger; returns `run_id`.
  - `GET  /api/runs` — paginated.
  - `GET  /api/entities?source=&limit=` — basic list.
- UI:
  - `app/sources/page.tsx` — list of sources with a "New source" button.
  - `app/sources/new/page.tsx` — form with a Monaco JSON editor for the http config + a **Test** button that calls `/test` and renders parsed records.
  - `app/sources/[id]/page.tsx` — detail with **Run now** + recent runs.
  - `app/entities/page.tsx` — paginated browser, filter by source.
- CLI:
  - `bun bin/cli.ts run [--source NAME]` — adhoc, shares code with the route.
  - `bun bin/cli.ts sources [list|add]`.
- Test fixture: `tests/fixtures/sources.rera.json` — the seed source config above.
- Tests:
  - `tests/versioning.test.ts` — same payload twice → 0 new rows everywhere.
  - `tests/rera-shape.test.ts` — given the RERA response shape (mocked via fixture), extraction yields a non-empty `records` array and a non-null `external_id` per record.

**Out of scope (cut to keep this phase tight).**
- History/diff UI (Phase 2)
- SSE live feed (Phase 3) — but `pg_notify` stays in the trigger
- Scheduling (Phase 4)
- Dedicated storage mode (Phase 5)
- `hash_fields` config (Phase 2 will surface it; the trigger already respects whole-payload hashing)
- Cursor / link-header pagination (Phase 4 or later — not needed for RERA)
- Auth on the admin UI

**Files touched.**
```
package.json                              # add deps: drizzle pg client; ofetch; jsonpath-plus; @monaco-editor/react
migrations/0001_core.sql
migrations/0002_triggers.sql
lib/db/{index,schema,migrate}.ts
lib/pipeline/{hash,extract,fetch,run}.ts
app/api/sources/route.ts
app/api/sources/[id]/{route,test,run}.ts
app/api/runs/route.ts
app/api/entities/route.ts
app/sources/{page,new/page,[id]/page}.tsx
app/entities/page.tsx
components/{json-editor,test-results,run-button}.tsx
bin/cli.ts                                # add: run, sources, init
tests/{versioning,rera-shape}.test.ts
tests/fixtures/sources.rera.json
```

**Demo.**
```
bun bin/cli.ts init
bun dev
# In browser:
#   /sources/new → paste RERA config, click Test → confirm records render
#   Save → /sources → see "rera_raj_projects"
#   Click into it → Run now → wait → see records_seen=N, records_created=N
#   /entities?source=rera_raj_projects → browse rows
#   Back to source detail → Run now again → records_skipped=N, no new rows
```

**Validates.** PRD AC-1, AC-2, AC-10, AC-12 (partial — error path tested via unit).

---

## Phase 2 — Versioning Visibility (≈ 1 day)

**Goal.** When a record changes upstream, the operator sees the prior version in a timeline and diffs the two side by side.

**In scope.**
- API:
  - `GET /api/entities/:storage_table/:id/history`
  - `GET /api/entities/:storage_table/:id/diff?v1=&v2=` (uses `deep-object-diff`)
- UI:
  - `app/entities/[id]/page.tsx` — current state on top, version timeline below.
  - `components/diff-viewer.tsx` — side-by-side JSON diff.
  - `app/changes/page.tsx` — paginated change_log with filters (source, since).
- Source form: surface `hash_fields` as a multi-select populated from the first record's keys after Test.
- Tests:
  - `tests/change.test.ts` — synthetically mutate one entity's payload row, re-run pipeline → exactly 1 new `entity_versions` row, 1 new `change_log` row, `version_num++`.
  - `tests/hash-subset.test.ts` — set `hash_fields=[a,b]`, mutate field `c` upstream, re-run → 0 versions.

**Out of scope.** Live notifications (Phase 3); diff for dedicated tables (lands automatically in Phase 5 since the API takes `storage_table`).

**Files touched.**
```
app/api/entities/[storage_table]/[id]/{route,history/route,diff/route}.ts
app/entities/[id]/page.tsx
app/changes/page.tsx
components/diff-viewer.tsx
components/hash-fields-picker.tsx
tests/{change,hash-subset}.test.ts
```

**Demo.**
```
# Force a change to a RERA record:
psql ... -c "UPDATE entities SET payload = jsonb_set(payload, '{Status}', '\"Updated\"') WHERE id = 5;"
# Then re-run via UI; open entities/5 → timeline shows v1→v2; diff highlights Status.
```

**Validates.** PRD AC-3, AC-4, AC-5.

---

## Phase 3 — Live Notifications via SSE (≈ 1 day)

**Goal.** Browser displays changes within 1 s of the upsert without refresh. `change_log.consumed_at` only flips when the consumer explicitly marks it.

**In scope.**
- `lib/sse/listen.ts` — pg / PGLite-agnostic LISTEN wrapper (uses `lib/db`'s `listen()`).
- Route Handler:
  - `GET /api/changes/stream` — SSE via `ReadableStream`, per-request LISTEN, keepalive every 30 s, cleanup on `controller.signal.abort`.
  - `POST /api/changes/:id/consume`.
- `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` on the SSE route.
- UI:
  - `components/sse-feed.tsx` — client component using `EventSource`.
  - `/changes` gets a live feed at top; landing dashboard gets a "Recent changes" widget.
- Test:
  - `tests/sse.test.ts` — open SSE connection, trigger run that produces a change, assert event received within 1 s.

**Out of scope.** Webhook fanout (post-v1).

**Files touched.**
```
lib/sse/listen.ts
app/api/changes/stream/route.ts
app/api/changes/[id]/consume/route.ts
components/sse-feed.tsx
app/changes/page.tsx          # add live feed above existing paginated table
app/page.tsx                  # add "Recent changes" widget
tests/sse.test.ts
```

**Demo.**
```
# Two browser tabs:
#   Tab A: /changes (live feed)
#   Tab B: source detail → Run now after upstream mutation
# Tab A surfaces the change live; Tab B's run completes; change_log row's
# consumed_at remains NULL until you POST /changes/:id/consume.
```

**Validates.** PRD AC-6, AC-7.

---

## Phase 4 — Scheduling (≈ 1.5 days)

**Goal.** Source runs automatically on its cron expression. Works on both Postgres (pg_cron) and PGLite (croner) without code changes.

**In scope.**
- Migrations:
  - `0003_pgcron.sql` — `CREATE EXTENSION pg_cron`. Skipped on PGLite by the migrate runner (env-aware).
- `lib/scheduler/`:
  - `index.ts` — `Scheduler` interface + `getScheduler()` driver switch.
  - `pg-cron.ts` — INSERT into `cron.job`; the cron command is `SELECT pg_notify('run_due', '<source_name>')`.
  - `croner.ts` — in-process `croner` registry; on tick, NOTIFY the same channel.
- `bin/worker.ts` — standalone Bun script with a long-lived `LISTEN run_due` loop calling `runPipeline(source, 'schedule')`.
- API:
  - `PATCH /api/sources/:id` — on `schedule_cron` change, call scheduler register/unregister.
  - `GET /api/schedules`, `PATCH /api/schedules/:source_id`.
- UI:
  - `app/schedules/page.tsx` — table of `(source, cron, last_run, next_run, enabled)`.
- CLI:
  - `bun bin/cli.ts worker` — runs the worker process.
  - `bun bin/cli.ts dev` — boots Next.js + worker in one Bun process for local dev.
- Test:
  - `tests/scheduler.test.ts` — register a 1-minute cron on PGLite, wait, assert a `runs` row with `trigger='schedule'` is created.

**Out of scope.** Multi-instance worker (advisory-lock guard is a post-v1 line item).

**Files touched.**
```
migrations/0003_pgcron.sql
lib/db/migrate.ts                          # skip pg_cron migration on PGLite
lib/scheduler/{index,pg-cron,croner}.ts
bin/worker.ts
bin/cli.ts                                 # add: worker, dev
app/api/sources/[id]/route.ts              # PATCH triggers scheduler.register/unregister
app/api/schedules/route.ts
app/api/schedules/[source_id]/route.ts
app/schedules/page.tsx
tests/scheduler.test.ts
```

**Demo.**
```
# Set rera_raj_projects.schedule_cron = "*/2 * * * *" via /schedules
# Wait 2 minutes; /runs shows trigger='schedule' rows; /changes feed lights up if anything changed upstream.
```

**Validates.** PRD AC-8, AC-9.

---

## Phase 5 — Dedicated Storage Mode (≈ 2 days)

**Goal.** Operator creates a *second* RERA source (`rera_raj_projects_typed`) with `storage_mode='dedicated'` and typed columns extracted from the payload. Same versioning behavior; data lands in a dedicated table; typed columns are queryable.

**In scope.**
- Schema:
  - Add `storage_mode`, `typed_columns`, `storage_table` to `sources` (migration `0004_dedicated_mode.sql`).
- `lib/ddl/`:
  - `generate.ts` — produces the DDL bundle from a `SourceRow` ([PRD §7.5](./PRD.md#75-storage-modes--ddl-generation-pipeline)).
  - `validators.ts` — identifier regex `^[a-z][a-z0-9_]{0,39}$`; type allowlist `text|integer|bigint|boolean|numeric|timestamptz|date|jsonb`.
  - `apply.ts` — transactional execution + `ddl_log` writes.
  - `drop.ts` — for `DELETE /api/sources/:id?hard=true`.
- Pipeline:
  - `lib/pipeline/run.ts` — read `source.storage_table` at start of run; template into the upsert statement; trigger fires identically.
- API:
  - `POST /api/sources` — on `storage_mode='dedicated'`, also runs the DDL bundle in the same transaction; rolls back if any statement fails.
  - `PATCH /api/sources/:id` — returns 409 if `storage_mode` differs.
  - `DELETE /api/sources/:id?hard=true` — drops the dedicated tables (logged).
  - `GET /api/ddl-log`.
  - `GET /api/entities` — now multiplexes across `entities` and every dedicated table (UNION ALL with `storage_table` discriminator).
- UI:
  - Source form: radio for storage_mode; when `dedicated`, reveal the `typed_columns` builder (rows of `{name, jsonpath, sql_type, indexed}`).
  - `app/ddl-log/page.tsx` — audit trail.
- Tests:
  - `tests/storage-modes.test.ts` — full parity: same suite from Phases 1/2 runs against a dedicated source.
  - `tests/ddl-safety.test.ts` — rejects bad identifiers, bad types; partial-failure rolls back; `ddl_log` reflects every statement.

**Out of scope.** Migrating data between modes after creation (PRD §10).

**Files touched.**
```
migrations/0004_dedicated_mode.sql
lib/ddl/{generate,validators,apply,drop}.ts
lib/pipeline/run.ts                        # template storage_table
app/api/sources/route.ts                   # provision DDL on dedicated create
app/api/sources/[id]/route.ts              # block storage_mode change; hard-delete path
app/api/entities/route.ts                  # multiplex across tables
app/api/ddl-log/route.ts
app/sources/new/page.tsx                   # radio + typed_columns builder
app/sources/[id]/page.tsx                  # show storage info
app/ddl-log/page.tsx
tests/{storage-modes,ddl-safety}.test.ts
```

**Demo.**
```
# Create rera_raj_projects_typed with storage_mode=dedicated and typed_columns:
#   district     (jsonpath: $.District,        sql_type: integer,     indexed: true)
#   status       (jsonpath: $.Status,          sql_type: text,        indexed: true)
#   project_name (jsonpath: $.ProjectName,     sql_type: text,        indexed: false)
# Save → /ddl-log shows the 4 statements (table, versions table, trigger, indexes).
# Run now → /entities?source=rera_raj_projects_typed → rows with typed columns populated.
# psql ... -c "SELECT district, count(*) FROM entities_rera_raj_projects_typed GROUP BY district;"
```

**Validates.** PRD AC-13, AC-14, AC-15, AC-16, AC-17, AC-18.

---

## Phase 6 — PG/PGLite Parity & Polish (≈ 1 day)

**Goal.** The same test suite passes against both drivers. Production-readiness pass.

**In scope.**
- `docker-compose.yml` — Postgres image with pg_cron preinstalled (use `pgvector/pgvector:pg16` base + manual pg_cron install, or `supabase/postgres`).
- `tests/pglite-vs-pg.test.ts` — meta-runner that executes the existing suites against both `DB_DRIVER=pglite` and `DB_DRIVER=postgres`.
- Error-handling polish: kill-worker test (AC-12), retry/timeout policy in `ofetch`, structured errors in `runs.error_message`.
- README, `.env.example` finalization, deployment notes (single-process vs separate-worker).
- Lockfile commit; CI workflow stub.

**Out of scope.** Anything in PRD §10.

**Files touched.**
```
docker-compose.yml
tests/pglite-vs-pg.test.ts
tests/error-handling.test.ts
README.md
.env.example
.github/workflows/test.yml                 # optional
```

**Demo.**
```
DB_DRIVER=pglite bun test          # all pass
docker compose up -d postgres
DB_DRIVER=postgres bun bin/cli.ts init
DB_DRIVER=postgres bun test        # same suite, all pass
```

**Validates.** PRD AC-11, AC-12.

---

## Total estimate & order

| Phase | Days | Cumulative | Mergeable on its own? |
|---|---|---|---|
| 0 — Skeleton | 0.5 | 0.5 | Yes — boots; no functionality |
| 1 — First ingest | 2.0 | 2.5 | **Yes — full MVP for RERA** |
| 2 — Versioning visibility | 1.0 | 3.5 | Yes |
| 3 — Live SSE | 1.0 | 4.5 | Yes |
| 4 — Scheduling | 1.5 | 6.0 | Yes |
| 5 — Dedicated storage | 2.0 | 8.0 | Yes |
| 6 — Parity & polish | 1.0 | 9.0 | Yes |

**Ship-with-just-Phase-1-if-needed**: the system is already valuable after Phase 1 — RERA Rajasthan ingest works, versioning is enforced, web UI lets you browse. Everything after layers on visibility, automation, and flexibility.

## Decisions deferred until they bite

These come from PRD §9. None block any phase but they should be revisited:

- **OQ-2** Admin auth on the UI. Default: none (trusted network). Revisit before exposing publicly.
- **OQ-3** Multi-instance worker. Default: single. Revisit if a single worker can't keep up.
- **OQ-4** Retention policy for `entity_versions` / `change_log`. Default: keep forever. Revisit when one of them crosses ~1 M rows.

## Open question for *this* plan, not the PRD

**Q.** Do you want **Phase 5 (dedicated mode) bumped earlier** if you intend to use typed columns for RERA from day one? My recommendation is to keep the current order — Phase 1's "generic + JSONB" gets RERA producing data immediately; switching to dedicated in Phase 5 is just creating a second source pointing at the same endpoint with typed columns, no data migration needed. But if you'd rather model RERA as typed from day one, swap Phase 5 with Phase 4.

---

## File deltas at end of each phase

```
P0: package.json, tsconfig, drizzle.config, app/page, app/api/health, lib/db, migrations/0000, PRD.md, plan.md
P1: + migrations/{0001,0002}, lib/pipeline/*, app/api/sources/*, app/api/runs, app/api/entities,
    app/sources/*, app/entities/page, components/{json-editor,test-results,run-button},
    bin/cli.ts (run/sources/init), tests/{versioning,rera-shape}
P2: + app/api/entities/[t]/[id]/{history,diff}, app/entities/[id]/page, app/changes/page,
    components/{diff-viewer,hash-fields-picker}, tests/{change,hash-subset}
P3: + lib/sse, app/api/changes/{stream,[id]/consume}, components/sse-feed, tests/sse
P4: + migrations/0003, lib/scheduler/*, bin/worker.ts, app/api/schedules/*,
    app/schedules/page, tests/scheduler
P5: + migrations/0004, lib/ddl/*, app/api/ddl-log, app/ddl-log/page,
    tests/{storage-modes,ddl-safety}, sources/new + [id] updates
P6: + docker-compose, tests/{pglite-vs-pg,error-handling}, README, .github/workflows
```

## Next concrete action

1. `mkdir S:/GitHub/vibecoding/syncbase` ✅ done
2. Write `PRD.md` and `plan.md` into it ✅ done
3. Start Phase 0: `bun init`, install Next.js + Drizzle + PGLite, get `bun dev` to serve `/api/health`.
4. Stop and confirm Phase 0 is green before moving to Phase 1.
