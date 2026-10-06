/** The single source of truth for the database schema. Idempotent: safe to run on every start. */
export const schemaSql = `
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    task_identifier TEXT NOT NULL,
    payload JSON DEFAULT '{}'::JSON NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    priority INTEGER DEFAULT 0 NOT NULL,
    run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INTEGER DEFAULT 0 NOT NULL,
    max_attempts INTEGER DEFAULT 25 NOT NULL,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    completed_at TIMESTAMPTZ,
    key TEXT UNIQUE,
    queue TEXT
  );

  CREATE INDEX IF NOT EXISTS jobs_status_run_at_idx ON jobs (status, run_at);
  CREATE INDEX IF NOT EXISTS jobs_priority_run_at_idx ON jobs (priority, run_at);
`;
