from __future__ import annotations

import numpy as np

DEMOGRAPHIC_FEATURES = ["age_baseline", "education_years", "is_female", "is_urban", "apoe4_carrier"]

# Default feature ordering when nothing else is supplied. Matches the synthetic generator.
DEFAULT_FEATURE_NAMES = [
    # demographics
    "age_baseline",
    "education_years",
    "is_female",
    "is_urban",
    "apoe4_carrier",
    # cognitive
    "memory",
    "executive",
    "language",
    "attention",
    "visuospatial",
    "mmse",
    # mri
    "hippocampus_l",
    "hippocampus_r",
    "entorhinal_l",
    "entorhinal_r",
    "cortical_thickness_mean",
    "ventricular_volume",
    "white_matter_hyperintensities",
    # biochem
    "hba1c",
    "ldl",
    "hdl",
    "triglycerides",
    "sbp",
    "dbp",
    "bmi",
]


def ordered_feature_names(row: dict) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for f in DEFAULT_FEATURE_NAMES:
        if f not in seen:
            names.append(f)
            seen.add(f)
    feats = row.get("features", {})
    for mod in ("cognitive", "mri", "biochem", "oct"):
        for k in (feats.get(mod) or {}).keys():
            if k not in seen:
                names.append(k)
                seen.add(k)
    return names


def flatten_features(
    features: dict,
    feature_names: list[str],
    demographics: dict | None = None,
) -> np.ndarray:
    """Flatten a nested features dict + optional demographics row to a 1D numpy array.

    features may be either {modality: {name: value}} or {name: value} (already flat).
    """
    # Resolve a flat (name -> value) dict.
    flat: dict[str, float] = {}
    if isinstance(features, dict):
        looks_nested = any(isinstance(v, dict) for v in features.values())
        if looks_nested:
            for mod, payload in features.items():
                if isinstance(payload, dict):
                    for k, v in payload.items():
                        flat[k] = float(v) if v is not None else 0.0
        else:
            for k, v in features.items():
                try:
                    flat[k] = float(v) if v is not None else 0.0
                except (TypeError, ValueError):
                    flat[k] = 0.0

    if demographics is not None:
        flat.setdefault("age_baseline", float(demographics.get("age_baseline", 0.0)))
        flat.setdefault("education_years", float(demographics.get("education_years", 0)))
        sex = str(demographics.get("sex", "M"))
        flat.setdefault("is_female", 1.0 if sex == "F" else 0.0)
        ur = str(demographics.get("urban_rural", "urban"))
        flat.setdefault("is_urban", 1.0 if ur == "urban" else 0.0)
        flat.setdefault(
            "apoe4_carrier",
            1.0 if bool(demographics.get("apoe4_carrier", False)) else 0.0,
        )

    return np.array([flat.get(name, 0.0) for name in feature_names], dtype=float)
