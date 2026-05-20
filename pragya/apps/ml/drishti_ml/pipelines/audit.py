from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np

from ..config import Settings
from ..models.registry import load_active_model
from ..models.survival import _auprc, _auroc, _ece
from .types import AuditRequest, AuditResponse, CalibrationBin, SubgroupMetric


def _band_age(age: float) -> str:
    if age < 55:
        return "<55"
    if age < 65:
        return "55-64"
    if age < 75:
        return "65-74"
    return "75+"


def _band_education(years: int) -> str:
    if years < 6:
        return "<6"
    if years < 12:
        return "6-11"
    return "12+"


def _rows_to_arrays(rows, model) -> tuple[np.ndarray, dict[int, np.ndarray], list[dict[str, Any]]]:
    from ..models.feature_utils import flatten_features

    meta: list[dict[str, Any]] = []
    X_rows: list[np.ndarray] = []
    y_per_h: dict[int, list[int]] = {h: [] for h in model.heads.keys()}
    for r in rows:
        meta.append(
            {
                "sex": r.sex,
                "age_baseline": r.age_baseline,
                "education_years": r.education_years,
                "urban_rural": r.urban_rural,
                "apoe4_carrier": r.apoe4_carrier,
            }
        )
        X_rows.append(flatten_features(r.features, model.feature_names, demographics=meta[-1]))
        for h in model.heads.keys():
            y_per_h[h].append(1 if (r.mci_status and r.time_years <= h) else 0)
    X = np.vstack(X_rows) if X_rows else np.zeros((0, len(model.feature_names)))
    y_arr = {h: np.array(v, dtype=int) for h, v in y_per_h.items()}
    return X, y_arr, meta


def run(req: AuditRequest, settings: Settings) -> AuditResponse:
    model = load_active_model(settings)
    if model is None:
        return AuditResponse(model_id=req.model_id, calibration={}, subgroups=[])

    X, y_per_h, meta = _rows_to_arrays(req.rows, model)
    if X.shape[0] == 0:
        return AuditResponse(model_id=model.model_id, calibration={}, subgroups=[])

    # Predict for each horizon.
    preds_per_h: dict[int, np.ndarray] = {}
    for h, head in model.heads.items():
        if not head.estimators:
            preds_per_h[h] = np.full(X.shape[0], 0.5)
            continue
        Xs = head.scaler.transform(X)
        ps = np.array([clf.predict_proba(Xs)[:, 1] for clf in head.estimators])
        preds_per_h[h] = ps.mean(axis=0)

    # Calibration plot per horizon (10 bins).
    calibration: dict[str, list[CalibrationBin]] = {}
    for h, p in preds_per_h.items():
        y = y_per_h[h]
        edges = np.linspace(0, 1, 11)
        bins: list[CalibrationBin] = []
        for i in range(10):
            mask = (p >= edges[i]) & (p < edges[i + 1])
            if i == 9:
                mask = (p >= edges[i]) & (p <= edges[i + 1])
            n = int(mask.sum())
            if n == 0:
                bins.append(CalibrationBin(predicted=float((edges[i] + edges[i + 1]) / 2), observed=0.0, n=0))
            else:
                bins.append(
                    CalibrationBin(
                        predicted=float(p[mask].mean()),
                        observed=float(y[mask].mean()),
                        n=n,
                    )
                )
        calibration[str(h)] = bins

    # Subgroup metrics.
    def _subgroup_metrics(name: str, key_fn) -> list[SubgroupMetric]:
        groups: dict[str, list[int]] = defaultdict(list)
        for i, m in enumerate(meta):
            groups[key_fn(m)].append(i)
        out: list[SubgroupMetric] = []
        for val, idxs in groups.items():
            idxs = np.array(idxs, dtype=int)
            auroc = {}
            auprc = {}
            cale = {}
            for h, p in preds_per_h.items():
                pp = p[idxs]
                yy = y_per_h[h][idxs]
                if yy.size == 0:
                    continue
                auroc[str(h)] = float(_auroc(yy, pp))
                auprc[str(h)] = float(_auprc(yy, pp))
                cale[str(h)] = float(_ece(yy, pp))
            out.append(
                SubgroupMetric(
                    subgroup=name,
                    value=str(val),
                    n=int(len(idxs)),
                    auroc=auroc,
                    auprc=auprc,
                    calibration_error=cale,
                )
            )
        return out

    subgroups: list[SubgroupMetric] = []
    subgroups += _subgroup_metrics("sex", lambda m: m["sex"])
    subgroups += _subgroup_metrics("urban_rural", lambda m: m["urban_rural"])
    subgroups += _subgroup_metrics("age_band", lambda m: _band_age(m["age_baseline"]))
    subgroups += _subgroup_metrics("education_band", lambda m: _band_education(int(m["education_years"])))
    subgroups += _subgroup_metrics("apoe4_carrier", lambda m: str(bool(m["apoe4_carrier"])))

    return AuditResponse(model_id=model.model_id, calibration=calibration, subgroups=subgroups)
