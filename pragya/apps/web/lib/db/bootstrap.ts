import { sql } from "drizzle-orm";
import { db, getDb } from "./client";

/**
 * Idempotent in-process bootstrap: creates tables if they don't exist.
 * Used in dev with PGLite so we don't need to run drizzle-kit before booting.
 */
let booted = false;

export async function ensureSchema() {
  if (booted) return;
  const handle = getDb();
  if (handle.driver === "pglite" && handle.pglite) {
    await handle.pglite.exec(BOOTSTRAP_SQL);
  } else {
    // For postgres-js, split into individual statements.
    const d = db();
    for (const stmt of BOOTSTRAP_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await d.execute(sql.raw(stmt));
    }
  }
  booted = true;
}

const BOOTSTRAP_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  age_baseline REAL NOT NULL,
  sex TEXT NOT NULL,
  education_years INTEGER NOT NULL,
  urban_rural TEXT NOT NULL,
  apoe4_carrier BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS participants_cohort_idx ON participants(cohort_id);
CREATE INDEX IF NOT EXISTS participants_age_idx ON participants(age_baseline);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  visit_index INTEGER NOT NULL,
  age_at_visit REAL NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_participant_idx ON visits(participant_id);
CREATE UNIQUE INDEX IF NOT EXISTS visits_unique_per_participant ON visits(participant_id, visit_index);

CREATE TABLE IF NOT EXISTS cognitive_assessments (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  memory REAL NOT NULL,
  executive REAL NOT NULL,
  language REAL NOT NULL,
  attention REAL NOT NULL,
  visuospatial REAL NOT NULL,
  mmse REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS mri_features (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  hippocampus_l REAL NOT NULL,
  hippocampus_r REAL NOT NULL,
  entorhinal_l REAL NOT NULL,
  entorhinal_r REAL NOT NULL,
  cortical_thickness_mean REAL NOT NULL,
  ventricular_volume REAL NOT NULL,
  white_matter_hyperintensities REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS oct_features (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  rnfl_thickness REAL NOT NULL,
  gcc_thickness REAL NOT NULL,
  vessel_density REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS biochem_features (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  hba1c REAL NOT NULL,
  ldl REAL NOT NULL,
  hdl REAL NOT NULL,
  triglycerides REAL NOT NULL,
  sbp REAL NOT NULL,
  dbp REAL NOT NULL,
  bmi REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS mci_outcomes (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  time_years REAL NOT NULL,
  mci_status BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_run_after_idx ON jobs(run_after);
CREATE INDEX IF NOT EXISTS jobs_kind_idx ON jobs(kind);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  params JSONB NOT NULL,
  metrics JSONB,
  artefact_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(id),
  horizon_years INTEGER NOT NULL,
  risk_point REAL NOT NULL,
  risk_lo_80 REAL NOT NULL,
  risk_hi_80 REAL NOT NULL,
  risk_lo_95 REAL NOT NULL,
  risk_hi_95 REAL NOT NULL,
  input_snapshot JSONB,
  made_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS predictions_participant_idx ON predictions(participant_id);
CREATE INDEX IF NOT EXISTS predictions_model_idx ON predictions(model_id);

CREATE TABLE IF NOT EXISTS harmonisation_runs (
  id TEXT PRIMARY KEY,
  cohort_ids JSONB NOT NULL,
  modalities JSONB NOT NULL,
  params JSONB NOT NULL,
  before_means JSONB,
  after_means JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS harmonised_features (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES harmonisation_runs(id) ON DELETE CASCADE,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  modality TEXT NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS harmonised_features_run_idx ON harmonised_features(run_id);
CREATE INDEX IF NOT EXISTS harmonised_features_visit_idx ON harmonised_features(visit_id);
CREATE INDEX IF NOT EXISTS harmonised_features_modality_idx ON harmonised_features(modality);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  calibration JSONB,
  subgroups JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
