# DRISHTI - Build Plan

> Vertical-slice phasing. Each phase delivers an end-to-end working slice through the full stack (UI -> API -> Worker -> ML -> DB) that is demonstrable in isolation. No phase is "infra only" or "UI only".

Companion to PRD.md (what to build) and PROPOSAL.md (the formal submission).

## Phasing philosophy

- Every phase ends with a working `bun run dev` + `uv run ml` and a user-visible feature you can show.
- DB schema and ML logic grow phase by phase; no big-bang schema.
- Synthetic data is the data source for every phase. Real cohorts come post-shortlist.
- Each phase has an explicit Done-When list; we do not move on until it passes.

## Repo layout (final, established in Phase 1)

```
pragya/
  .env.example           # documented env vars
  .gitignore
  package.json           # bun workspace root
  pyproject.toml         # uv root (optional; per-app pyproject is fine too)
  bunfig.toml
  PRD.md
  PLAN.md
  PROPOSAL.md
  PROBLEM.md
  SOLUTION.md
  README.md
  apps/
    web/                 # Next.js (TS, bun)
      app/               # routes
      lib/
        config.ts        # validated config object
        db/
          schema.ts      # Drizzle schema
          client.ts      # PGLite or postgres-js based on env
          migrate.ts
        queue/
          enqueue.ts
          types.ts
        api-client/
          ml.ts          # client to Python ML service
      drizzle.config.ts
      package.json
      next.config.mjs
      tsconfig.json
    worker/              # Bun process (TS)
      src/
        main.ts          # LISTEN + SKIP LOCKED loop
        handlers/        # job-kind to handler
        ml-client.ts     # shared client to ML service
      package.json
      tsconfig.json
    ml/                  # Python FastAPI (uv)
      pyproject.toml
      uv.lock
      drishti_ml/
        __init__.py
        config.py
        main.py          # FastAPI entrypoint
        pipelines/
          harmonise.py
          train.py
          predict.py
        api_client.py    # client back to web for data fetch / result write
        models/
          survival.py
        synth/
          (only TS owns synth in v1; ml/synth is reserved for future)
      tests/
  packages/
    shared/              # shared TS types
      src/
        contracts.ts     # ML <-> Web API DTOs (zod)
      package.json
```

---

## Phase 1 - Walking skeleton

**Goal**: A user can open `localhost:3000`, see a page that displays "ML service: ok" pulled live from the Python service through the Next.js API. The whole vertical stack boots from a single `bun dev` + `uv run`.

**Deliverables**:
- Monorepo: `package.json` with bun workspaces, root `bunfig.toml`, `.gitignore`, `.env.example`, `README.md`.
- `apps/web` Next.js app boots; root page renders.
- `apps/web/lib/config.ts` validates env via Zod; fails fast on missing/invalid values.
- `apps/web/lib/db/client.ts` initialises PGLite via Drizzle; basic `users` table just to prove the wiring.
- `apps/web` has an API route `/api/health` that returns `{web: 'ok', ml: <status>}` by calling the Python service.
- `apps/ml` FastAPI app boots, has `/healthz` returning `{status: 'ok', version: ...}`.
- `apps/ml/drishti_ml/config.py` validates env via pydantic-settings.
- `apps/worker` boots as a long-lived process and logs "worker up".

**Done-when**:
- `bun install` works.
- `uv sync` in `apps/ml` works.
- `bun run dev` boots web (port 3000) and worker concurrently.
- `uv run uvicorn drishti_ml.main:app --port 8000` boots ML service.
- Visiting `http://localhost:3000` shows a status panel with `web: ok` and `ml: ok`.
- Removing or invalidating a required env var causes web or ml startup to fail fast with a clear error.

## Phase 2 - Synthetic patient browser

**Goal**: Generate fake participants and visits, see them in the web UI.

**Deliverables**:
- Drizzle schema: `cohorts`, `participants`, `visits`, `cognitive_assessments`, `mri_features`, `oct_features`, `biochem_features`, `mci_outcomes`.
- Migration script.
- `apps/web/scripts/seed-synth.ts`: a Bun CLI that takes `--participants`, `--visits-per`, `--cohort`, `--seed`, and writes deterministic fake data via Drizzle.
- Faker-based generators with plausible correlation (e.g. hippocampal volume drops with age and ApoE4 presence).
- API routes: `GET /api/participants` (list, filterable), `GET /api/participants/:id` (detail with visits).
- UI pages: `/participants` (filterable list), `/participants/[id]` (detail with longitudinal visit table).

**Done-when**:
- `bun run seed:synth -- --participants 500 --visits-per 4 --cohort SYNTH-A --seed 42` produces 500 participants and 2000 visits.
- `/participants` lists them with sex, age-band, urban/rural filters.
- `/participants/[id]` shows the full longitudinal record.
- Re-running the seed with the same seed produces identical rows.

## Phase 3 - Job queue with LISTEN/NOTIFY + SKIP LOCKED

**Goal**: Worker dispatches a "no-op" job triggered from the UI; full round-trip observable.

**Deliverables**:
- Drizzle schema: `jobs` table with `kind`, `payload`, `status`, `attempts`, `run_after`, `locked_at`, `locked_by`, `error`, timestamps.
- `apps/web/lib/queue/enqueue.ts`: function that inserts a job row and emits `pg_notify('jobs:new', job.id)`.
- `apps/worker/src/main.ts`: connects, `LISTEN jobs:new`, on notify polls with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` to pick up a job, runs handler, marks done or failed.
- Handler registry; built-in `noop` handler (sleeps 1s, marks done).
- Retry policy: bounded `attempts`, exponential backoff via `run_after`.
- UI: `/jobs` page lists recent jobs with status; a button on the page enqueues a `noop` job.

**Done-when**:
- Clicking "Enqueue noop" in the UI creates a job row and the worker picks it up within seconds.
- The job moves through `queued -> running -> succeeded` on the UI list.
- Killing the worker mid-job and restarting it: the job is re-picked-up after `locked_at` expires (or after a heartbeat timeout).
- Two workers running concurrently never run the same job twice (SKIP LOCKED test).

## Phase 4 - Prediction round-trip (stubbed ML)

**Goal**: From the UI, click "Predict risk" on a participant; the system enqueues a job, the worker calls the ML service `/pipelines/predict` (which returns a stub random risk), and the UI displays the result.

**Deliverables**:
- `packages/shared/src/contracts.ts`: zod schemas for `PredictRequest`, `PredictResponse` (per-horizon point + intervals).
- `apps/ml/drishti_ml/pipelines/predict.py`: stub returns deterministic-from-seed risk curves for 1/3/5 years.
- `apps/web/lib/api-client/ml.ts`: typed client around the ML service.
- `apps/worker/src/handlers/predict.ts`: fetches participant features via web API, calls ML, writes `predictions` row.
- Drizzle schema: `predictions`, `models` (models seeded with a `stub-v0` row).
- UI: participant detail page gains a "Run prediction" button; new prediction streams in.

**Done-when**:
- Stub prediction round-trips end-to-end through web -> queue -> worker -> ML -> DB -> UI.
- The same input produces the same stub output (deterministic).
- Multiple predictions for the same participant accumulate in the DB, each tied to a model version.

## Phase 5 - Harmonisation pipeline (real)

**Goal**: From the UI, run "Harmonise cohort"; ComBat-style correction runs against MRI and biochem features across multiple synthetic cohorts; harmonised features are stored and visible.

**Deliverables**:
- Seed two synthetic cohorts (`SYNTH-A`, `SYNTH-B`) with deliberately offset feature means and variances.
- `apps/ml/drishti_ml/pipelines/harmonise.py`: real ComBat (via `neuroHarmonize` or hand-rolled implementation for v1) applied to MRI and biochem features.
- Drizzle schema: `harmonisation_runs`, `harmonised_features`.
- `apps/worker/src/handlers/harmonise.ts`: fetches features per cohort, calls ML, persists harmonised features.
- UI: `/harmonisation` page listing runs, with before/after distribution plots per feature.

**Done-when**:
- Running harmonisation across `SYNTH-A` and `SYNTH-B` produces harmonised features whose cross-cohort mean shift is at least 80% reduced for the targeted features.
- Each run is auditable (which cohorts, which feature set, parameters).
- Re-running with the same seed produces identical results.

## Phase 6 - Training pipeline (real-ish)

**Goal**: From the UI, train a survival model on harmonised synthetic data; metrics and a model row are persisted.

**Deliverables**:
- `apps/ml/drishti_ml/models/survival.py`: a simple discrete-time hazard model (logistic regression per horizon) or sklearn-based Cox model.
- `apps/ml/drishti_ml/pipelines/train.py`: pulls harmonised feature matrix + outcomes, fits, computes AUROC/AUPRC/Brier per horizon, writes model artefact.
- Model artefact stored as a row in `models` with `params_json`, `metrics_json`, and a path to a pickled model (local FS in dev).
- `apps/worker/src/handlers/train.ts`: kicks off training, polls ML for completion, writes results.
- UI: `/models` page lists trained models with metrics; one is marked "active".

**Done-when**:
- Training run completes against synthetic harmonised data in under 2 minutes.
- AUROC > 0.6 on a held-out synthetic split (synthetic is constructed so this is achievable; the point is the pipeline, not state-of-the-art).
- An active model is selectable from `/models`.

## Phase 7 - Real predictions, calibration, fairness

**Goal**: Predictions now use the active trained model (no more stub). The UI shows calibration and subgroup fairness audit.

**Deliverables**:
- `apps/ml/drishti_ml/pipelines/predict.py` uses the active model artefact instead of returning stubs.
- Deep ensembles: train N models with different seeds and aggregate for uncertainty (small N=3 for v1).
- Conformal prediction wrapper around the per-horizon outputs.
- `apps/ml/drishti_ml/pipelines/audit.py`: computes calibration plots and subgroup metrics (sex, education tier, urban/rural, age band).
- UI: `/models/[id]/audit` page with calibration plot and per-subgroup metric tables.
- Participant detail page shows real risk curves with intervals.

**Done-when**:
- Predictions for any participant return calibrated point estimates and intervals.
- Audit page renders calibration plot and per-subgroup AUROC/AUPRC/calibration error.
- No subgroup degraded by more than 10% from the overall metric on synthetic data.

## Phase 8 - Cohort import (synthetic-from-file)

**Goal**: Demonstrate the import contract that will later accept TLSA/SANSCOG (or any tabulated cohort) by importing a synthetic export.

**Deliverables**:
- `apps/web/scripts/export-synth.ts`: exports an existing synthetic cohort to CSV/JSON in the canonical import format.
- `apps/web/scripts/import-cohort.ts`: imports the canonical format.
- API endpoint + UI for triggering an import.
- Documentation of the canonical import format in `docs/cohort-format.md`.

**Done-when**:
- Round-trip works: seed -> export -> drop DB -> import -> participants and visits match.
- Format is documented end-to-end and is the contract that TLSA/SANSCOG ETL will target.

## Phase 9 - Demo polish

**Goal**: The system is jury-demo-ready.

**Deliverables**:
- README with one-command setup and a 3-minute demo script.
- Recorded walkthrough script (steps to perform, expected screens).
- Seeded demo state: a script that takes the system from empty to "trained model + sample predictions" in under 5 minutes.
- Light visual polish on UI (shadcn components, sensible empty states, loading skeletons).
- Smoke test script that runs the whole flow headless and asserts on key outputs.

**Done-when**:
- A fresh clone can be brought from zero to a working demo by following README in under 10 minutes.
- The smoke test passes on a clean checkout.

---

## Execution order

We execute phases strictly in order. No phase starts until the previous phase's Done-when is satisfied. Notes and decisions made during a phase are recorded in this file or in `docs/notes.md` so future-us has the trail.

## Risk register (for the build, not the science)

- PGLite + Drizzle adapter quirks: mitigated by isolating DB client behind `apps/web/lib/db/client.ts`; production swap is one env-driven branch.
- LISTEN/NOTIFY in PGLite: PGLite's notify support is limited; if it does not work cleanly in PGLite, the worker falls back to a tight polling loop in dev and uses LISTEN/NOTIFY in prod. Detection happens in `apps/worker/src/main.ts`.
- HTTP between TS worker and Python ML service: bound only to localhost in dev; auth via shared secret in `.env`.
- Reproducibility: every job carries a `seed` in its payload; ML pipelines accept and use it.
