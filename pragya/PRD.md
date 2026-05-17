# DRISHTI - Product Requirements Document

> Working artifact for the v1 prototype that ships alongside the CBR AI Challenge proposal. Companion to PROPOSAL.md (the formal submission) and PLAN.md (the build plan).

## 1. Product overview

DRISHTI (Dementia Risk and Imaging-Subgroup Health Trajectory Index) is a multimodal MCI conversion risk prediction system, calibrated for Indian adults, with cross-cohort harmonisation to leverage global cohort data.

The v1 prototype is an end-to-end working pipeline: data ingestion -> harmonisation -> training -> prediction -> clinician-facing demo, running on synthetic data. Real CBR data (TLSA, SANSCOG) becomes available only post-shortlist; the v1 architecture is designed to swap synthetic for real cohorts with no code change beyond ETL.

## 2. Problem statement (short form)

Indian adults are systematically underrepresented in the global cohorts (ADNI, UK Biobank, OASIS, NACC, AIBL) that have shaped modern dementia AI. Risk models trained on those cohorts miscalibrate on Indian patients. India's preventable dementia burden (cardio-metabolic disease, hearing loss, education inequality) is the largest in the world. We need Indian-calibrated, harmonisation-aware risk tools, calibrated specifically for the population they serve.

Long form: see PROBLEM.md.

## 3. Users and personas

- **Clinician (primary user of the demo)**. Memory or cognitive disorders clinic; wants per-patient risk estimates with calibrated uncertainty and an easy "why" explanation.
- **Research scientist (secondary)**. Wants to inspect model performance, run cohort imports, kick off training jobs, audit subgroup fairness.
- **Reviewer / Jury (proposal stage)**. Wants to verify the v1 is a real working system, not vapourware.

## 4. v1 scope (what ships)

In scope for v1:

- Multimodal participant data model: demographics, cognitive assessments, MRI-derived features, OCT or retinal features, blood biochemistry, omics (ApoE flag only).
- Longitudinal visit model (multiple time points per participant).
- Synthetic data generator producing realistic-shaped patient records with longitudinal structure.
- Cohort import pipeline (synthetic source for v1, designed for real cohorts in v2).
- Feature harmonisation pipeline (Python, ComBat-style baseline).
- Survival model training pipeline (Python; simple discrete-time hazard model on synthetic data is acceptable for v1).
- Per-participant prediction at 1, 3, 5 year horizons with uncertainty intervals.
- Clinician-facing web UI: participant list, participant detail, prediction view with risk curves.
- Job queue using Postgres LISTEN/NOTIFY and SKIP LOCKED.
- Subgroup fairness audit page (calibration and discrimination per stratum).
- Validation: missing-modality robustness, deterministic seeds.

Out of scope for v1 (planned for v2 or post-shortlist):

- Real CBR data ingestion (gated by shortlist + DUA).
- Public-cohort ingestion (ADNI, OASIS, NACC, AIBL); v1 uses synthetic only.
- Neural ODE trajectory decoder (digital twin layer).
- Counterfactual head (modifiable-factor what-if simulation).
- Raw DICOM processing; v1 consumes tabulated features only.
- Authentication and multi-tenancy.
- Clinical-grade audit logging.

## 5. Functional requirements

### 5.1 Participant management
- FR-1: System stores participant records with demographics (age, sex, education years, urban/rural).
- FR-2: System stores zero or more longitudinal visits per participant.
- FR-3: Each visit captures multimodal observations (cognitive, MRI features, OCT, biochem, ApoE).
- FR-4: UI lists participants with filters (age band, sex, education tier, urban/rural).
- FR-5: UI shows per-participant detail with all visits and trajectory.

### 5.2 Synthetic data
- FR-6: A CLI command generates N synthetic participants with M visits each, deterministically (seeded RNG).
- FR-7: Synthetic data preserves plausible correlation structure (e.g. age correlates with hippocampal volume).
- FR-8: A `--cohort` flag tags generated data with a synthetic cohort name (to simulate cross-cohort harmonisation).

### 5.3 Harmonisation pipeline
- FR-9: System exposes a `harmonise` job that applies ComBat-style correction to MRI and biochem features across cohorts.
- FR-10: Harmonised features are stored alongside raw features (no destruction of source data).
- FR-11: A harmonisation run is auditable (input cohorts, transformation parameters, output count).

### 5.4 Training pipeline
- FR-12: System exposes a `train` job that fits a survival model on harmonised features.
- FR-13: Training writes a model artefact and metadata (metrics, training set composition) to the DB.
- FR-14: System tracks multiple model versions; latest active model is queryable.

### 5.5 Prediction
- FR-15: For any participant, the system can compute MCI conversion risk at 1, 3, 5 year horizons.
- FR-16: Predictions return point estimates plus 80% and 95% intervals.
- FR-17: Predictions are stored in the DB with provenance (model version, input snapshot timestamp).
- FR-18: UI displays a risk curve per participant.

### 5.6 Fairness and calibration
- FR-19: System computes calibration plots (predicted vs observed) on a held-out split.
- FR-20: System computes per-subgroup AUROC, AUPRC, calibration error (by sex, education tier, urban/rural, age band).
- FR-21: UI exposes the audit as a dashboard.

### 5.7 Background jobs
- FR-22: Long-running operations (harmonisation, training, batch prediction) execute as background jobs.
- FR-23: Job queue uses Postgres LISTEN/NOTIFY for wake-up and SKIP LOCKED for safe dequeue.
- FR-24: Jobs are retryable on failure with bounded retries.
- FR-25: Job status is observable via UI (running, succeeded, failed) and via API.

## 6. Non-functional requirements

- NFR-1: All ML compute is performed by the Python service; no ML code in the TS layer.
- NFR-2: All DB access from the TS layer goes through Drizzle ORM. No raw SQL beyond the ORM's escape hatches.
- NFR-3: Python service is stateless; it reads participant data and writes results via the TS HTTP API. No direct DB connection from Python in v1.
- NFR-4: Local development uses PGLite as the Postgres backend (no Docker required for the happy path). Production uses real Postgres.
- NFR-5: All configuration is via environment variables; a typed `config` object validates on app start and fails fast on missing or invalid values.
- NFR-6: All ports, hosts, secrets, and connection strings come from `.env`. A versioned `.env.example` documents every variable with sample values.
- NFR-7: All ML jobs are deterministic given the same seed; seeds are configurable per job.
- NFR-8: Synthetic data generation is fully reproducible.

## 7. Tech stack

- **TS app and worker**: Bun runtime, Next.js (App Router), Drizzle ORM, Zod for env validation, dotenv for env loading.
- **Database (local)**: PGLite via Drizzle's PGLite driver (in-memory or file-backed).
- **Database (prod)**: Postgres via Drizzle's postgres-js driver.
- **Job queue**: Postgres `LISTEN/NOTIFY` plus `SELECT ... FOR UPDATE SKIP LOCKED`, implemented in TS via Drizzle.
- **Python ML service**: Python 3.11+ managed by uv, FastAPI, Pydantic v2, scikit-learn or simple PyTorch for v1, neuroHarmonize or a hand-rolled ComBat for harmonisation, pydantic-settings for config.
- **Frontend**: Next.js Server Components for data fetching, Tailwind CSS, shadcn/ui components, Recharts for trajectory plots.
- **Inter-service**: HTTP+JSON. Web service is the API gateway and DB owner; ML service is stateless compute. Worker bridges them.

## 8. Architecture overview

```
+----------------+        +---------------+         +----------------+
|                |  HTTP  |               |  HTTP   |                |
|   Next.js Web  +-------->   ML Service  <---------+   Worker (TS)  |
|   (apps/web)   |        |   (apps/ml)   |         |   (apps/worker)|
|                |        |   FastAPI     |         |                |
+----+-----------+        +---------------+         +-------+--------+
     | Drizzle                                              |
     |                                                      | Drizzle
     v                                                      v
+--------------------------------------------------------------------+
|                            Postgres                                |
|   participants | visits | features | jobs | models | predictions  |
|             (PGLite local, Postgres prod, same schema)             |
+--------------------------------------------------------------------+
```

Responsibilities:

- **apps/web (Next.js)** owns: user-facing UI, REST API (`/api/*`), DB schema and access via Drizzle, job enqueueing.
- **apps/worker (Bun process)** owns: LISTEN-ing for job notifications, SKIP LOCKED dequeue, job dispatch to ML service via HTTP, result write-back via Drizzle.
- **apps/ml (FastAPI)** owns: harmonisation, training, inference. Reads data via the web API; never touches the DB directly.

Job lifecycle: web enqueues job row + `pg_notify('jobs', ...)` -> worker LISTENs, wakes, SKIP LOCKED-dequeues -> worker fetches inputs via web API -> worker calls ML service `/pipelines/<name>` -> worker writes results via web API -> worker marks job done.

## 9. Data model (overview)

Detailed schema lives in `apps/web/lib/db/schema.ts`. High-level entities:

- `cohorts(id, name, source, notes, created_at)`
- `participants(id, cohort_id, age_baseline, sex, education_years, urban_rural, apoe4_carrier, created_at)`
- `visits(id, participant_id, visit_index, age_at_visit, observed_at)`
- `cognitive_assessments(id, visit_id, memory, executive, language, attention, visuospatial)`
- `mri_features(id, visit_id, hippocampus_l, hippocampus_r, entorhinal_l, entorhinal_r, cortical_thickness_mean, ...)`
- `oct_features(id, visit_id, rnfl_thickness, gcc_thickness, vessel_density, ...)`
- `biochem_features(id, visit_id, hba1c, ldl, hdl, triglycerides, sbp, dbp, ...)`
- `mci_outcomes(id, participant_id, mci_observed_at, mci_status)`  (right-censored)
- `harmonised_features(id, visit_id, modality, payload_json, run_id)`
- `harmonisation_runs(id, cohort_ids_json, params_json, started_at, finished_at, status)`
- `models(id, name, version, params_json, metrics_json, artefact_url, created_at)`
- `predictions(id, participant_id, model_id, horizon_years, risk_point, risk_lo, risk_hi, made_at)`
- `jobs(id, kind, payload_json, status, attempts, run_after, locked_at, locked_by, error, created_at, started_at, finished_at)`

## 10. Open questions and future work

- Authentication: out of scope for v1, but the schema reserves a `users` table slot.
- Schema sharing between TS and Python: v1 uses HTTP contracts only. v2 may generate Pydantic models from Drizzle via a shared OpenAPI spec.
- Real-cohort ETL contracts: defined in v2 against the actual TLSA/SANSCOG inventory.
- Counterfactual head: deferred to v3.
- Imaging-trajectory forecasting (digital twin): deferred to v3.

## 11. Success criteria for v1

- Single command brings up the full stack locally (`bun run dev` plus `uv run ml`).
- A demo flow exists end-to-end: seed -> harmonise -> train -> predict -> view in UI.
- All jobs are dispatched through the LISTEN/NOTIFY + SKIP LOCKED queue, not in-process hacks.
- Subgroup audit dashboard renders for any trained model.
- README contains a recorded 3-minute walkthrough script ready for the jury demo.
