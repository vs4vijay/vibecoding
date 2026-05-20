import { clip, Rng } from "./rng";

export interface SynthParticipantInput {
  cohortId: string;
  cohortOffset?: CohortOffset; // injects per-cohort feature shifts to make harmonisation observable
}

export interface CohortOffset {
  mri_hippocampus: number;     // mm^3 shift on both hippocampi
  mri_thickness: number;       // mm
  biochem_hba1c: number;       // %
  biochem_sbp: number;         // mmHg
  biochem_bmi: number;
  cognitive_memory: number;
}

export const DEFAULT_OFFSET: CohortOffset = {
  mri_hippocampus: 0,
  mri_thickness: 0,
  biochem_hba1c: 0,
  biochem_sbp: 0,
  biochem_bmi: 0,
  cognitive_memory: 0,
};

export function generateParticipant(rng: Rng, input: SynthParticipantInput) {
  const sex = rng.bool(0.55) ? "F" : "M";
  // Indian-cohort flavoured baseline-age skew, peaked around 65-72.
  const ageBaseline = clip(rng.normal(67, 7.5), 50, 90);
  const eduYears = clip(Math.round(rng.normal(9, 4)), 0, 20);
  const urbanRural = rng.bool(0.62) ? "urban" : "rural";
  const apoe4 = rng.bool(0.18);
  return { sex, ageBaseline, educationYears: eduYears, urbanRural, apoe4Carrier: apoe4 };
}

export function generateVisits(
  rng: Rng,
  baseline: ReturnType<typeof generateParticipant>,
  nVisits: number,
  cohortOffset: CohortOffset,
) {
  const visits = [];
  // Per-participant random effects (preserved across visits) so longitudinal trends are realistic.
  const subjectMemoryEffect = rng.normal(0, 0.4);
  const subjectHippoEffect = rng.normal(0, 200);
  const subjectHba1cEffect = rng.normal(0, 0.4);
  const declineRateMemory = clip(rng.normal(0.07, 0.05), 0.01, 0.25); // per year
  const declineRateHippo = clip(rng.normal(40, 25), 5, 120); // mm^3/year volume loss

  for (let i = 0; i < nVisits; i++) {
    const yearsFromBaseline = i * 1.5; // visit every ~18 months
    const age = baseline.ageBaseline + yearsFromBaseline;

    // Age-driven cognitive decline; ApoE4 carriers decline faster.
    const apoeBoost = baseline.apoe4Carrier ? 1.5 : 1.0;
    const eduProtect = (baseline.educationYears - 8) * 0.05;
    const memory = clip(
      rng.normal(0, 0.4) +
        subjectMemoryEffect +
        cohortOffset.cognitive_memory +
        eduProtect -
        declineRateMemory * apoeBoost * yearsFromBaseline,
      -3,
      3,
    );
    const executive = clip(memory + rng.normal(0, 0.3) + eduProtect * 0.5, -3, 3);
    const language = clip(memory + rng.normal(0, 0.3), -3, 3);
    const attention = clip(memory + rng.normal(0, 0.3), -3, 3);
    const visuospatial = clip(memory + rng.normal(0, 0.3), -3, 3);
    const mmse = clip(28 + memory * 1.5 + rng.normal(0, 1.2) + eduProtect, 0, 30);

    // MRI features. Hippocampus volume declines with age and apoe4.
    const ageFactor = (age - 60) * 80; // mm^3 loss per year above 60
    const hippoL = clip(
      rng.normal(3500, 200) +
        subjectHippoEffect +
        cohortOffset.mri_hippocampus -
        ageFactor -
        (apoeBoost - 1) * 400 -
        declineRateHippo * yearsFromBaseline,
      1500,
      5000,
    );
    const hippoR = clip(
      rng.normal(3500, 200) +
        subjectHippoEffect +
        cohortOffset.mri_hippocampus -
        ageFactor -
        (apoeBoost - 1) * 400 -
        declineRateHippo * yearsFromBaseline,
      1500,
      5000,
    );
    const entorhinalL = clip(rng.normal(1800, 150) - ageFactor / 4, 800, 2500);
    const entorhinalR = clip(rng.normal(1800, 150) - ageFactor / 4, 800, 2500);
    const corticalThicknessMean = clip(
      rng.normal(2.45, 0.12) + cohortOffset.mri_thickness - (age - 60) * 0.008,
      1.8,
      3.0,
    );
    const ventricularVolume = clip(rng.normal(28000, 6000) + (age - 60) * 400, 10000, 80000);
    const wmh = clip(rng.normal(2.5, 1.5) + (age - 60) * 0.04, 0.0, 20.0);

    // OCT
    const rnfl = clip(rng.normal(95, 10) - (age - 60) * 0.2, 60, 130);
    const gcc = clip(rng.normal(80, 8) - (age - 60) * 0.15, 50, 110);
    const vesselDensity = clip(rng.normal(0.52, 0.05) - (age - 60) * 0.001, 0.3, 0.7);

    // Biochem
    const hba1c = clip(
      rng.normal(5.9, 0.9) + subjectHba1cEffect + cohortOffset.biochem_hba1c,
      4.0,
      12.0,
    );
    const ldl = clip(rng.normal(110, 25), 50, 220);
    const hdl = clip(rng.normal(48, 12), 20, 90);
    const triglycerides = clip(rng.normal(140, 50), 50, 400);
    const sbp = clip(rng.normal(130, 14) + cohortOffset.biochem_sbp, 90, 200);
    const dbp = clip(rng.normal(82, 9), 50, 120);
    const bmi = clip(rng.normal(24.5, 3.2) + cohortOffset.biochem_bmi, 16, 40);

    visits.push({
      visitIndex: i,
      ageAtVisit: age,
      yearsFromBaseline,
      cognitive: { memory, executive, language, attention, visuospatial, mmse },
      mri: {
        hippocampusL: hippoL,
        hippocampusR: hippoR,
        entorhinalL,
        entorhinalR,
        corticalThicknessMean,
        ventricularVolume,
        whiteMatterHyperintensities: wmh,
      },
      oct: { rnflThickness: rnfl, gccThickness: gcc, vesselDensity },
      biochem: { hba1c, ldl, hdl, triglycerides, sbp, dbp, bmi },
    });
  }
  return visits;
}

export function generateOutcome(
  rng: Rng,
  baseline: ReturnType<typeof generateParticipant>,
  visits: ReturnType<typeof generateVisits>,
) {
  // Logistic hazard driven by age, hippocampus volume at last visit, ApoE, education protective.
  if (visits.length === 0) return { timeYears: 5, mciStatus: false };
  const last = visits[visits.length - 1]!;
  const ageDrive = (last.ageAtVisit - 65) * 0.12;
  const hippoDrive = (3300 - (last.mri.hippocampusL + last.mri.hippocampusR) / 2) / 200;
  const apoeDrive = baseline.apoe4Carrier ? 0.7 : 0.0;
  const eduDrive = -(baseline.educationYears - 8) * 0.05;
  const hba1cDrive = (last.biochem.hba1c - 6) * 0.15;
  const logit = -2.0 + ageDrive + hippoDrive + apoeDrive + eduDrive + hba1cDrive;
  const p5 = 1 / (1 + Math.exp(-logit));
  // Censor 30% (no event observed within follow-up); else event in (0, 5] yrs.
  if (rng.bool(1 - p5)) {
    return { timeYears: 5, mciStatus: false };
  }
  const timeYears = clip(rng.uniform(0.5, 5.0), 0.5, 5.0);
  return { timeYears, mciStatus: true };
}
