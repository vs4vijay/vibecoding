# Agent Instructions for Postgres-for-Everything Starter

This file provides guidance for AI coding agents working on this codebase.

## Project Architecture

This is a **Postgres-for-Everything** full-stack starter that uses PostgreSQL for all persistence needs:
- Application data storage
- Background job queue (via Graphile Worker)
- Local development uses **PGlite** (in-process Postgres)
- Production uses standard **PostgreSQL**

### Critical Design Principle
**Single abstraction layer**: The same code must work with both PGlite (local) and PostgreSQL (production). All database operations use raw SQL queries via the `executeQuery` helper function.

## Tech Stack

- **Runtime**: Bun (not npm/yarn/pnpm)
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Database**: PostgreSQL (prod) / PGlite (local)
- **ORM**: Prisma (for schema only, NOT for queries)
- **Job Queue**: Graphile Worker
- **Styling**: Tailwind CSS

## Key Files and Their Roles

### Database Layer
- `src/lib/db.ts` - Database abstraction layer
  - Exports `executeQuery()` function for all DB operations
  - Handles PGlite vs PostgreSQL switching
  - **NEVER use Prisma client methods** (findMany, create, etc.)
  - **ALWAYS use executeQuery()** with raw SQL

### Job Queue
- `src/lib/worker.ts` - Graphile Worker configuration
  - `enqueueJob()` - Add jobs to queue
  - `getJobs()` - Query job status
  - Worker runs as separate process

### Database Initialization
- `scripts/init-db.ts` - Creates schema in PGlite
  - Creates items table
  - Creates Graphile Worker tables
  - Seeds sample data

### API Routes
- `src/app/api/items/route.ts` - Item CRUD endpoints
- `src/app/api/jobs/route.ts` - Job management endpoints
- **Pattern**: Use `executeQuery()` for all database operations

### Background Tasks
- `src/workers/tasks/*.ts` - Job task definitions
  - Must export default Task function
  - Use `executeQuery()` for database access
  - Graphile Worker auto-loads from this directory

## Important Patterns

### Database Queries
```typescript
// ✅ CORRECT - Use executeQuery()
import { executeQuery } from '@/lib/db';

const items = await executeQuery('SELECT * FROM items WHERE id = $1', [itemId]);
const count = await executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM items');

// ❌ WRONG - Don't use Prisma client methods
const items = await prisma.item.findMany(); // This won't work with PGlite
```

### Adding New Database Tables
1. Update `prisma/schema.prisma` (for schema documentation)
2. Add CREATE TABLE in `scripts/init-db.ts`
3. Run `bun run db:generate` and `bun run db:init`
4. Use `executeQuery()` to interact with new table

### Creating Background Jobs
1. Create task file in `src/workers/tasks/my-task.ts`
2. Export default Task function
3. Use `executeQuery()` for database access
4. Enqueue with `enqueueJob('my-task', payload)`

### API Route Pattern
```typescript
import { executeQuery } from '@/lib/db';
import { enqueueJob } from '@/lib/worker';

export async function GET(request: NextRequest) {
  const items = await executeQuery('SELECT * FROM items LIMIT 10');
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  await executeQuery('INSERT INTO items (id, name) VALUES ($1, $2)', [id, name]);
  await enqueueJob('process-item', { itemId: id });
  return NextResponse.json({ success: true });
}
```

## Development Commands

```bash
# Install dependencies
bun install

# Generate Prisma client
bun run db:generate

# Initialize PGlite database
bun run db:init

# Start dev server (Next.js + Worker)
bun run dev

# Start only Next.js
bun run dev:next

# Start only Worker
bun run dev:worker
```

## Common Modifications

### Adding a New Model
1. Add to `prisma/schema.prisma`
2. Add CREATE TABLE to `scripts/init-db.ts`
3. Create API routes in `src/app/api/[model]/`
4. Use `executeQuery()` for all operations

### Adding a New Background Job
1. Create `src/workers/tasks/my-job.ts`
2. Export default Task function
3. Enqueue from API routes with `enqueueJob()`

### Modifying Database Schema
1. Update `prisma/schema.prisma`
2. Update `scripts/init-db.ts` with new CREATE/ALTER statements
3. Run `bun run db:init` (or delete dev.db and re-init)

## Critical Rules

1. **Never use Prisma client query methods** - Only `executeQuery()`
2. **Use parameterized queries** - Always use `$1, $2` placeholders
3. **Use Bun commands** - Not npm/yarn/pnpm
4. **Raw SQL only** - PGlite doesn't support Prisma migrations
5. **Keep PGlite/Postgres compatible** - Test SQL works with both

## Next.js Specifics

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

### Additional Next.js Notes
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Graphile Worker Tables
Automatically managed in `graphile_worker` schema. Key table:
- `graphile_worker.jobs` - Job queue

## Troubleshooting for Agents

**Error: Prisma client method doesn't work**
- Solution: Replace with `executeQuery()` and raw SQL

**Error: Migration failed**
- Solution: PGlite doesn't support Prisma migrations. Use `scripts/init-db.ts`

**Error: Worker not finding tasks**
- Solution: Ensure task file exports default Task function

**Error: Database not found**
- Solution: Run `bun run db:init` to create dev.db

## Environment Variables

- `DATABASE_URL` - Database connection string
  - Local: `file:./dev.db` (PGlite)
  - Production: `postgresql://...` (PostgreSQL)

## Philosophy Reminders

This starter embraces **simplicity through PostgreSQL**:
- One database for everything
- No Redis, RabbitMQ, or additional services
- PGlite makes local development seamless
- Same code works in development and production

When making changes, preserve this philosophy and the PGlite/PostgreSQL dual compatibility.
