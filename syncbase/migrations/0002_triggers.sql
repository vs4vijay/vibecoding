-- Table-agnostic versioning, split into BEFORE UPDATE (snapshot + bump version)
-- and AFTER INSERT/UPDATE (change_log + pg_notify).
--
-- We use AFTER triggers for change_log because in an INSERT ... ON CONFLICT DO
-- UPDATE WHERE ... the BEFORE INSERT trigger fires speculatively before the
-- conflict is resolved, so it can't be trusted to distinguish "actually
-- inserted" from "swapped to update or skipped". AFTER INSERT only fires when
-- the row was truly inserted; AFTER UPDATE only fires when the WHERE clause
-- in DO UPDATE allowed the row to actually change.

CREATE OR REPLACE FUNCTION entities_diff_before() RETURNS trigger AS $$
DECLARE
  current_run_id BIGINT := nullif(current_setting('app.run_id', true), '')::bigint;
  versions_table TEXT := TG_TABLE_NAME || '_versions';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.content_hash = NEW.content_hash THEN
      RETURN NEW;
    END IF;
    EXECUTE format(
      'INSERT INTO %I (entity_id, version_num, payload, content_hash, valid_from, valid_to, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)', versions_table
    ) USING OLD.id, OLD.version_num, OLD.payload, OLD.content_hash,
            OLD.updated_at, now(), current_run_id;
    NEW.version_num := OLD.version_num + 1;
    NEW.updated_at  := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION entities_diff_after() RETURNS trigger AS $$
DECLARE
  current_run_id BIGINT := nullif(current_setting('app.run_id', true), '')::bigint;
  ev JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO change_log(run_id, entity_id, storage_table, source, external_id,
                           change_type, new_hash)
    VALUES (current_run_id, NEW.id, TG_TABLE_NAME, NEW.source, NEW.external_id,
            'created', NEW.content_hash);
    ev := jsonb_build_object('type','created','table',TG_TABLE_NAME,
                             'source',NEW.source,'external_id',NEW.external_id,
                             'hash',NEW.content_hash);
    PERFORM pg_notify('entity_changed', ev::text);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.content_hash = NEW.content_hash THEN
      RETURN NULL;
    END IF;
    INSERT INTO change_log(run_id, entity_id, storage_table, source, external_id,
                           change_type, old_hash, new_hash)
    VALUES (current_run_id, OLD.id, TG_TABLE_NAME, OLD.source, OLD.external_id,
            'updated', OLD.content_hash, NEW.content_hash);
    ev := jsonb_build_object('type','updated','table',TG_TABLE_NAME,
                             'source',OLD.source,'external_id',OLD.external_id,
                             'old_hash',OLD.content_hash,'new_hash',NEW.content_hash);
    PERFORM pg_notify('entity_changed', ev::text);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entities_diff_trg ON entities;
DROP TRIGGER IF EXISTS entities_diff_before_trg ON entities;
DROP TRIGGER IF EXISTS entities_diff_after_trg ON entities;

CREATE TRIGGER entities_diff_before_trg
BEFORE UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION entities_diff_before();

CREATE TRIGGER entities_diff_after_trg
AFTER INSERT OR UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION entities_diff_after();
