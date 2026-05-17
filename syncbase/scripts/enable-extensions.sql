-- Prod-Postgres bootstrap. Run once per database as a superuser before
-- `bun bin/cli.ts init` applies the search-index migration:
--
--   psql "$DATABASE_URL" -f scripts/enable-extensions.sql
--
-- All four extensions are pre-allowed on AWS RDS, GCP Cloud SQL, Azure
-- Flexible Server, Supabase, Neon, and Crunchy Bridge. Idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
