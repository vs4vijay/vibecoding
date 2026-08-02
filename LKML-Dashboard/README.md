# LKML Patch Review Dashboard

A full end-to-end **Patch Review (PR) dashboard** fed from the **Linux Kernel Mailing List**.
It ingests real kernel patch series (and their reviews), stores them in PostgreSQL
(via PGLite locally), and serves a PWA dashboard for tracking, filtering, and reviewing them.

```
LKML sources ──► [ingest worker] ──► PostgreSQL ──► Hono API ──► React PWA dashboard
        (LISTEN/NOTIFY + FOR UPDATE SKIP LOCKED job queue)
```

## Stack

| Layer       | Technology                                                              |
| ----------- | ----------------------------------------------------------------------- |
| Language    | TypeScript (Bun runtime)                                                |
| Package mgr | [Bun](https://bun.sh) for the whole repo (`bun add`, not manual edits)  |
| ORM         | [Drizzle](https://orm.drizzle.team) (driver-swappable PGLite / node-postgres) |
| Database    | PostgreSQL for everything — **PGLite** locally & in tests, real Postgres in prod |
| API         | Hono on `Bun.serve`                                                     |
| Worker      | Postgres `LISTEN`/`NOTIFY` + `FOR UPDATE SKIP LOCKED` for exactly-once claims |
| Frontend    | React 19 + Vite + **PWA** (service worker + manifest via `vite-plugin-pwa`) |
| Config      | `dotenv` + `zod` (fail-fast validation)                                  |

## Repository layout

```
.
├── src/
│   ├── config/           # env loading + zod validation (fail-fast)
│   ├── db/
│   │   ├── schema.ts     # Drizzle schema + relations (ORM only, no direct PGLite)
│   │   ├── client.ts     # createDb(): PGLite <-> Postgres switch
│   │   ├── migrate.ts    # runtime migrations for both backends
│   │   ├── seed.ts       # seed when empty
│   │   └── reset.ts      # truncate all tables
│   ├── jobs/
│   │   ├── queue.ts      # enqueue + claimNextJob (SKIP LOCKED) + complete/fail
│   │   ├── listen.ts     # LISTEN job_queue (pg Client | PGlite listen)
│   │   ├── tasks.ts      # task registry (ingest.series, db.ping)
│   ├── services/lkml.ts  # patchwork / lore / sample sources + upsert
│   ├── api/app.ts        # Hono REST API
│   ├── index.ts          # API-only entry
│   ├── worker.ts         # background worker (claim loops + LISTEN/NOTIFY)
│   └── dev.ts            # dev: API + worker in one process
├── web/                  # React PWA dashboard (Vite)
├── drizzle/              # generated SQL migrations (committed)
├── tests/                # bun:test suite (config, queue, worker, api, lkml)
├── .env.example          # documented env vars with values
└── docker-compose.yml    # optional real Postgres for DB_BACKEND=postgres
```

## Getting started

Requirements: [Bun](https://bun.sh) ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`).
No Python is needed for this project, so `uv`/`pip` are intentionally not used.

```bash
bun install          # installs backend + web workspace deps

cp .env.example .env # then tweak as desired (defaults work out of the box)

bun run dev          # API (port 5174) + worker in one process
bun run dev:web      # Vite dev server (port 5173) with /api -> 5174 proxy
```

Open http://localhost:5173 (or use the exposed preview port).

### Database backend switch

- **PGLite (default, zero-config):** `DB_BACKEND=pglite`, data lives in `PGLITE_DATA_DIR` (`.pglite`). Use `:memory:` for an ephemeral DB.
- **Real PostgreSQL:** `docker compose up -d` then:

```bash
export DB_BACKEND=postgres
export DATABASE_URL=postgres://lkml:lkml@localhost:5432/lkml
bun run db:migrate
bun run dev
```

All data access goes through Drizzle; only the driver changes.

## Commands

```bash
bun run dev            # API + worker (single process, LISTEN/NOTIFY wired up)
bun run dev:api        # API only
bun run dev:worker     # worker only
bun run dev:web        # Vite dev server
bun run db:generate    # regenerate SQL migrations from schema
bun run db:migrate     # apply migrations (PGLite or Postgres)
bun run db:seed        # seed if empty
bun run db:reset       # truncate all tables
bun run ingest         # run one ingest pass directly
bun test               # run the test suite
bun run typecheck      # tsc --noEmit
bun run build:web      # production PWA build -> web/dist
```

## Data sources

| Source       | Description                                                                           |
| ------------ | ------------------------------------------------------------------------------------- |
| `patchwork`  | Real kernel series via `patchwork.kernel.org` API (mirrors LKML vger lists). **Default** |
| `lore`       | lore.kernel.org Atom feeds (often Anubis anti-bot protected; fails fast if blocked)     |
| `sample`     | Deterministic offline sample dataset (no network, used by tests / fallback)             |

If the configured real source fails, the ingest task falls back to `sample` data and records
`fallbackUsed: true` in `/api/meta` and `/api/stats`, so the dashboard always has content.

## Background jobs: LISTEN/NOTIFY + SKIP LOCKED

- `enqueueJob()` inserts into `jobs` and fires `pg_notify('job_queue', ...)`.
- The worker opens a `LISTEN job_queue` connection (a dedicated `pg.Client` on Postgres,
  an in-process `pg.listen()` on PGLite) so idle loops wake instantly instead of polling.
- Work is claimed with PostgreSQL's `FOR UPDATE SKIP LOCKED`:

```sql
UPDATE jobs
SET status = 'running', locked_by = $worker, attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending' AND available_at <= now()
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

- Concurrent workers/loops can never claim the same row; failed jobs retry with
  exponential backoff up to `JOB_MAX_ATTEMPTS`.
- `bun test tests/queue.test.ts` verifies exactly-once claims under contention.

## API

| Method | Path            | Description                                          |
| ------ | --------------- | ---------------------------------------------------- |
| GET    | `/api/health`   | DB ping                                             |
| GET    | `/api/config`   | Public config (no secrets)                          |
| GET    | `/api/series`   | List series (`status`, `q`, `source`, `author`, `limit`, `offset`) |
| GET    | `/api/series/:id` | Full detail incl. patches + reviews               |
| GET    | `/api/stats`    | Aggregates by status / source + last ingest         |
| GET    | `/api/jobs`     | Recent background jobs                              |
| POST   | `/api/jobs`     | Enqueue a job (`{ "type": "ingest.series", "payload": {...} }`) |
| GET    | `/api/meta`     | Last ingest metadata                                |

## Environment variables

See [`.env.example`](.env.example) — every variable is documented with its possible values.
`dotenv` injects values from `.env` (gitignored); `src/config/index.ts` validates them with
`zod` and **fails fast** on missing/invalid values (e.g. `DATABASE_URL` required when
`DB_BACKEND=postgres`).

## Testing

`bun test` spins up an in-memory PGLite per test file (migrated from the committed
`drizzle/` SQL), covering: config validation, SKIP LOCKED exactly-once claims,
end-to-end worker execution, the full API surface, and ingest idempotency.

## PWA

The dashboard is installable: `web/manifest.webmanifest` + `web/sw.js` are generated by
`vite-plugin-pwa` (`bun run build:web`). The service worker precaches the app shell and
caches `/api` responses with a NetworkFirst strategy so the dashboard stays usable offline.
