# DRISHTI canonical cohort format

This is the contract for getting any cohort (synthetic, TLSA, SANSCOG, ADNI, ...) into DRISHTI.

The format is a single JSON document with three sections: `cohort`, `participants`, and `visits`. It is intentionally simple and human-readable so analysts can hand-craft tiny test cohorts and so the cohort partner ETL has a one-page target to write against.

## Schema (v1)

```jsonc
{
  "format_version": "1",
  "cohort": {
    "id": "SYNTH-A",                  // unique cohort identifier
    "name": "Synthetic A",            // display name
    "source": "SYNTH",                // 'SYNTH' | 'TLSA' | 'SANSCOG' | 'ADNI' | ...
    "notes": "Optional free-text"
  },
  "participants": [
    {
      "id": "SYNTH-A-42-p00000",       // unique within cohort
      "age_baseline": 67.5,
      "sex": "F",                       // 'M' | 'F'
      "education_years": 12,
      "urban_rural": "urban",           // 'urban' | 'rural'
      "apoe4_carrier": false,
      "outcome": {                       // optional
        "time_years": 4.2,               // right-censored follow-up time
        "mci_status": true               // whether MCI was observed
      }
    }
  ],
  "visits": [
    {
      "id": "SYNTH-A-42-p00000-v0",     // unique within cohort
      "participant_id": "SYNTH-A-42-p00000",
      "visit_index": 0,                   // 0-based, monotonically increasing per participant
      "age_at_visit": 67.5,
      "observed_at": "2024-01-01T00:00:00Z",
      "cognitive": {
        "memory": 0.1,
        "executive": -0.05,
        "language": 0.2,
        "attention": 0.05,
        "visuospatial": -0.1,
        "mmse": 28.5
      },
      "mri": {
        "hippocampus_l": 3450,
        "hippocampus_r": 3470,
        "entorhinal_l": 1820,
        "entorhinal_r": 1810,
        "cortical_thickness_mean": 2.42,
        "ventricular_volume": 28000,
        "white_matter_hyperintensities": 2.8
      },
      "oct": {
        "rnfl_thickness": 92,
        "gcc_thickness": 79,
        "vessel_density": 0.51
      },
      "biochem": {
        "hba1c": 5.8,
        "ldl": 110,
        "hdl": 50,
        "triglycerides": 130,
        "sbp": 128,
        "dbp": 82,
        "bmi": 24.5
      }
    }
  ]
}
```

## Required vs optional

- `cohort.id`, `cohort.name`, `cohort.source` are **required**.
- `participant.id`, `age_baseline`, `sex`, `education_years`, `urban_rural`, `apoe4_carrier` are **required**.
- `participant.outcome` is **optional**. Without it, the participant exists but cannot be a training target.
- `visit.id`, `participant_id`, `visit_index`, `age_at_visit`, `observed_at` are **required**.
- Each modality block (`cognitive`, `mri`, `oct`, `biochem`) is **optional**. Missing modalities are tolerated downstream (the survival model treats absent features as zero after standardisation, which the audit page will surface as degraded subgroup performance).

## Import behaviour

- Imports are **idempotent**: re-importing the same cohort with the same IDs is a no-op (`ON CONFLICT DO NOTHING`).
- If a cohort row with the same `id` already exists, its metadata is preserved.
- IDs are scoped to the cohort by convention (`{COHORT}-{seed}-pNNNNN`); the schema requires global uniqueness, so callers must namespace.

## Real-cohort onboarding

For TLSA and SANSCOG, the ETL author writes one transformer per modality that maps the cohort's native column names to the canonical block above. There is no v1 expectation that all modalities are present; harmonisation operates only on the modalities that exist in both cohorts.
