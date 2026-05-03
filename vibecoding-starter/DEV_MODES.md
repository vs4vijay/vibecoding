# Development Modes

This starter supports two development modes depending on your needs.

## 🚀 Quick Mode (PGlite) - Recommended for Most Development

**Best for**: API development, frontend work, testing database queries

### Setup
```bash
bun install
bun run db:generate
bun run db:init
bun run dev:next
```

### What Works
- ✅ Next.js frontend
- ✅ All API routes (GET, POST, PATCH, DELETE)
- ✅ Database queries via PGlite
- ✅ Database CRUD operations
- ✅ Fast startup (no Docker needed)

### What Doesn't Work
- ❌ Background job processing
- ❌ Graphile Worker
- ⚠️ Jobs can be enqueued but won't process

### When to Use
- Building API endpoints
- Developing frontend features
- Testing database models
- Quick iteration cycles

---

## 🔧 Full Stack Mode (PostgreSQL) - For Background Jobs

**Best for**: Testing background jobs, full system integration

### Setup

**Option 1: Docker** (Recommended)
```bash
# 1. Start PostgreSQL
docker run -d --name postgres-dev \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=vibecoding \
  -p 5432:5432 \
  postgres:16

# 2. Update .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vibecoding"

# 3. Install dependencies
bun install
bun run db:generate

# 4. Run migrations
bun run db:migrate

# 5. Seed database
bun run db:seed

# 6. Start full stack
bun run dev
```

**Option 2: Local PostgreSQL**
```bash
# If you have PostgreSQL installed locally
DATABASE_URL="postgresql://youruser:yourpass@localhost:5432/vibecoding"

bun run db:migrate
bun run db:seed
bun run dev
```

### What Works
- ✅ Everything from Quick Mode
- ✅ Background job processing
- ✅ Graphile Worker
- ✅ Job dashboard with real-time updates
- ✅ Full production parity

### When to Use
- Testing background jobs
- Developing worker tasks
- Integration testing
- Pre-production validation

---

## 📊 Comparison

| Feature | Quick Mode (PGlite) | Full Stack (PostgreSQL) |
|---------|-------------------|----------------------|
| Setup Time | ~30 seconds | ~2 minutes |
| Dependencies | None | Docker or PostgreSQL |
| Frontend | ✅ | ✅ |
| API Routes | ✅ | ✅ |
| Database Queries | ✅ | ✅ |
| Background Jobs | ❌ | ✅ |
| Job Dashboard | ⚠️ (shows UI only) | ✅ (full functionality) |
| Startup Speed | Very Fast | Fast |
| Resource Usage | Minimal | Light-Medium |

---

## 🔄 Switching Between Modes

### From PGlite to PostgreSQL

1. **Start PostgreSQL** (Docker or local)

2. **Update environment**:
   ```bash
   # Change .env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vibecoding"
   ```

3. **Initialize database**:
   ```bash
   bun run db:migrate
   bun run db:seed
   ```

4. **Restart**:
   ```bash
   # Stop current server (Ctrl+C)
   bun run dev
   ```

### From PostgreSQL to PGlite

1. **Update environment**:
   ```bash
   # Change .env
   DATABASE_URL="file:./dev.db"
   ```

2. **Reinitialize** (if needed):
   ```bash
   rm dev.db
   bun run db:init
   ```

3. **Restart**:
   ```bash
   # Stop current server (Ctrl+C)
   bun run dev:next
   ```

---

## 💡 Recommended Workflow

### During Development
1. Start with **Quick Mode** for API/frontend work
2. Switch to **Full Stack Mode** when testing jobs
3. Use **Quick Mode** for most day-to-day development

### Before Deployment
1. Test in **Full Stack Mode** with PostgreSQL
2. Validate all background jobs work
3. Check job dashboard functionality
4. Run integration tests

### In Production
- Always use **PostgreSQL**
- Run worker as separate process
- Monitor job dashboard

---

## 🐛 Troubleshooting

### "Worker exits with code 99"
**Cause**: Using PGlite with Graphile Worker
**Solution**: Switch to Full Stack Mode with PostgreSQL

### "Database connection failed"
**Cause**: PostgreSQL not running
**Solution**: Start Docker container or local PostgreSQL

### "No jobs processing"
**Cause**: Worker not running or using PGlite
**Solution**: Use Full Stack Mode and check worker logs

### "Can't connect to database"
**Cause**: Wrong DATABASE_URL
**Solution**: Check `.env` file matches your setup

---

## 🎯 Quick Reference

```bash
# Quick Mode (No jobs)
DATABASE_URL="file:./dev.db"
bun run dev:next

# Full Stack Mode (With jobs)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vibecoding"
bun run dev

# Just Worker (Testing jobs only)
bun run dev:worker

# Production Build
bun run build
bun run start
```

---

## 📚 Related Documentation

- [QUICKSTART.md](QUICKSTART.md) - 60-second setup
- [README.md](README.md) - Full documentation
- [VALIDATION_REPORT.md](VALIDATION_REPORT.md) - Test results
- [AGENTS.md](AGENTS.md) - Development guidelines

Choose the mode that fits your current development task!
