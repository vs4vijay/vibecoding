# Postgres-for-Everything Full-Stack Starter

A production-ready Next.js full-stack starter using the **"Postgres for everything"** philosophy. No Redis, no RabbitMQ, no additional infrastructure - just Postgres.

## Philosophy

This starter embraces simplicity by using PostgreSQL for all persistence needs:
- **Data storage**: Your application data
- **Job queue**: Background jobs via PostgreSQL LISTEN/NOTIFY + SKIP LOCKED
- **Caching**: Query results and materialized views (optional)
- **Local development**: PGlite runs in-process, no Docker needed

## Tech Stack

### Frontend
- **Next.js 15** - App Router for full-stack React
- **React 19** - Latest React with Server Components
- **Tailwind CSS** - Utility-first styling
- **TypeScript** - Type-safe development

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **Prisma ORM** - Type-safe database access
- **PostgreSQL** - Production database
- **PGlite** - In-process Postgres for local development
- **Postgres Queue** - Custom job queue using LISTEN/NOTIFY + SKIP LOCKED
- **Zod** - Runtime validation

### Development
- **Bun** - Fast package manager and runtime
- **ESLint** - Code linting
- **Custom dev runner** - Concurrent Next.js processes

## Features

### Database Abstraction
- Single codebase works with both PGlite (local) and PostgreSQL (production)
- Prisma provides seamless abstraction layer
- No environment-specific code needed

### Background Jobs
- Postgres-based job queue using native LISTEN/NOTIFY + SKIP LOCKED
- No additional services (Redis, RabbitMQ, etc.)
- Built-in retry logic and error handling
- Job persistence and history
- Atomic job claiming prevents race conditions

### Job Dashboard
- Custom Next.js dashboard for job monitoring
- View job status, attempts, errors
- Manual job triggering for testing
- Real-time stats and filtering

### Developer Experience
- Single command starts everything: `bun run dev`
- PGlite runs in-process - no Docker setup
- Hot reload for both frontend and backend
- Type-safe database queries with Prisma

## Getting Started

> **📝 Important**: This starter supports two development modes:
> - **Quick Mode** (PGlite) - Frontend + API only, no background worker [Default]
> - **Full Stack Mode** (PostgreSQL) - Complete system with background worker
>
> See [DEV_MODES.md](DEV_MODES.md) for detailed comparison.

### Quick Start (Recommended)

```bash
# Install and setup
bun install
bun run db:generate
bun run db:init

# Start development (API + Frontend only)
bun run dev:next
```

Visit http://localhost:7070 - Everything works except background job processing.

**Need background jobs?** See [DEV_MODES.md](DEV_MODES.md) for Full Stack Mode with PostgreSQL.

### Prerequisites
- **Bun** (v1.0+) - [Install Bun](https://bun.sh)
- **PGlite** - Included (no installation needed)
- **PostgreSQL** - Optional (only for background jobs)

### Detailed Setup Steps

1. Clone the repository:
```bash
git clone <your-repo-url>
cd vibecoding-starter
```

2. Install dependencies:
```bash
bun install
```

3. Generate Prisma client:
```bash
bun run db:generate
```

4. Initialize database (creates PGlite database with schema + seed data):
```bash
bun run db:init
```

5. Start development:
```bash
# Option A: Quick Mode (No background worker)
bun run dev:next

# Option B: Full Stack Mode (Requires PostgreSQL - see DEV_MODES.md)
bun run dev
```

### Verify Setup

1. Open [http://localhost:7070](http://localhost:7070) - View homepage
2. Open [http://localhost:7070/jobs](http://localhost:7070/jobs) - View job dashboard
3. Test API: [http://localhost:7070/api/items](http://localhost:7070/api/items)

## Project Structure

```
vibecoding-starter/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes
│   │   │   ├── items/         # CRUD endpoints
│   │   │   └── jobs/          # Job management
│   │   ├── jobs/              # Job dashboard page
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/            # React components
│   │   └── jobs/              # Job dashboard components
│   ├── lib/                   # Shared utilities
│   │   ├── db.ts             # Prisma client (PGlite/Postgres)
│   │   ├── worker.ts         # Queue wrapper
│   │   └── queue/            # Queue implementation
│   │       ├── types.ts      # Queue interfaces
│   │       ├── postgres-queue.ts  # LISTEN/NOTIFY implementation
│   │       └── worker.ts     # Worker implementation
│   └── workers/               # Background job definitions
│       └── tasks/
│           ├── index.ts      # Task registry
│           ├── process-item.ts
│           └── send-notification.ts
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # Migration history
│   └── seed.ts               # Seed data
├── scripts/
│   └── dev.ts                # Development runner
├── .env.example
│   ├── .env.local
│   ├── package.json
│   └── README.md
```

## Usage

### Creating Items (API)

Create a new item:
```bash
curl -X POST http://localhost:7070/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Item",
    "description": "This will trigger a background job",
    "processInBackground": true
  }'
```

Get all items:
```bash
curl http://localhost:7070/api/items
```

Get specific item:
```bash
curl http://localhost:7070/api/items/{id}
```

### Background Jobs

Jobs are automatically enqueued when creating items with `processInBackground: true`.

View jobs in the dashboard: [http://localhost:7070/jobs](http://localhost:7070/jobs)

Manually enqueue a job:
```bash
curl -X POST http://localhost:7070/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "taskName": "process-item",
    "payload": {
      "itemId": "your-item-id"
    }
  }'
```

### Creating New Jobs

1. Create a new task file in `src/workers/tasks/`:

```typescript
// src/workers/tasks/my-task.ts
import { JobPayload, Job } from '@/lib/queue/types';

export default async function myTask(payload: JobPayload, _job: Job): Promise<void> {
  const { data } = payload as { data: string };

  console.log('Processing:', data);

  // Your task logic here
  await doSomething(data);

  console.log('Completed successfully');
}
```

2. Register the task in `src/workers/tasks/index.ts`:

```typescript
import { Worker } from '@/lib/queue/worker';

export function registerAllTasks(worker: Worker): void {
  worker.registerTask('my-task', myTask);
}
```

3. Enqueue the job from your API route:

```typescript
import { enqueueJob } from '@/lib/worker';

await enqueueJob('my-task', {
  data: 'example',
});
```

### Adding New Models

1. Update `prisma/schema.prisma`:
```prisma
model MyModel {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())

  @@map("my_models")
}
```

2. Generate Prisma client:
```bash
bun run db:generate
```

3. Push schema changes:
```bash
bun run db:push
```

4. Create API routes in `src/app/api/my-model/route.ts`

## Database Scripts

```bash
# Generate Prisma client
bun run db:generate

# Push schema changes (for development)
bun run db:push

# Create migration (for production)
bun run db:migrate

# Seed database
bun run db:seed

# Open Prisma Studio (database GUI)
bun run db:studio
```

## Development Scripts

```bash
# Start full development environment (Next.js + Worker)
bun run dev

# Start only Next.js
bun run dev:next

# Start only Worker (requires PostgreSQL)
bun run dev:worker

# Build for production
bun run build

# Start production server
bun run start

# Run linter
bun run lint
```

## Production Deployment

### Database Setup

1. Update `.env` with production PostgreSQL connection:
```env
DATABASE_URL="postgresql://user:password@host:5432/database"
NODE_ENV="production"
```

2. Run migrations:
```bash
bun run db:migrate
```

### Deployment Options

This starter can be deployed to:
- **Vercel** - Next.js native platform
- **Railway** - With Postgres addon
- **Render** - Web service + Postgres
- **Fly.io** - Docker deployment
- **Any Node.js host** with Postgres access

### Worker Deployment

For production, run the worker as a separate process:

```bash
bun run dev:worker
```

Or use a process manager like PM2:
```bash
pm2 start "bun run dev:worker" --name worker
```

## Environment Variables

### Required

- `DATABASE_URL` - Database connection string
  - Local: `file:./dev.db` (PGlite)
  - Production: `postgresql://user:password@host:5432/database`

### Optional

- `NODE_ENV` - Environment mode (`development` | `production`)

## Architecture Decisions

### Why Postgres for Everything?

1. **Simplicity** - One system to manage, backup, and monitor
2. **Cost** - No additional services (Redis, RabbitMQ, etc.)
3. **ACID Guarantees** - Transactional job queuing
4. **Postgres is Fast** - Modern Postgres handles high throughput
5. **Unified Queries** - Join jobs with application data

### Why PGlite for Local Development?

1. **No Installation** - Runs in-process, no Docker needed
2. **Fast** - SQLite-like performance for development
3. **Compatible** - Prisma works identically with both
4. **Portable** - Single file database (`dev.db`)

### Why Postgres LISTEN/NOTIFY + SKIP LOCKED?

1. **Postgres-native** - Uses native Postgres features
2. **Atomic claiming** - SKIP LOCKED prevents race conditions
3. **Notification-based** - LISTEN/NOTIFY for real-time job dispatch
4. **Simple** - No external dependencies or complexity
5. **Extensible** - Easy to swap for Redis, RabbitMQ, etc.

### Queue Abstraction

The queue system is designed to be easily swappable:

```
src/lib/queue/
├── types.ts           # IQueue interface (defines contract)
├── postgres-queue.ts  # Default implementation (LISTEN/NOTIFY)
└── worker.ts         # Worker implementation
```

To switch to a different queue (Redis, RabbitMQ, etc.):
1. Implement the `IQueue` interface in a new file
2. Update the worker to use your implementation
3. No changes needed to API routes or tasks

## Troubleshooting

### PGlite Issues

If you encounter PGlite errors, delete the database file:
```bash
rm dev.db
bun run db:init
```

### Worker Not Processing Jobs

1. Check worker is running (should see log output)
2. Verify DATABASE_URL is correct
3. Check job dashboard for errors
4. Review task file exports and registration

### Prisma Client Errors

Regenerate Prisma client:
```bash
bun run db:generate
```

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT

## Credits

Built with:
- [Next.js](https://nextjs.org)
- [Prisma](https://prisma.io)
- [PGlite](https://github.com/electric-sql/pglite)
- [PostgreSQL](https://postgresql.org)
- [Bun](https://bun.sh)