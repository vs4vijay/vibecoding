"""Cross-cohort feature harmonisation.

We implement a lightweight ComBat-style location/scale correction:

For each feature x in modality m, and cohort c with mean mu_c and var sigma_c^2,
we standardise to the grand mean mu_* and grand variance sigma_*^2 via:

    x_corrected = (x - mu_c) / sigma_c * sigma_* + mu_*

This is the additive+multiplicative correction step of ComBat without the
empirical Bayes shrinkage; for v1 synthetic data the EB step adds little.
"""

from __future__ import annotations

import math
import uuid
from collections import defaultdict
from typing import Any

import numpy as np

from ..config import Settings
from .types import HarmonisedRow, HarmoniseRequest, HarmoniseResponse


def _gather(rows, modalities):
    # by_modality_feature: modality -> feature -> list of (cohort, value, visit_id)
    by = defaultdict(lambda: defaultdict(list))
    for row in rows:
        for m in modalities:
            f = row.features.get(m, {})
            for name, v in f.items():
                by[m][name].append((row.cohort_id, float(v), row.visit_id))
    return by


def _stats(by):
    # Per (modality, feature, cohort): mean, std.
    cohort_stats: dict[str, dict[str, dict[str, dict[str, float]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(dict))
    )
    # Per (modality, feature): grand mean, std.
    grand_stats: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))

    for m, feats in by.items():
        for name, items in feats.items():
            by_cohort: dict[str, list[float]] = defaultdict(list)
            all_vals: list[float] = []
            for cohort, v, _ in items:
                by_cohort[cohort].append(v)
                all_vals.append(v)
            arr_all = np.array(all_vals, dtype=float)
            grand_stats[m][name] = {
                "mean": float(arr_all.mean()) if len(arr_all) else 0.0,
                "std": float(arr_all.std(ddof=0)) if len(arr_all) else 1.0,
            }
            for cohort, vals in by_cohort.items():
                a = np.array(vals, dtype=float)
                cohort_stats[m][name][cohort] = {
                    "mean": float(a.mean()) if len(a) else 0.0,
                    "std": float(a.std(ddof=0)) if len(a) else 1.0,
                }
    return cohort_stats, grand_stats


def run(req: HarmoniseRequest, settings: Settings) -> HarmoniseResponse:
    run_id = str(uuid.uuid4())
    rows = req.rows
    by = _gather(rows, req.modalities)
    cohort_stats, grand_stats = _stats(by)

    # before_means[modality][cohort] -> mean across all features (sanity-friendly summary)
    before_means: dict[str, dict[str, float]] = defaultdict(dict)
    cohorts_in_data: set[str] = set()
    for m, feats in cohort_stats.items():
        for name, by_cohort in feats.items():
            for cohort, st in by_cohort.items():
                cohorts_in_data.add(cohort)
                key = f"{name}"
                before_means[m].setdefault(cohort, 0.0)
                before_means[m][cohort] = float(st["mean"])  # last feature's mean per cohort

    # Apply correction; build harmonised rows.
    harmonised: list[HarmonisedRow] = []
    after_collect: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    feature_count = 0

    for row in rows:
        for m in req.modalities:
            payload: dict[str, float] = {}
            f = row.features.get(m, {})
            for name, v in f.items():
                cs = cohort_stats[m][name].get(row.cohort_id)
                gs = grand_stats[m][name]
                if cs is None or cs["std"] == 0 or gs["std"] == 0:
                    corrected = float(v)
                else:
                    z = (float(v) - cs["mean"]) / cs["std"]
                    corrected = z * gs["std"] + gs["mean"]
                payload[name] = float(corrected)
                after_collect[m][row.cohort_id].append(corrected)
                feature_count += 1
            harmonised.append(HarmonisedRow(visit_id=row.visit_id, modality=m, payload=payload))

    after_means: dict[str, dict[str, float]] = defaultdict(dict)
    for m, by_cohort in after_collect.items():
        for cohort, vals in by_cohort.items():
            if vals:
                after_means[m][cohort] = float(np.mean(vals))

    return HarmoniseResponse(
        run_id=run_id,
        cohort_ids=req.cohort_ids,
        feature_count=feature_count,
        before_means={m: dict(c) for m, c in before_means.items()},
        after_means={m: dict(c) for m, c in after_means.items()},
        parameters={
            "method": "combat-light",
            "seed": req.seed if req.seed is not None else settings.default_seed,
            "modalities": req.modalities,
        },
        harmonised_rows=harmonised,
    )
