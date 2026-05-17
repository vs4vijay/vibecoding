-- F2: full-text + trigram search indexes on the shared `entities` table.
-- Dedicated-mode tables get the same indexes from lib/ddl/generate.ts at create time.
--
-- search_tsv is a STORED generated column so updates are tracked by the same
-- BEFORE trigger that bumps version_num — no extra maintenance.

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(payload->>'title',   '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(payload->>'name',    '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(payload->>'address', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(payload->>'city',    '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(payload->>'state',   '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(payload->>'bank',    '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(payload::text,       '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_entities_tsv
  ON entities USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_entities_title_trgm
  ON entities USING GIN ((coalesce(payload->>'title','') || ' ' || coalesce(payload->>'name','')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_entities_address_trgm
  ON entities USING GIN ((coalesce(payload->>'address','') || ' ' || coalesce(payload->>'city','')) gin_trgm_ops);
