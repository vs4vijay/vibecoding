# DRISHTI

Our entry to the **AI Challenge for Healthy Brain Aging — 2026** organised by Centre for Brain Research (CBR), IISc, in partnership with ADDI and Microsoft Research India.

> **DRISHTI** — *Dementia Risk & Imaging-Subgroup Health Trajectory Index.* From Sanskrit *दृष्टि* — "vision / foresight" — which is what the system gives a clinician for the trajectory ahead.

## What we are building

A multimodal **digital twin for brain aging in Indian adults** that, given a person's baseline + interim profile (cognitive scores, MRI-derived features, blood biochemistry, omics), forecasts their 5–10 year trajectory across cognitive domains and imaging biomarkers, with:

- Calibrated uncertainty intervals on each trajectory
- Time-to-MCI risk with confidence bands
- Counterfactual "what if" simulation for modifiable cardio-metabolic risk factors (BP, HbA1c, lipids, BMI, lifestyle)
- Cross-cohort generalization via harmonization with global cohorts (ADNI, UK Biobank, OASIS)

Details:
- [PRD.md](./PRD.md) — product requirements (what to build)
- [PLAN.md](./PLAN.md) — phased build plan (how to build)
- [PROPOSAL.md](./PROPOSAL.md) — formal proposal, markdown rendering of the official template
- [PROBLEM.md](./PROBLEM.md) — long-form problem statement (working notes)
- [SOLUTION.md](./SOLUTION.md) — long-form solution design (working notes)
- [proposal-template.docx](./proposal-template.docx) — official template the proposal mirrors

## Stack

- **apps/web** — Next.js (App Router) + Drizzle + PGLite (dev) / Postgres (prod). Owns the DB and HTTP API.
- **apps/worker** — Bun process. LISTEN/NOTIFY + SKIP LOCKED job dispatcher.
- **apps/ml** — FastAPI service (uv). Stateless ML compute.
- **packages/shared** — Shared TS types and Zod contracts.

## Prerequisites

- [Bun](https://bun.sh) >= 1.1
- [uv](https://docs.astral.sh/uv/) for Python 3.11+

## Quick start (zero → demo in under 10 minutes)

```bash
# 0. Prereqs: bun >= 1.1, uv (for python)

# 1. Install JS deps
bun install

# 2. Install ML deps
cd apps/ml && uv sync && cd ../..

# 3. Copy env
cp .env.example .env

# 4. Seed two synthetic cohorts BEFORE starting web (PGlite is single-process)
bun run --cwd apps/web seed:synth -- --participants 500 --visits-per 4 --cohort SYNTH-A --seed 42
bun run --cwd apps/web seed:synth -- --participants 300 --visits-per 4 --cohort SYNTH-B --seed 7

# 5. In three separate terminals
bun run dev:ml         # FastAPI on :8000
bun run dev:web        # Next.js on :3000
bun run dev:worker     # Worker process

# 6. Open http://localhost:3000 — expect web: ok, ml: ok

# 7. (Optional) one-shot: harmonise → train → audit → 5 sample predictions
bun run --cwd apps/web scripts/demo-seed.ts

# 8. (Optional) smoke test (full stack running)
bun run --cwd apps/web scripts/smoke.ts
```

## Demo walkthrough (3 minutes for the jury)

1. **Home** (`/`) — green status panel.
2. **Participants** (`/participants`) — 800 synthetic participants. Filter by sex / age / education / urban-rural.
3. **Pick one participant** — see longitudinal visits with cognitive / MRI / OCT / biochem features.
4. **Click "Run prediction"** — risk curve with 80/95 % CI bands.
5. **Harmonisation** (`/harmonisation`) — pick SYNTH-A + SYNTH-B, run. Per-cohort means before vs after ComBat.
6. **Models** (`/models`) — click "Train model" with the harmonisation run. AUROC/AUPRC/ECE per horizon.
7. **Audit** (link from any model row) — calibration plot per horizon + subgroup fairness table (cells flagged red if >10 % drop).
8. **Jobs** (`/jobs`) — every queue job that ran, demonstrating the LISTEN/NOTIFY + SKIP LOCKED dispatcher.

## Useful scripts

```bash
bun run typecheck           # All TS workspaces
bun run db:generate         # Drizzle: generate migration from schema
bun run db:migrate          # Drizzle: apply migrations
bun run seed:synth -- --participants 500 --visits-per 4 --cohort SYNTH-A --seed 42
```

## Key challenge dates

| Date | Milestone |
|---|---|
| 2026-04-20 | Challenge opens |
| **2026-05-20** | **Proposal submission deadline** |
| 2026-05-20 → 05-31 | Internal screening |
| 2026-06-01 → 06-30 | Jury review |
| 2026-07-01 | Finalist notification |
| 2026-07 wk 1–2 | Virtual pitch to jury |
| 2026-07 wk 3 | Shortlist announced |
| 2026-08-01 → 2027-01-31 | Execution phase (build the solution) |
| 2027-02 | Demo + winner selection |

Prizes & grants up to ₹2 crore.

## Eligibility

- Open only to **residents of India working in Indian institutions**.
- Teams of up to **5 members**, each with a clearly defined role.
- Each individual may join only one team.

## Constraints worth flagging early

- CBR data (TLSA + SANSCOG) is accessed **only via a secure remote server** — no downloads, no copies. All code, models, artifacts stay inside.
- Public datasets (ADNI, UK Biobank, OASIS, ADDI, NACC, AIBL) can be used freely on our own infra.
- Our solution architecture has to assume **two execution surfaces**: an open-dev surface (public data, our hardware) and a sealed surface (CBR remote env). Anything we ship has to be portable across both.

## Contact

ai.challenge@cbr-iisc.ac.in

## Phase status

Tracked in [PLAN.md](./PLAN.md). Current phase: see `git log`.
