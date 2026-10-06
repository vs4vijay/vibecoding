# Agent Instructions for Postgres-for-Everything Starter

This file provides guidance for AI coding agents working on this codebase.

## Project Architecture

This is a **Postgres-for-Everything** full-stack starter that uses PostgreSQL for all persistence needs:
- Application data storage
- Background job queue (via PostgreSQL LISTEN/NOTIFY + SKIP LOCKED)
- Local development uses **PGlite** (in-process Postgres)
- Production uses standard **PostgreSQL**

### Critical Design Principle
**Single abstraction layer**: The same code must work with both PGlite (local) and PostgreSQL (production). All database operations use raw SQL queries via the `executeQuery` helper function, which always connects over the Postgres wire protocol with `pg`. Locally, one PGlite process serves that protocol on `127.0.0.1:5433`; application code never imports PGlite.

## Tech Stack

- **Runtime**: Bun (not npm/yarn/pnpm)
- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Database**: PostgreSQL (prod) / PGlite (local)
- **ORM**: Prisma (for schema documentation and Prisma Studio only, NOT for queries)
- **Validation**: Zod (request bodies and job payloads)
- **Job Queue**: PostgreSQL LISTEN/NOTIFY + SKIP LOCKED (swappable)
- **Styling**: Tailwind CSS

## Key Files and Their Roles

### Database Layer
- `src/lib/db.ts` - Database abstraction layer
  - Exports `executeQuery()` function for all DB operations
  - **NEVER use Prisma client methods** (findMany, create, etc.)
  - **ALWAYS use executeQuery()** with raw SQL
- `src/lib/schema.ts` - Schema SQL, the single source of truth (idempotent `CREATE ... IF NOT EXISTS`)

### Job Queue (Generic Interface)
- `src/lib/queue/types.ts` - `IQueue` interface and Job types
- `src/lib/queue/postgres-queue.ts` - Default implementation using LISTEN/NOTIFY + SKIP LOCKED
- `src/lib/queue/worker.ts` - `Worker` class; depends only on `IQueue` and a task registry
- `src/lib/queue/index.ts` - Exports the `queue` instance used everywhere
  - `queue.enqueue()` - Add jobs to queue
  - `queue.getJobs()` / `queue.countJobs()` - Query job status
- `src/workers/main.ts` - Worker process entrypoint (runs as a separate process)

### Scripts
- `scripts/local-database.ts` - PGlite socket server helpers (`startLocalDatabase`, `withDatabase`)
- `scripts/start-database.ts` - `dev:db`: the single owner of `./dev.db`
- `scripts/start-development.ts` - `dev`: runs database, Next.js, and worker together
- `scripts/initialize-database.ts` - `db:init`: applies the schema through `executeQuery()`
- `scripts/seed-database.ts` - `db:seed`: resets and inserts local sample data
- PGlite may only be imported in `scripts/`

### API Routes
- `src/app/api/items/route.ts` - Item CRUD endpoints
- `src/app/api/jobs/route.ts` - Job management endpoints
- `src/lib/api.ts` - `parsePagination()` and `errorResponse()` shared by all routes
- **Pattern**: Use `executeQuery()` for all database operations

### Background Tasks
- `src/workers/tasks/*.ts` - Job task definitions
- `src/workers/tasks/index.ts` - Task registry (must register all tasks)
- Tasks receive (payload, job) and return Promise<void>; throwing triggers a retry with backoff

## Important Patterns

### Database Queries
```typescript
// ✅ CORRECT - Use executeQuery()
import { executeQuery } from '@/lib/db';

const items = await executeQuery('SELECT * FROM items WHERE id = $1', [itemId]);
const count = await executeQuery<{ count: number }>('SELECT COUNT(*)::int AS count FROM items');

// ❌ WRONG - Don't use Prisma client methods
const items = await prisma.item.findMany(); // This won't work with PGlite
```

### Adding New Database Tables
1. Add idempotent CREATE TABLE SQL in `src/lib/schema.ts` (the source of truth)
2. Mirror it in `prisma/schema.prisma` (documentation)
3. Restart `bun run dev` or run `bun run db:init`
4. Use `executeQuery()` to interact with new table

### Creating Background Jobs
1. Create task file in `src/workers/tasks/my-task.ts`:
```typescript
import { z } from 'zod';
import type { JobPayload } from '@/lib/queue/types';

const payloadSchema = z.object({ itemId: z.string() });

export default async function myTask(payload: JobPayload): Promise<void> {
  const { itemId } = payloadSchema.parse(payload);
  // Your task logic
}
```
2. Register task in `src/workers/tasks/index.ts`:
```typescript
export const tasks: TaskRegistry = {
  'my-task': myTask,
};
```
3. Use `executeQuery()` for database access
4. Enqueue with `queue.enqueue('my-task', payload)`

### Swapping Queue Implementation
The queue is designed to be swappable. To use a different queue:
1. Implement the `IQueue` interface in `src/lib/queue/`
2. Change the `queue` export in `src/lib/queue/index.ts`
3. API routes, worker, and tasks remain unchanged

Never import `PostgresQueue` outside `src/lib/queue/index.ts`, and never cast `queue` to a concrete class. If the worker or app needs a new capability, add it to `IQueue`.

### API Route Pattern
```typescript
import { randomUUID } from 'node:crypto';
import { errorResponse, parsePagination } from '@/lib/api';
import { executeQuery } from '@/lib/db';
import { queue } from '@/lib/queue';

export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = parsePagination(request.nextUrl.searchParams);
    const items = await executeQuery('SELECT * FROM items LIMIT $1 OFFSET $2', [limit, offset]);
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch items');
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = createItemSchema.parse(await request.json());
    const [item] = await executeQuery<{ id: string }>(
      'INSERT INTO items (id, name) VALUES ($1, $2) RETURNING *',
      [randomUUID(), data.name]
    );
    await queue.enqueue('process-item', { itemId: item.id });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to create item');
  }
}
```

## Development Commands

```bash
# Install dependencies
bun install

# Start the full local stack (PGlite socket + Next.js + worker); applies the schema on start
bun run dev

# Apply the schema / load sample data (work with or without the dev stack running)
bun run db:init
bun run db:seed

# Run the pieces separately (set DATABASE_URL for dev:app and dev:worker)
bun run dev:db
bun run dev:app
bun run dev:worker

# Verify changes
bun run lint
bun run typecheck
```

## Common Modifications

### Adding a New Model
1. Add CREATE TABLE SQL to `src/lib/schema.ts`
2. Mirror it in `prisma/schema.prisma`
3. Create API routes in `src/app/api/[model]/`
4. Use `executeQuery()` for all operations

### Adding a New Background Job
1. Create `src/workers/tasks/my-job.ts`
2. Export default function with (payload, job) signature; validate the payload with Zod
3. Register in `src/workers/tasks/index.ts`
4. Enqueue with `queue.enqueue()`

### Modifying Database Schema
1. Update `src/lib/schema.ts`
2. Update `prisma/schema.prisma` to match
3. The schema SQL only creates missing objects. To change an existing table locally, run `rm -rf dev.db` and restart

## Critical Rules

1. **Never use Prisma client query methods** - Only `executeQuery()`
2. **Use parameterized queries** - Always use `$1, $2` placeholders
3. **Use Bun commands** - Not npm/yarn/pnpm
4. **Raw SQL only** - `src/lib/schema.ts` is the schema; do not use Prisma migrations
5. **Keep PGlite/Postgres compatible** - Test SQL works with both
6. **Register all tasks** - Add new tasks to task registry
7. **Use `TIMESTAMPTZ`** - Never plain `TIMESTAMP`; it shifts times between JavaScript and Postgres
8. **Depend on `IQueue`** - Only `src/lib/queue/index.ts` names the concrete queue

## Next.js Specifics

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

### Additional Next.js Notes
- Type route handler context with the global `RouteContext<'/api/items/[id]'>` helper (run `bunx next typegen` if types are missing)
- Pages that query the database export `dynamic = 'force-dynamic'`; route handlers are dynamic by default
- Using **App Router** (not Pages Router)
- Server Components by default
- Client Components need `'use client'` directive
- Route handlers in `route.ts` files

## Database Schema

### Items Table
```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Jobs Table (Custom Queue)
```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  task_identifier TEXT NOT NULL,
  payload JSON DEFAULT '{}'::JSON NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  priority INTEGER DEFAULT 0 NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER DEFAULT 0 NOT NULL,
  max_attempts INTEGER DEFAULT 25 NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  completed_at TIMESTAMPTZ,
  key TEXT UNIQUE,
  queue TEXT
);
```

## Troubleshooting for Agents

**Error: Prisma client method doesn't work**
- Solution: Replace with `executeQuery()` and raw SQL

**Error: Schema change not applied locally**
- Solution: Update `src/lib/schema.ts`, then `rm -rf dev.db` and restart `bun run dev`

**Error: Worker not processing jobs**
- Solution: Ensure task is registered in `src/workers/tasks/index.ts` and the worker uses the same `DATABASE_URL`

**Error: `127.0.0.1:5433 is already in use`**
- Solution: Another process holds the port. Set `PGLITE_PORT` to a free port

**Error: connection refused on port 5433**
- Solution: The local database is not running. Start `bun run dev` or `bun run dev:db`

## Environment Variables

- `DATABASE_URL` - Database connection string
  - Local: `postgresql://postgres@127.0.0.1:5433/postgres` (PGlite socket; the default)
  - Production: `postgresql://...` (PostgreSQL)
- `PGLITE_PORT`, `PGLITE_HOST`, `PGLITE_DATA_DIR` - Local socket server settings

## Philosophy Reminders

This starter embraces **simplicity through PostgreSQL**:
- One database for everything
- No Redis, RabbitMQ, or additional services
- PGlite makes local development seamless
- Same code works in development and production
- Queue system is swappable - easy to replace with production-grade system

When making changes, preserve this philosophy and the PGlite/PostgreSQL dual compatibility.
