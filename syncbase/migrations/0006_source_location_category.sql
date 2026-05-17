-- F1: optional location filter config + free-form category tag on each source.
-- `location` shape mirrors lib/validation.ts:LocationConfigSchema. NULL = no location filter.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS location JSONB;
