# Search extensions: PGLite vs production Postgres

Notes for phase **F2** of `docs/PLAN.md`. Captures what's loadable where, and the bootstrap script syncbase will use on real Postgres.

## What PGLite supports (verified 2026-05-16 against pglite.dev/extensions)

| Extension | Purpose | PGLite import |
|---|---|---|
| `pg_trgm` | Trigram similarity (`%`, `similarity()`, `<->`). | `@electric-sql/pglite/contrib/pg_trgm` |
| `fuzzystrmatch` | `levenshtein()`, `soundex()`, `metaphone()`, `dmetaphone()`. | `@electric-sql/pglite/contrib/fuzzystrmatch` |
| `unaccent` | Diacritic stripping for tsvector dictionaries. | `@electric-sql/pglite/contrib/unaccent` |
| `btree_gin` | GIN ops for equality on scalar types — lets us put `category` / `state` into the same GIN index as `search_tsv`. | `@electric-sql/pglite/contrib/btree_gin` |
| `citext` | Case-insensitive text type. | `@electric-sql/pglite/contrib/citext` |
| `pgvector` | Vector similarity — kept on the shelf for an LLM-embedding phase. | `@electric-sql/pglite/vector` |
| `pg_textsearch` | Experimental BM25 ranking. **Not in the plan** — too new; we'll stick with built-in `tsvector` + `ts_rank_cd`. | `@electric-sql/pglite/pg_textsearch` |

Core Postgres features that are **already available** in PGLite without an extension:
- `to_tsvector`, `to_tsquery`, `plainto_tsquery`, `websearch_to_tsquery`, `phraseto_tsquery`
- GIN indexes on `tsvector` columns
- `ts_rank`, `ts_rank_cd`, `ts_headline`

## What we'll enable

For phase F2, the minimum set is **`pg_trgm` + `fuzzystrmatch`**. `unaccent` is nice-to-have but its dictionary file shipping in PGLite is finicky — we load it on best-effort and fall back to lowercase normalization at query time.

## PGLite loader (`lib/db/index.ts` snippet — for the F2 PR)

```ts
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { fuzzystrmatch } from "@electric-sql/pglite/contrib/fuzzystrmatch";
// optional, loaded best-effort:
let unaccent: any;
try { ({ unaccent } = await import("@electric-sql/pglite/contrib/unaccent")); } catch {}

const pglite = await PGlite.create({
  dataDir: env.PGLITE_PATH,
  extensions: { pg_trgm, fuzzystrmatch, ...(unaccent ? { unaccent } : {}) },
});
```

After connect, the migration runner issues:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
-- best-effort:
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS unaccent;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unaccent not available, skipping';
END $$;
```

## Production Postgres bootstrap (`scripts/enable-extensions.sql`)

```sql
-- Run once per deployment, as a Postgres superuser:
--   psql "$DATABASE_URL" -f scripts/enable-extensions.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- only if facet GIN indexes are added later
-- pg_cron is already loaded via shared_preload_libraries (see docker-compose.yml).
```

Hosted-PG caveats:

- **AWS RDS / Aurora Postgres** — `pg_trgm`, `fuzzystrmatch`, `unaccent`, `btree_gin`, `citext` are all on the [supported list](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html). `CREATE EXTENSION` works as the master user.
- **Azure Database for PostgreSQL Flexible Server** — all four are on the [allow-list](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-extensions). On Single Server (deprecated) they require an `azure.extensions` GUC.
- **GCP Cloud SQL** — `pg_trgm`, `fuzzystrmatch`, `unaccent`, `btree_gin`, `citext` are all on the [allow-list](https://cloud.google.com/sql/docs/postgres/extensions).
- **Supabase / Neon / Crunchy Bridge** — all four are pre-allowed; usually one-click via dashboard or just `CREATE EXTENSION`.

The bootstrap script is idempotent (`IF NOT EXISTS`) so it can ship as a step in CI and be re-run on every deploy without risk.

## Why not Elasticsearch / Meilisearch / Typesense / SQLite FTS5?

- syncbase already ships Postgres-only. Adding a second datastore for search doubles the failure surface and breaks the "DB-layer versioning" promise — the search index lives in the same DB as the source of truth.
- `tsvector` + GIN handles up to ~10M small documents on a single Postgres node before query times noticeably degrade. Auction inventory is well below that.
- `pg_trgm` covers the fuzzy use case (typos: "Bengaluru" / "Bangalore") that pure tsvector misses.

If we outgrow these (50M+ entities or sub-100ms p99 across millions of documents under load), the migration path is well-trodden: add Meilisearch as a secondary read store, fed by `change_log` → meili-sync worker. That's a separate PRD when we get there.

## Schema (F2 phase migration — `migrations/020_search_index.sql`)

```sql
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(payload->>'title', '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(payload->>'address', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(payload->>'city', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(payload->>'bank', '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(payload::text, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_entities_tsv
  ON entities USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_entities_title_trgm
  ON entities USING GIN ((coalesce(payload->>'title','')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_entities_address_trgm
  ON entities USING GIN ((coalesce(payload->>'address','')) gin_trgm_ops);
```

For dedicated-mode tables, `lib/ddl/generate.ts` appends the same DDL with `entities_<slug>` substituted. Both shared-generic and per-source-dedicated tables become globally searchable; `/api/search` queries the union via the table list maintained in `ddl_log`.

## Query plan for `/api/search` (G1 phase)

```sql
WITH q AS (SELECT websearch_to_tsquery('simple', $1) AS tq, $1 AS raw)
SELECT
  source, id, external_id,
  payload->>'title' AS title,
  ts_headline('simple', coalesce(payload->>'title',''), tq) AS snippet,
  ts_rank_cd(search_tsv, tq) AS tsv_rank,
  GREATEST(
    similarity(coalesce(payload->>'title',''), raw),
    similarity(coalesce(payload->>'address',''), raw)
  ) AS trgm_rank
FROM entities, q
WHERE search_tsv @@ tq
   OR (coalesce(payload->>'title','') % raw)
   OR (coalesce(payload->>'address','') % raw)
ORDER BY (tsv_rank * 0.7 + trgm_rank * 0.3) DESC
LIMIT $2 OFFSET $3;
```

The `%` operator uses the trigram GIN indexes; `@@` uses the tsvector GIN. With both indexes the query plan is two bitmap-index scans + a bitmap-or — sub-millisecond at the volumes we're targeting.
