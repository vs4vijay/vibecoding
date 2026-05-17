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
- [PROPOSAL.md](./PROPOSAL.md) — formal proposal, markdown rendering of the official template
- [PROBLEM.md](./PROBLEM.md) — long-form problem statement (working notes)
- [SOLUTION.md](./SOLUTION.md) — long-form solution design (working notes)
- [proposal-template.docx](./proposal-template.docx) — official template the proposal mirrors

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
