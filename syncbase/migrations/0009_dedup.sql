-- D1: intra-source duplicate detection bookkeeping.
-- canonical_id is always the lower-numbered entity id (oldest wins).
-- status: 'auto' (machine-flagged), 'confirmed' (operator confirmed dup), 'rejected' (overridden).

CREATE TABLE IF NOT EXISTS entity_duplicates (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT NOT NULL,
  canonical_id     BIGINT NOT NULL,
  duplicate_id     BIGINT NOT NULL,
  similarity       DOUBLE PRECISION NOT NULL,
  dedup_key_hash   TEXT NOT NULL,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL DEFAULT 'auto'
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_duplicates_pair_idx
  ON entity_duplicates(source, canonical_id, duplicate_id);
CREATE INDEX IF NOT EXISTS entity_duplicates_dup_idx
  ON entity_duplicates(duplicate_id);

CREATE TABLE IF NOT EXISTS entity_duplicate_overrides (
  source        TEXT NOT NULL,
  entity_a_id   BIGINT NOT NULL,
  entity_b_id   BIGINT NOT NULL,
  decision      TEXT NOT NULL,
  decided_by    TEXT NOT NULL,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, entity_a_id, entity_b_id)
);

-- per-source dedup config: list of { path, normalize } and a similarity threshold.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS dedup JSONB;
