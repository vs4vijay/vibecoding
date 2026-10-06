# Postgres-for-Everything Full-Stack Starter

A Next.js full-stack starter built on one idea: **use Postgres for everything**. No Redis, no RabbitMQ, no Docker for local development.

## Philosophy

- **One database for everything**: application data and the background job queue both live in Postgres.
- **One query path**: all code talks to the database through `executeQuery()` and the standard `pg` client, in every environment.
- **Zero-setup local development**: [PGlite](https://github.com/electric-sql/pglite) runs Postgres in a local Bun process and serves it over the Postgres wire protocol. Production uses a normal PostgreSQL server. The application code cannot tell the difference.
- **Swappable queue**: the app and the worker depend only on the `IQueue` interface.

## Tech Stack

- **Bun**: package manager and script/worker runtime
- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **PostgreSQL** in production, **PGlite** locally
- **Raw SQL via `pg`**, validated at the edges with **Zod**
- **Job queue** on `FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`
- **Prisma** for schema documentation and Prisma Studio only (never for queries)

## Quick Start

Requires [Bun](https://bun.sh) 1.0+.

```bash
bun install
bun run dev        # PGlite socket + Next.js + worker
```

Open http://localhost:7070. The schema is created automatically on first start. To add sample data, run `bun run db:seed` (it works whether or not the dev stack is running).

Create an item and watch the worker process it on the [job dashboard](http://localhost:7070/jobs):

```bash
curl -X POST http://localhost:7070/api/items \
  -H "Content-Type: application/json" \
  -d '{"name": "My Item", "description": "This triggers a background job"}'
```

## How Local Development Works

`bun run dev` manages three processes:

| Process  | What it does                                                                   |
| -------- | ------------------------------------------------------------------------------ |
| `DB`     | The only process that opens `./dev.db`; serves PGlite on `127.0.0.1:5433`      |
| `NEXT`   | The web app on port `7070`                                                     |
| `WORKER` | The background job worker                                                      |

The web app and the worker both receive `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres`. On shutdown the worker finishes its in-flight jobs before the database stops.

To run the pieces separately:

```bash
bun run dev:db
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres bun run dev:app
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres bun run dev:worker
```

If port `5433` is taken, set `PGLITE_PORT` to a free port (and use the same port in `DATABASE_URL` for separately launched processes).

## Scripts

```bash
bun run dev            # Full local stack
bun run dev:db         # Only the PGlite socket server
bun run dev:app        # Only Next.js
bun run dev:worker     # Only the worker

bun run db:init        # Apply the schema to DATABASE_URL (or to local PGlite)
bun run db:seed        # Reset the items table and insert sample rows
bun run db:generate    # Generate the Prisma client (only needed for Prisma Studio)
bun run db:studio      # Open Prisma Studio

bun run build          # Production build
bun run start          # Production web server
bun run start:worker   # Production worker
bun run lint
bun run typecheck
```

`db:init` and `db:seed` connect to `DATABASE_URL`. When that is unset or points at the local PGlite socket, they use the running dev stack if there is one and otherwise start PGlite just for the duration of the script.

## Project Structure

```
src/
├── app/
│   ├── api/items/          # Item CRUD endpoints
│   ├── api/jobs/           # List and enqueue jobs
│   ├── jobs/               # Job dashboard page
│   └── page.tsx
├── components/jobs/        # Dashboard components
├── lib/
│   ├── db.ts               # executeQuery(): the single query path
│   ├── schema.ts           # Schema SQL: the single source of truth
│   ├── api.ts              # Shared route helpers (pagination, error responses)
│   └── queue/
│       ├── types.ts        # IQueue interface and job types
│       ├── postgres-queue.ts  # SKIP LOCKED + LISTEN/NOTIFY implementation
│       ├── worker.ts       # Worker (depends only on IQueue)
│       └── index.ts        # Exports the `queue` instance the app uses
└── workers/
    ├── main.ts             # Worker process entrypoint
    └── tasks/
        ├── index.ts        # Task registry
        ├── process-item.ts
        └── send-notification.ts
scripts/
├── local-database.ts       # PGlite socket server helpers
├── start-database.ts       # `dev:db`
├── start-development.ts    # `dev`
├── initialize-database.ts  # `db:init`
└── seed-database.ts        # `db:seed`
prisma/schema.prisma        # Schema documentation (mirror of src/lib/schema.ts)
```

## Usage

### Querying the database

```typescript
import { executeQuery } from '@/lib/db';

const items = await executeQuery<{ id: string; name: string }>(
  'SELECT id, name FROM items WHERE id = $1',
  [itemId]
);
```

Always use `$1, $2` placeholders. Do not use Prisma client methods.

### Items API

```bash
curl "http://localhost:7070/api/items?limit=10&offset=0"
curl http://localhost:7070/api/items/{id}
curl -X PATCH http://localhost:7070/api/items/{id} \
  -H "Content-Type: application/json" -d '{"name": "Renamed"}'
curl -X DELETE http://localhost:7070/api/items/{id}
```

### Background jobs

Enqueue from any server code:

```typescript
import { queue } from '@/lib/queue';

await queue.enqueue('process-item', { itemId });
await queue.enqueue('send-notification', payload, {
  runAt: new Date(Date.now() + 60_000), // run later
  maxAttempts: 5,
  priority: 10,                         // higher runs first
  jobKey: `welcome:${userId}`,          // at most one unfinished job per key
});
```

Or over HTTP, for testing:

```bash
curl -X POST http://localhost:7070/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"taskName": "process-item", "payload": {"itemId": "your-item-id"}}'
```

How jobs behave:

- Workers claim jobs atomically with `FOR UPDATE SKIP LOCKED`, so you can run several worker processes against one database.
- `LISTEN/NOTIFY` wakes workers as soon as a job is enqueued; polling is the fallback.
- A job whose task throws is retried with exponential backoff (2s, 4s, 8s, ... capped at one hour) until `maxAttempts` is reached, then marked `failed`.
- A job left `active` by a worker that crashed is not reclaimed automatically.

### Adding a task

1. Create `src/workers/tasks/my-task.ts`:

```typescript
import { z } from 'zod';
import type { JobPayload } from '@/lib/queue/types';

const payloadSchema = z.object({ data: z.string() });

export default async function myTask(payload: JobPayload): Promise<void> {
  const { data } = payloadSchema.parse(payload);
  // Your task logic here. Throw to trigger a retry.
}
```

2. Register it in `src/workers/tasks/index.ts`:

```typescript
export const tasks: TaskRegistry = {
  // ...
  'my-task': myTask,
};
```

3. Enqueue it with `queue.enqueue('my-task', { data: 'example' })`.

The registry also feeds the task list on the dashboard and the validation in `POST /api/jobs`.

### Adding a table

1. Add an idempotent `CREATE TABLE IF NOT EXISTS` statement to `src/lib/schema.ts`.
2. Mirror it in `prisma/schema.prisma`.
3. Restart `bun run dev` (the schema is applied on start) or run `bun run db:init`.

The schema SQL only creates what is missing. To change an existing table locally, reset the database with `rm -rf dev.db`. For production, write the `ALTER TABLE` yourself or add a migration tool.

### Swapping the queue backend

1. Implement the `IQueue` interface from `src/lib/queue/types.ts` in a new file.
2. Change the `queue` export in `src/lib/queue/index.ts` to your implementation.

API routes, the dashboard, the worker, and tasks do not change.

## Production

Set a normal PostgreSQL connection string, apply the schema once, and run the web app and the worker as separate processes:

```bash
export DATABASE_URL=postgresql://user:password@host:5432/database

bun run db:init
bun run build
bun run start          # web
bun run start:worker   # worker (one or more replicas)
```

Deploying the web app does not start the worker; provision it as its own service. The PGlite socket server refuses to start when `NODE_ENV=production`.

## Environment Variables

| Variable                 | Default                                         | Purpose                                 |
| ------------------------ | ----------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`           | `postgresql://postgres@127.0.0.1:5433/postgres` | Database connection string              |
| `DATABASE_POOL_SIZE`     | `5`                                             | `pg` pool size per process              |
| `PGLITE_DATA_DIR`        | `./dev.db`                                      | Local database directory                |
| `PGLITE_HOST`            | `127.0.0.1`                                     | Local socket bind host                  |
| `PGLITE_PORT`            | `5433`                                          | Local socket port                       |

## Troubleshooting

**`127.0.0.1:5433 is already in use`**: another process (often a Docker Postgres) holds the port. Stop it or set `PGLITE_PORT`.

**Local database is broken or has an outdated schema**: reset it.

```bash
rm -rf dev.db
bun run db:init
```

**Jobs stay `pending`**: check that the worker is running (`[WORKER]` log lines), that it uses the same `DATABASE_URL` as the web app, and that the task is in the registry.

**`Cannot find module` errors from `next dev` after moving the project**: delete `.next` and restart.

## License

MIT
