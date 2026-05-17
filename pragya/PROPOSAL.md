# AI Challenge for Healthy Brain Aging — Proposal

> Markdown rendering of the official proposal template. Sections 1–5 are bounded by the template's **3-page maximum**; CVs are a separate appendix at 2 pages each.

---

## Proposal Information

**Team Name:** *TBD*
**Title of the Proposal:** DRISHTI — Dementia Risk & Imaging-Subgroup Health Trajectory Index: A Multimodal Brain-Aging Digital Twin Calibrated for Indian Adults

### Team Members

| Role | First Name | Last Name | Email ID | Institution Name |
|---|---|---|---|---|
| **Lead Participant** | *TBD* | *TBD* | *TBD* | *TBD* |
| Team Member | *TBD* | *TBD* | *TBD* | *TBD* |
| Team Member | *TBD* | *TBD* | *TBD* | *TBD* |
| Team Member | *TBD* | *TBD* | *TBD* | *TBD* |
| Team Member | *TBD* | *TBD* | *TBD* | *TBD* |

*Note: Only up to 5 members are allowed per team.*

### Declaration

I and my team members hereby declare that we are residing in India, affiliated with an Indian organisation.

I confirm that throughout the entire Challenge, I and my team members listed above shall maintain complete confidentiality of all data, documents, materials, communications, and any other information shared with us in connection with the Challenge. We agree not to disclose, share, copy, or use this information for any purpose other than what is specifically allowed under the Challenge's terms and conditions.

I understand that this obligation of confidentiality shall apply throughout the duration of the Challenge and, where applicable, continue thereafter in accordance with the governing policies and agreements. I also understand that any breach of this obligation may result in strict disciplinary or legal actions.

I confirm that the information provided above is true and correct to the best of my knowledge and belief.

**Date:** *TBD*
**Signature of the Lead Participant** (on behalf of the entire team): *TBD*

---

## Challenge Area

> *Develop AI models and tools to advance and accelerate Alzheimer's and dementia research. Examples include prediction of development of mild cognitive impairment or dementia, models for disease progression, digital twins, data processing and harmonization tools, etc.*

---

# Detailed Proposal *(max 3 pages)*

## 1. Abstract

India will host over 340 million adults aged 60+ by 2050, layered on a heavy cardio-metabolic disease burden — yet Indians remain systematically underrepresented in global brain-aging cohorts (ADNI, UK Biobank, OASIS, NACC, AIBL). Dementia risk models trained on those cohorts transfer poorly to Indian populations whose genetic background, education distribution, multilingual cognition, and vascular risk profile differ materially.

We propose **DRISHTI** — the *Dementia Risk & Imaging-Subgroup Health Trajectory Index* — a multimodal brain-aging digital twin calibrated specifically on Indian longitudinal cohorts. Given a participant's baseline and interim profile (cognitive assessments, MRI-derived measures, OCT/Angio, blood biochemistry, omics), DRISHTI forecasts a personalised 5–10 year trajectory across cognitive domains and imaging biomarkers, computes a time-to-MCI risk curve with calibrated uncertainty, and supports **counterfactual "what-if" simulation** over modifiable cardio-metabolic factors (blood pressure, HbA1c, lipids, BMI, hearing, activity, sleep). A cross-cohort harmonisation stack (neuroCombat plus domain-adversarial training) lets us pretrain on global cohorts and fine-tune on TLSA/SANSCOG, closing the cohort-shift gap that has limited prior tools.

In one coherent system the proposal addresses four of the Challenge's explicitly named examples — MCI prediction, disease progression, digital twins, and data harmonisation — and turns a black-box risk score into a clinically actionable decision aid for the population that needs it most.

## 2. Project Overview

**Motivation.** The Lancet Commission on Dementia Prevention (2024) attributes up to 45% of dementia cases to modifiable risk factors. India's modifiable burden — hypertension, diabetes, dyslipidemia, central obesity, hearing loss, low education access — is exactly where intervention is most cost-effective. The bottleneck is not knowing *which* interventions, in *which* combinations, would meaningfully alter *which* individual's trajectory. That is precisely what a well-calibrated digital twin can answer.

**Objectives.**
1. Train a multimodal trajectory and survival model on TLSA and SANSCOG, harmonised against ADNI, UK Biobank, OASIS, NACC, and AIBL.
2. Quantify cohort-shift closure attributable to harmonisation, pretraining, and fine-tuning via ablation.
3. Produce calibrated forecasts — coverage of 80 and 95% prediction intervals within ±3 percentage points of nominal — and a counterfactual head that passes negative-control and placebo-treatment tests.
4. Audit subgroup performance across sex, education, urban/rural, and age bands; no subgroup degraded more than 10% from overall.
5. Ship an interactive clinician-facing demo running entirely inside the CBR secure environment and an open-source codebase to the extent data-use rules permit.

**Alignment with the Challenge.** The Challenge's call-out that *"Indians are underrepresented in such studies"* is the core thesis of this proposal — not a footnote. The four named in-scope examples are addressed in one system rather than four siloed prototypes, which we believe is the highest-impact use of the August 2026 – January 2027 execution window.

## 3. AI Model Development Approach

**Model architecture.** Per-modality encoders (MLPs for tabular cognitive, biochem, omics, OCT and MRI-derived features) feed a cross-modal transformer fusion layer producing a per-time-point latent representation `z_t`. Three downstream heads consume it:

- **Trajectory decoder** — Neural ODE (continuous-time, irregular-observation friendly) for cognitive-domain and imaging-biomarker trajectories over 1–10 year horizons; autoregressive transformer as a baseline.
- **Survival head** — discrete-time hazard model (or DeepSurv-style Cox-nn) for time-to-MCI, with concordance, AUROC/AUPRC at 5 and 10 year horizons, and decision-curve analysis.
- **Counterfactual head** — T-learner and X-learner over the modifiable-factor set with doubly-robust estimation and propensity overlap diagnostics, framed as predictive what-if (not identified causal effects) and reported with sensitivity across estimators.

**Use of provided datasets (TLSA and SANSCOG).** These are the primary training and validation cohorts. We use extracted/tabulated MRI volumetric and cortical-thickness measures, OCT/Angio retinal-layer and microvascular parameters, structured multi-domain cognitive assessments, full blood biochemistry, and available omics (ApoE genotype, methylation, proteomics). We do **not** require raw DICOM access. Splits are participant-stratified to avoid leakage across visits; an external held-out site/wave subset is reserved for cohort-shift evaluation.

**External datasets and justification.** ADNI, UK Biobank, OASIS, NACC, and AIBL are used solely for **pretraining encoders and the trajectory decoder** to overcome the sample-size limits of Indian cohorts. They are not used for headline metric reporting; final discrimination, calibration, and counterfactual claims are reported on TLSA/SANSCOG held-out splits. The whole point of the harmonisation stack is to make this pretraining transfer cleanly without poisoning the Indian-cohort model with cohort-specific shortcuts.

**Harmonisation stack.** Feature-level: neuroCombat for MRI features, analogous ComBat-style correction for biochem panels. Representation-level: a gradient-reversal head predicts cohort-of-origin from `z_t`, trained adversarially so the fused representation becomes cohort-invariant. Two-stage training: pretrain on the global pool, then fine-tune on TLSA/SANSCOG with a low learning rate and a regulariser that anchors the Indian-cohort head to the global head only where the data agrees.

**Training, validation, evaluation.** Deep ensembles (5 seeds) supply epistemic uncertainty; conformal prediction wraps regression heads for advertised coverage. Evaluation metrics: MAE, R², and CRPS per cognitive/imaging trajectory; AUROC, AUPRC, Brier, and net benefit (DCA) for MCI conversion; held-out matched-subgroup tests, placebo-treatment tests, and negative-control covariates for counterfactual validity; calibration plots and subgroup audits as first-class outputs in every report. Missing-modality robustness is a tracked stress test, not an afterthought.

## 4. Computing Resources Plan

**CBR infrastructure (sealed surface).** Final model training, evaluation, the validation report, and the jury-facing demo all run inside the CBR secure remote environment per the Challenge's data-use rules. Requested resources: GPU access sufficient for transformer-fusion training over O(10⁴) participants with O(10²) features and longitudinal observations — practically, one to two A100-class GPUs (or equivalent) for 1–2 weeks of cumulative training across ablation runs, plus standard CPU/RAM for tabular pipelines, harmonisation, and the demo app.

**External / institutional resources (open surface).** Pretraining on ADNI, UK Biobank, OASIS, NACC, and AIBL is performed on our institutional clusters or on cloud credits we already hold (Microsoft AI for Good / Azure Research grant programmes — to be confirmed at team-finalisation). Only **model weights and harmonisation transforms** — never participant-level data — cross the boundary from the open surface to the CBR sealed surface.

**Sufficiency rationale.** The architecture is intentionally lean — small per-modality encoders, mid-sized fusion transformer, conformal wrappers — chosen so that the binding constraint is *data*, not *compute*. Mixed-precision training, gradient checkpointing, and ensemble size capped at five keep total GPU-hours within the budget above. The architecture has a documented scale-up path (deeper fusion, additional pretraining cohorts) if more compute becomes available, but the headline deliverables do not depend on it.

## 5. Team Expertise and Relevant Experience

*To be completed once the team is finalised.* Target composition spans the five role areas the system requires:

1. **Lead / ML architect** — multimodal model design, sequence and survival modelling, prior production ML experience.
2. **Clinical / data lead** — neurology, geriatric medicine, or epidemiology background; familiarity with TLSA/SANSCOG-style cohort structures; clinical demo design.
3. **Harmonisation and causal-inference lead** — neuroCombat, domain-adversarial training, doubly-robust counterfactual estimators.
4. **MLOps and secure-environment lead** — reproducibility, compute orchestration, packaging within sealed environments.
5. **Frontend and demo lead** — clinician-facing interactive app (Streamlit/Gradio), report generation, jury demo polish.

Each member's relevant publications, prior projects, and code artifacts will be listed in the CV appendix. All members will be confirmed as residents of India working in Indian institutions per Challenge eligibility before submission.

---

# CVs of All Team Members

*Each CV: max 2 pages, focused on relevant experience.*

## CV 1 — Lead Participant
*TBD*

## CV 2
*TBD*

## CV 3
*TBD*

## CV 4
*TBD*

## CV 5
*TBD*
