# Solution: DRISHTI — A Brain-Aging Digital Twin for India

**DRISHTI** — *Dementia Risk & Imaging-Subgroup Health Trajectory Index.*

## One-line pitch

A multimodal forecasting model, calibrated on Indian longitudinal cohorts and harmonised against global cohorts, that gives each individual a personalised 5–10 year cognitive and imaging trajectory — and lets a clinician explore counterfactual outcomes under modifiable cardio-metabolic interventions.

## How a clinician uses it

1. Loads a participant profile (TLSA/SANSCOG record, or a clinic intake).
2. Sees a forecast panel: predicted cognitive scores by domain (memory, executive, language, attention, visuospatial), predicted MRI-derived volumes/thickness, and a time-to-MCI risk curve — each with calibrated 80% / 95% bands.
3. Toggles "what-if" sliders: *hold SBP < 130, HbA1c < 6.5, LDL < 100, BMI < 25, hearing-aid use Y, physical-activity tier* — and watches the trajectory and risk curve update with a sensitivity range.
4. Exports a one-page report.

## Inputs

From TLSA / SANSCOG (per CBR data inventory):
- **Cognitive assessments**: structured, multi-domain, multiple time points
- **MRI**: extracted/tabulated volumetric + cortical-thickness measures (we do *not* touch raw DICOMs)
- **OCT / OCT-Angio**: retinal-layer and microvascular measures
- **Blood biochemistry**: lipids, glucose, HbA1c, inflammatory markers, hematology, renal/hepatic panels
- **Omics**: as available — genotype (ApoE, polygenic risk), methylation, proteomics
- **Demographics + lifestyle + medical history**: age, sex, education, urban/rural, BP, BMI, smoking, alcohol, physical activity, sleep, hearing, depression, comorbidities

From public cohorts for pretraining:
- ADNI, UK Biobank, OASIS, NACC, AIBL — overlapping modalities

## Outputs

| Output | Form |
|---|---|
| Cognitive trajectory per domain | Mean curve + 80/95% conformal bands over 0–10y |
| Structural-MRI biomarker trajectory | Same form, key ROIs (hippocampus, entorhinal, cortical thickness) |
| Time-to-MCI risk | Survival curve with bands; AUROC + AUPRC at 5y/10y horizons |
| Counterfactual trajectories | Pair of trajectories (factual vs. under intervention) with sensitivity range across estimators |
| Subgroup performance | Calibration & discrimination by sex / education / urban-rural / age band |

## Model architecture

We deliberately stay on the *small-and-explainable* end of the design space — both because Indian-cohort sample sizes do not justify giant models, and because the secure remote env limits compute.

```
                    ┌────────────────────────────────────────────────┐
                    │            Multimodal encoder stack             │
                    │                                                 │
  cognitive  ──▶ MLP─┐                                                │
  biochem    ──▶ MLP─┤                                                │
  MRI feat.  ──▶ MLP─┼──▶ cross-modal transformer fusion ──▶ z_t      │
  OCT feat.  ──▶ MLP─┤                                                │
  omics      ──▶ MLP─┘                                                │
                    └────────────────────────────────────────────────┘
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
              trajectory decoder   survival head      counterfactual head
              (Neural ODE or         (DeepSurv-           (T-learner
               autoregressive        style, time-to-MCI)   over modifiable
               transformer over                            covariates)
               horizons 1y..10y)
```

Key choices:
- **Per-modality encoders** so we degrade gracefully when a modality is missing for a participant.
- **Cross-modal transformer fusion** with learned modality tokens.
- **Trajectory decoder** as Neural ODE (continuous-time, irregular observation friendly) with autoregressive transformer as fallback baseline.
- **Survival head** (DeepSurv-style Cox-nn or discrete-time hazard) for time-to-MCI.
- **Counterfactual head** uses T-learner / X-learner over the modifiable-factor set, with doubly-robust estimation and propensity overlap diagnostics. Framed as predictive what-if, not identified causal effects.

## Cross-cohort harmonisation

This is the secret sauce, not a footnote.

1. **Feature-level harmonisation**: ComBat / neuroCombat for MRI features to remove scanner/site effects; analogous batch correction for biochem panels.
2. **Domain-adversarial training**: a gradient-reversal head tries to predict cohort-of-origin from the fused representation `z_t`; we train against it so `z_t` becomes cohort-invariant.
3. **Two-stage training**: pretrain encoders + trajectory decoder on the much larger ADNI + UKBB pool → fine-tune on TLSA/SANSCOG with a small learning rate and a regulariser that anchors the Indian-cohort head to the global-cohort head only where the data agrees.
4. **Ablation** quantifies how much of the final performance comes from harmonisation, vs. pretraining, vs. fine-tuning — this is itself a publishable contribution.

## Uncertainty calibration

- **Deep ensembles** (5 seeds) for epistemic uncertainty.
- **Conformal prediction** wrapping the regression heads to give the bands their advertised coverage on held-out data.
- **Calibration plots** in every report; we treat miscalibration as a bug.

## Evaluation plan

| Axis | Metric | Bar |
|---|---|---|
| Cognitive trajectory | MAE, R² per domain, CRPS, coverage of 80/95% bands | Coverage within ±3pp of nominal |
| MRI trajectory | Same | Same |
| MCI conversion (5y, 10y) | AUROC, AUPRC, Brier, net benefit (DCA) | Beat ADNI-only baseline by ≥5pp AUPRC on Indian test split |
| Counterfactual validity | Held-out matched-subgroup comparison; placebo-treatment test | Treatment effect on placebo covariate ≈ 0 |
| Subgroup fairness | Calibration + AUC by sex, education, urban-rural, age band | No subgroup > 10% degraded vs overall |
| Robustness | Missing-modality stress test | Graceful degradation, no catastrophic drop |

## Deliverables (by Jan 31, 2027)

1. Trained model checkpoints (inside CBR secure env per data rules).
2. Open-source codebase: encoders, training, harmonisation, conformal wrappers, evaluation — released to the extent data-use rules permit.
3. Validation report PDF.
4. Interactive demo (Streamlit or Gradio) running inside the secure env, with a screen-recorded walkthrough for the jury.
5. Manuscript draft for a target journal (e.g. *Lancet Digital Health*, *Alzheimer's & Dementia: DADM*, or *npj Digital Medicine*).

## Risks and how we handle them

| Risk | Mitigation |
|---|---|
| Sample sizes in TLSA/SANSCOG too small for from-scratch training | Pretrain on ADNI+UKBB; the whole architecture is built around this |
| Cohort shift even after harmonisation | Adversarial + ComBat + explicit ablation; report residual shift as a limitation, not hide it |
| Counterfactual claims overreaching | Frame as predictive what-if; report sensitivity across estimators; include negative-control covariate |
| Secure-env compute limits | Lean architecture; mixed-precision; gradient checkpointing; small-model defaults with clear scale-up path |
| Reproducibility inside walled garden | Pin everything; export training manifests; deterministic seeds; the jury must be able to re-run |
| Missing modalities in real records | Per-modality encoders with learned missing tokens; documented graceful-degradation behaviour |

## Why this wins on the stated criteria

The challenge evaluates on **innovation, usability, impact, and relevance**.

- *Innovation* — the harmonisation-pretrain-finetune-counterfactual stack, evaluated end-to-end, is not a thing that currently exists for Indian brain-aging data.
- *Usability* — a clinician-facing demo, not a Jupyter notebook. Counterfactual sliders make it tangible.
- *Impact* — Indian-calibrated risk for the cohort that needs it most, focused on the modifiable factors where intervention is most cost-effective.
- *Relevance* — hits four of the challenge's named examples (MCI prediction, progression, digital twin, harmonisation) in a single coherent system.

## Team roles (to fill in)

Up to 5 members per challenge rules. Suggested split:

1. **Lead / ML architect** — overall model, fusion, decoder
2. **Clinical / data lead** — domain knowledge, feature selection, clinical demo design, liaison with CBR
3. **Harmonisation + causal lead** — ComBat, adversarial training, counterfactual estimators
4. **MLOps + secure-env lead** — secure-env workflows, reproducibility, compute, packaging
5. **Frontend / demo lead** — Streamlit/Gradio app, report generation, jury demo

## Next steps before May 20, 2026

- [ ] Lock the 5-person team and confirm Indian-institution affiliations
- [ ] Download the official proposal template (.docx) from the challenge portal
- [ ] Stand up a literature notes folder — Lancet 2024 commission, ADNI methods, neuroCombat, conformal-survival
- [ ] Sketch a 1-page architecture diagram for the proposal
- [ ] Draft proposal v1 → internal review → submit
