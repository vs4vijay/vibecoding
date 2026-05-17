# Problem Statement

## The situation

India is on track to have **over 340 million people aged 60+ by 2050** — one of the world's fastest-growing aging populations. Layered on top is a heavy burden of cardio-metabolic disease (hypertension, diabetes, dyslipidemia, central obesity), which is a primary upstream driver of vascular and mixed dementias.

Despite this, **Indians are systematically underrepresented in global brain-aging research**. The cohorts that have shaped modern dementia AI — ADNI, UK Biobank, OASIS, NACC, AIBL — are overwhelmingly Caucasian, Western, and higher-education-skewed. The result:

- Risk models trained on these cohorts **transfer poorly** to Indian populations whose genetic background (incl. ApoE allele frequencies), education distribution, multilingual cognitive profiles, vascular risk burden, and access-to-care realities are different.
- Indian clinicians lack tools that can give a **localised, individualised** answer to the question every family eventually asks: *"How is my parent's brain likely to age, and is there anything we can do about it?"*
- The country's enormous **prevention opportunity** is going unrealised. The Lancet Commission on Dementia Prevention (2024) puts ~45% of dementia cases as attributable to modifiable risk factors — and India's modifiable burden (BP, glucose, lipids, obesity, hearing loss, education access) is exactly where intervention is most cost-effective.

## The challenge's framing

CBR's challenge asks teams to *"develop AI models and tools to advance and accelerate Alzheimer's and dementia research"* — explicitly listing prediction of MCI/dementia, disease-progression models, **digital twins**, and data-harmonization tools as in-scope.

## The specific problem we are solving

> **Given an Indian adult's multimodal baseline (cognitive, structural MRI, retinal OCT/Angio, blood biochemistry, omics), forecast their personalised 5–10 year brain-aging trajectory, quantify their time-to-MCI risk, and let a clinician simulate the trajectory under counterfactual interventions on modifiable cardio-metabolic factors — using a model that is calibrated specifically on Indian cohort data while leveraging global cohorts for transfer.**

## Why this framing

1. **Uses the unique CBR asset.** TLSA and SANSCOG are 10+ year, multimodal, Indian longitudinal cohorts — they exist nowhere else and are the only credible substrate for an Indian-calibrated model.
2. **Hits multiple of the challenge's stated examples in one solution.** MCI prediction + disease progression + digital twin + harmonisation are all entailed, not bolted on.
3. **Outputs are actionable, not just predictive.** Counterfactual sliders on BP/HbA1c/lipids turn a black-box risk score into a clinical decision aid — the difference between *"your risk is 23%"* and *"your risk drops from 23% to 14% if SBP held below 130 from 60 to 70."*
4. **Addresses the underrepresentation hook directly.** The challenge prospectus literally calls out that *"Indians are underrepresented in such studies"* — a model that explicitly corrects for this is on-thesis.
5. **Tractable in the August 2026 – January 2027 execution window.** Six months is enough to train, validate, and demo — not enough to do something open-ended like discover novel biomarkers.

## What success looks like

- A trained model with **calibrated** (not just accurate) trajectory and risk outputs on a held-out TLSA/SANSCOG test split.
- External validation showing the harmonisation layer meaningfully closes the cohort-shift gap vs. an ADNI-only baseline.
- A working interactive demo where a clinician can load a participant profile and explore intervention scenarios.
- Subgroup fairness audit across sex, education, urban/rural, age bands.
- Open-source code release (within secure-env constraints) and a manuscript draft.

## Out of scope (deliberately)

- Discovering new biomarkers. We use what TLSA/SANSCOG already captures.
- Raw-image deep learning from DICOMs. We work with the extracted/tabulated MRI + OCT parameters CBR already provides.
- Causal identification claims. Counterfactuals are framed as *predictive what-if* with sensitivity analysis across estimators, not as identified causal effects.
- Clinical deployment. We deliver a research-grade tool, not a CDSCO-cleared product.
