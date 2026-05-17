-- F2: load search extensions.
-- These are no-ops on PGLite when the extensions are loaded via the JS driver
-- (lib/db/index.ts passes pg_trgm + fuzzystrmatch into PGlite.create), but the
-- CREATE EXTENSION statement still flips the system catalog flag so SQL like
-- `text % text` and `similarity()` resolves to the operators provided by the
-- extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
