-- Sources catalog
CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  http JSONB NOT NULL,
  pagination JSONB NOT NULL,
  records_path TEXT NOT NULL,
  external_id_path TEXT NOT NULL,
  hash_fields TEXT[],
  schedule_cron TEXT,
  storage_mode TEXT NOT NULL DEFAULT 'generic',
  typed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_table TEXT NOT NULL DEFAULT 'entities',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sources_name_idx ON sources(name);

-- Shared generic entities table
CREATE TABLE IF NOT EXISTS entities (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  version_num INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS entities_source_external_id_idx ON entities(source, external_id);

CREATE TABLE IF NOT EXISTS entities_versions (
  id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL,
  version_num INTEGER NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ NOT NULL,
  run_id BIGINT
);
CREATE INDEX IF NOT EXISTS entities_versions_entity_id_idx ON entities_versions(entity_id);

-- Runs telemetry
CREATE TABLE IF NOT EXISTS runs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL,
  source_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- Durable change outbox
CREATE TABLE IF NOT EXISTS change_log (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT,
  entity_id BIGINT NOT NULL,
  storage_table TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_hash TEXT,
  new_hash TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS change_log_changed_at_idx ON change_log(changed_at);
CREATE INDEX IF NOT EXISTS change_log_source_idx ON change_log(source);

-- DDL audit trail (used in Phase 5)
CREATE TABLE IF NOT EXISTS ddl_log (
  id BIGSERIAL PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_id BIGINT,
  statement TEXT NOT NULL,
  kind TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT
);
