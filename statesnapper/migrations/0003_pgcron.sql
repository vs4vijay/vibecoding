-- Postgres-only: install pg_cron. Skipped automatically on PGLite by migrate runner.
CREATE EXTENSION IF NOT EXISTS pg_cron;
