-- Per-source display config: which payload fields to surface in entity listings.
-- Stored as JSONB array of { label: string, jsonpath: string, primary?: boolean }.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS display_columns JSONB NOT NULL DEFAULT '[]'::jsonb;
