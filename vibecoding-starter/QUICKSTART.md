# Quick Start Guide

Get your Postgres-for-Everything stack running in 60 seconds.

> This quick start runs the complete stack, including background jobs, on PGlite.

## Prerequisites

Install [Bun](https://bun.sh):
```bash
curl -fsSL https://bun.sh/install | bash
```

## Setup

```bash
# 1. Install dependencies
bun install

# 2. Generate Prisma client
bun run db:generate

# 3. Initialize and seed the database
bun run db:init
bun run db:seed

# 4. Start PGlite socket, Next.js, and the worker
bun run dev
```

## Verify Installation

1. **Homepage**: http://localhost:7070
2. **Job Dashboard**: http://localhost:7070/jobs
3. **Items API**: http://localhost:7070/api/items

## Test the System

Create an item and watch the background job process it:

```bash
curl -X POST http://localhost:7070/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Item",
    "description": "Testing background jobs",
    "processInBackground": true
  }'
```

Then check the job dashboard to see the job execute in real-time!

## What's Running?

When you run `bun run dev`:
- **PGlite socket owner** on port 5433, with persistent data at `./dev.db`
- **Next.js dev server** on port 7070
- **Worker** processing jobs through the same database socket

All running locally, no Docker or external services needed.

## Next Steps

- Read the [full README](README.md) for detailed documentation
- Explore the [project structure](README.md#project-structure)
- Learn how to [create new jobs](README.md#creating-new-jobs)
- Add your own [database models](README.md#adding-new-models)

## Troubleshooting

**Database errors?**
```bash
rm dev.db
bun run db:init
```

**Worker not processing jobs?**
- Check that both Next.js and worker are running (you should see colored logs)
- Visit the job dashboard to see job status and errors

**Need help?**
Check the [troubleshooting section](README.md#troubleshooting) in the full README.
