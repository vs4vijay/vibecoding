# Development Database Modes

Application code always connects through the PostgreSQL wire protocol. The only
difference between development and production is which server owns that endpoint.

## Local full-stack development (default)

```bash
bun install
bun run db:generate
bun run db:init
bun run dev
```

`bun run dev` manages three processes:

- `dev-db`: the only process that opens `./dev.db`, exposing PGlite on `127.0.0.1:5433`
- `next`: the web application on port `7070`
- `worker`: the background-job worker

Web and worker both receive
`DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres`. The socket server
multiplexes their connections over its single PGlite instance, so there is no
concurrent file access and no Docker or external database dependency.

To run pieces separately:

```bash
bun run dev:db
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres bun run dev:next
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres bun run dev:worker
```

Do not run `db:init` while `dev-db` owns the database file. Stop the development
stack first.

## Production PostgreSQL

Set a normal PostgreSQL connection string and run web and worker as separate
processes. Never run `dev:db` in production; it refuses to start when
`NODE_ENV=production`.

```bash
DATABASE_URL=postgresql://user:password@host:5432/database bun run start
DATABASE_URL=postgresql://user:password@host:5432/database bun run dev:worker
```

The API, worker, queue, and `executeQuery()` use the same `pg` client path in both
modes. PGlite-specific code exists only in `scripts/dev-db.ts` and
`scripts/init-db.ts`.

## Configuration

- `PGLITE_DATA_DIR` — persistent local database path (default `./dev.db`)
- `PGLITE_HOST` — socket bind host (default `127.0.0.1`)
- `PGLITE_PORT` — socket port (default `5433`)
- `PGLITE_MAX_CONNECTIONS` — multiplexed connection limit (default `20`)
- `DATABASE_POOL_SIZE` — per-process `pg` pool size (default `5`)

If port `5433` is occupied, set the same `PGLITE_PORT` for `dev:db` and use a
matching `DATABASE_URL` for separately launched clients.
