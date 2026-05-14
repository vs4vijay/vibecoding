# statesnapper

Stateful API ingest with DB-layer versioning. Pulls data from arbitrary REST APIs on a schedule, detects new/changed/unchanged records inside the database, and surfaces a live + durable change feed.

See [`PRD.md`](./PRD.md) and [`plan.md`](./plan.md) for the design.

## Quick start (PGLite — zero deps)

```bash
bun install
cp .env.example .env
bun bin/cli.ts init     # apply migrations to ./local.pglite
bun dev                 # next dev on :3000
```

Visit:
- `/` — dashboard (counts + recent changes)
- `/sources/new` — paste a source config, Test it, Save
- `/sources/<id>` — run adhoc, see runs history
- `/entities` — browse stored records
- `/changes` — live SSE feed + paginated history
- `/schedules` — edit cron per source
- `/ddl-log` — audit trail of runtime DDL

## CLI

```bash
bun bin/cli.ts init                              # apply migrations
bun bin/cli.ts sources add --file source.json    # register a source
bun bin/cli.ts sources list
bun bin/cli.ts run --source rera_raj_projects    # adhoc run
bun bin/cli.ts worker                            # long-lived LISTEN run_due loop
```

## Postgres (prod)

```bash
docker compose up -d postgres
echo 'DB_DRIVER=postgres' >> .env
echo 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/statesnapper' >> .env
bun bin/cli.ts init
bun dev
```

`pg_cron` is loaded by the docker-compose image. If you're using a different Postgres distribution, install pg_cron and ensure it's listed in `shared_preload_libraries`.

## Architecture

Single Bun process serves the Next.js App Router for both UI and API routes. A separate `bun bin/cli.ts worker` process holds `LISTEN run_due` open and runs the pipeline when pg_cron (or in-PGLite croner) fires.

The versioning logic lives in two PL/pgSQL trigger functions on every storage table:

- `entities_diff_before` — on UPDATE, if hash differs: snapshot OLD into `<table>_versions`, bump `version_num`, set `updated_at`.
- `entities_diff_after` — on INSERT/UPDATE: write a `change_log` row + `pg_notify('entity_changed', ...)`.

The upsert uses `INSERT ... ON CONFLICT DO UPDATE WHERE content_hash IS DISTINCT FROM EXCLUDED.content_hash` so when nothing changed, no UPDATE happens and the AFTER triggers don't fire. That's how AC-2 (zero writes on idle re-run) is enforced.

## Storage modes

- **generic** (default): all records land in the shared `entities` table keyed by `(source, external_id)`.
- **dedicated**: a per-source `entities_<slug>` table is provisioned via runtime DDL with optional STORED generated columns extracted from `payload` via JSONPath. Same trigger functions, same versioning behavior.

Switching mode after creation is not supported (PATCH returns 409). Hard-delete (`?hard=true`) drops the dedicated tables transactionally; soft-delete just disables.

## Tests

```bash
bun test                # full suite under DB_DRIVER=pglite (in-memory)
DB_DRIVER=postgres bun test     # parity check against a running Postgres
```

The suite covers AC-1 through AC-18 (see `PRD.md`).

## Layout

```
app/                     # Next.js App Router (UI + REST + SSE)
lib/
  db/                    # Drizzle + PG/PGLite driver swap + LISTEN shim
  pipeline/              # fetch + hash + extract + run
  ddl/                   # runtime DDL for dedicated mode (validators, generate, apply)
  scheduler/             # pg_cron | croner
  sse/                   # LISTEN → event stream
bin/
  cli.ts                 # init, run, sources, worker
  worker.ts              # LISTEN run_due loop
migrations/              # raw SQL, applied in order; runner is env-aware (skips pgcron on PGLite)
tests/                   # versioning + change + hash + scheduler + dedicated + parity
```

## Environment variables

| name | values | meaning |
|---|---|---|
| `DB_DRIVER` | `pglite` (default) / `postgres` | which driver to use |
| `PGLITE_PATH` | path or `memory://` | PGLite data dir (file://) or in-memory |
| `DATABASE_URL` | postgres connection string | required when `DB_DRIVER=postgres` |
