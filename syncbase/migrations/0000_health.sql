CREATE TABLE IF NOT EXISTS health (
  id BIGSERIAL PRIMARY KEY,
  note TEXT NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO health (note) VALUES ('phase-0-skeleton-ready');
