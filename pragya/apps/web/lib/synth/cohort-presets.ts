import type { CohortOffset } from "./generators";

// Per-cohort feature shifts to simulate scanner / lab / cohort effects.
// Used by Phase 5 to demonstrate harmonisation removing the shift.
export const COHORT_OFFSETS: Record<string, CohortOffset> = {
  "SYNTH-A": {
    mri_hippocampus: 0,
    mri_thickness: 0,
    biochem_hba1c: 0,
    biochem_sbp: 0,
    biochem_bmi: 0,
    cognitive_memory: 0,
  },
  "SYNTH-B": {
    // A second scanner/site with consistently bigger hippocampus and lower thickness.
    mri_hippocampus: 250,
    mri_thickness: -0.1,
    biochem_hba1c: 0.6,
    biochem_sbp: 6,
    biochem_bmi: 1.2,
    cognitive_memory: 0.2,
  },
  "SYNTH-C": {
    mri_hippocampus: -180,
    mri_thickness: 0.05,
    biochem_hba1c: -0.3,
    biochem_sbp: -4,
    biochem_bmi: -0.8,
    cognitive_memory: -0.1,
  },
};
