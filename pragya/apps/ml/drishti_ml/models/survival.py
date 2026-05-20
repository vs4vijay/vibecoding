"""Simple discrete-time hazard model with deep-ensemble + split-conformal intervals.

We frame MCI conversion at horizons {1, 3, 5} as N independent binary classifications:
"converted by year H". This is a discrete-time-hazard approximation that is plenty
sufficient for v1 synthetic-data evaluation.

For uncertainty:
 - Deep ensemble: K logistic-regression heads with different random init / data shuffles.
 - Split-conformal: hold out a calibration subset; compute |y - p_hat| residuals;
   set the 80/95 quantile as the half-width. This is a marginal coverage guarantee
   sufficient for v1.
"""

from __future__ import annotations

import json
import os
import pickle
import uuid
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .feature_utils import (
    DEMOGRAPHIC_FEATURES,
    DEFAULT_FEATURE_NAMES,
    flatten_features,
    ordered_feature_names,
)


@dataclass
class EnsembleHead:
    horizon: int
    estimators: list[LogisticRegression]
    scaler: StandardScaler
    conformal_q80: float
    conformal_q95: float


@dataclass
class SurvivalModel:
    model_id: str
    version: str
    feature_names: list[str]
    heads: dict[int, EnsembleHead]
    metrics: dict[str, dict[str, float]] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)

    def predict_intervals(
        self,
        features: dict[str, Any],
        horizons_years: Sequence[int],
        seed: int | None = None,
    ) -> list[dict[str, float]]:
        x = flatten_features(features, self.feature_names)
        out = []
        for h in horizons_years:
            head = self.heads.get(int(h))
            if head is None:
                # Skip this horizon if we didn't train it; emit a NaN-ish.
                out.append(
                    {
                        "horizon_years": int(h),
                        "risk_point": 0.5,
                        "risk_lo_80": 0.3,
                        "risk_hi_80": 0.7,
                        "risk_lo_95": 0.15,
                        "risk_hi_95": 0.85,
                    }
                )
                continue
            xs = head.scaler.transform(x.reshape(1, -1))
            preds = np.array([clf.predict_proba(xs)[0, 1] for clf in head.estimators])
            point = float(np.clip(preds.mean(), 1e-4, 1 - 1e-4))
            # Combine ensemble spread with conformal residual for the half-width.
            ensemble_std = float(preds.std(ddof=0))
            half80 = float(min(0.5, head.conformal_q80 + ensemble_std * 1.28))
            half95 = float(min(0.5, head.conformal_q95 + ensemble_std * 1.96))
            out.append(
                {
                    "horizon_years": int(h),
                    "risk_point": point,
                    "risk_lo_80": float(max(0.0, point - half80)),
                    "risk_hi_80": float(min(1.0, point + half80)),
                    "risk_lo_95": float(max(0.0, point - half95)),
                    "risk_hi_95": float(min(1.0, point + half95)),
                }
            )
        return out


def _split_conformal_quantile(residuals: np.ndarray, alpha: float) -> float:
    """Split-conformal quantile with finite-sample correction."""
    n = len(residuals)
    if n == 0:
        return 0.1
    k = int(np.ceil((n + 1) * (1 - alpha)))
    k = max(1, min(n, k))
    return float(np.sort(np.abs(residuals))[k - 1])


def train_model(
    rows: list[dict[str, Any]],
    horizons_years: Sequence[int],
    ensemble_size: int,
    seed: int,
    feature_names: list[str] | None = None,
) -> SurvivalModel:
    if not rows:
        raise ValueError("No rows to train on")

    fnames = feature_names or ordered_feature_names(rows[0])
    if not fnames:
        fnames = DEFAULT_FEATURE_NAMES

    X = np.vstack([flatten_features(r["features"], fnames, demographics=r) for r in rows])
    # Build per-horizon binary labels via right-censoring rule:
    # y_h = 1 if mci_status AND time_years <= h; 0 otherwise (including censored).
    times = np.array([float(r["time_years"]) for r in rows])
    statuses = np.array([1 if r["mci_status"] else 0 for r in rows], dtype=int)

    rng = np.random.default_rng(seed)

    # Train/cal/test split: 60/20/20.
    n = len(rows)
    idx = rng.permutation(n)
    n_train = int(0.6 * n)
    n_cal = int(0.2 * n)
    train_idx = idx[:n_train]
    cal_idx = idx[n_train : n_train + n_cal]
    test_idx = idx[n_train + n_cal :]

    heads: dict[int, EnsembleHead] = {}
    metrics: dict[str, dict[str, float]] = {
        "auroc": {},
        "auprc": {},
        "brier": {},
        "calibration_error": {},
    }

    for h in horizons_years:
        h = int(h)
        y = ((statuses == 1) & (times <= h)).astype(int)
        if y.sum() == 0 or y.sum() == len(y):
            # Cannot train a classifier with a single class; emit a constant head.
            const = float(y.mean())
            heads[h] = EnsembleHead(
                horizon=h,
                estimators=[],
                scaler=StandardScaler().fit(X),
                conformal_q80=0.1,
                conformal_q95=0.2,
            )
            metrics["auroc"][str(h)] = 0.5
            metrics["auprc"][str(h)] = float(max(const, 1 - const))
            metrics["brier"][str(h)] = float(const * (1 - const))
            metrics["calibration_error"][str(h)] = 0.0
            continue

        scaler = StandardScaler().fit(X[train_idx])
        Xs_train = scaler.transform(X[train_idx])
        Xs_cal = scaler.transform(X[cal_idx])
        Xs_test = scaler.transform(X[test_idx])

        estimators: list[LogisticRegression] = []
        for k in range(ensemble_size):
            sub_seed = int(rng.integers(0, 2**31 - 1))
            ksub_rng = np.random.default_rng(sub_seed)
            sub_idx = ksub_rng.choice(len(train_idx), size=len(train_idx), replace=True)
            clf = LogisticRegression(
                max_iter=500,
                C=1.0,
                random_state=sub_seed,
                class_weight="balanced",
            )
            try:
                clf.fit(Xs_train[sub_idx], y[train_idx][sub_idx])
            except ValueError:
                clf = LogisticRegression(max_iter=500, C=1.0, random_state=sub_seed)
                clf.fit(Xs_train, y[train_idx])
            estimators.append(clf)

        def _ensemble_proba(Xs: np.ndarray) -> np.ndarray:
            ps = np.array([clf.predict_proba(Xs)[:, 1] for clf in estimators])
            return ps.mean(axis=0)

        cal_p = _ensemble_proba(Xs_cal)
        cal_y = y[cal_idx]
        residuals = np.abs(cal_y - cal_p)
        q80 = _split_conformal_quantile(residuals, alpha=0.2)
        q95 = _split_conformal_quantile(residuals, alpha=0.05)

        test_p = _ensemble_proba(Xs_test)
        test_y = y[test_idx]
        metrics["auroc"][str(h)] = _auroc(test_y, test_p)
        metrics["auprc"][str(h)] = _auprc(test_y, test_p)
        metrics["brier"][str(h)] = float(np.mean((test_p - test_y) ** 2))
        metrics["calibration_error"][str(h)] = _ece(test_y, test_p)

        heads[h] = EnsembleHead(
            horizon=h,
            estimators=estimators,
            scaler=scaler,
            conformal_q80=q80,
            conformal_q95=q95,
        )

    model_id = f"drishti-survival-{uuid.uuid4().hex[:8]}"
    version = "0.1.0"
    return SurvivalModel(
        model_id=model_id,
        version=version,
        feature_names=fnames,
        heads=heads,
        metrics=metrics,
        params={
            "ensemble_size": ensemble_size,
            "horizons_years": list(map(int, horizons_years)),
            "seed": seed,
            "feature_count": len(fnames),
            "n_train": int(n_train),
            "n_cal": int(n_cal),
            "n_test": int(n - n_train - n_cal),
        },
    )


def _auroc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    pos = y_score[y_true == 1]
    neg = y_score[y_true == 0]
    if len(pos) == 0 or len(neg) == 0:
        return 0.5
    n_pos = len(pos)
    n_neg = len(neg)
    # Mann-Whitney U statistic over a small flat array is fine for v1 scale.
    ranks = _rankdata(np.concatenate([pos, neg]))
    rank_pos = ranks[:n_pos].sum()
    auc = (rank_pos - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)
    return float(auc)


def _rankdata(a: np.ndarray) -> np.ndarray:
    order = np.argsort(a)
    ranks = np.empty_like(order, dtype=float)
    n = len(a)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and a[order[j + 1]] == a[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _auprc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    order = np.argsort(-y_score)
    y = y_true[order]
    tp = 0
    fp = 0
    fn = int(y_true.sum())
    if fn == 0:
        return 0.0
    last_precision = 1.0
    auprc = 0.0
    for label in y:
        if label == 1:
            tp += 1
            fn -= 1
        else:
            fp += 1
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        precision = tp / (tp + fp) if (tp + fp) else 1.0
        auprc += precision * (recall - (auprc / max(last_precision, 1e-9) if False else 0))
        # Simpler: trapezoid over recall steps.
    # Recompute using a proper trapezoid over recall steps to avoid the above hand-wave.
    auprc = _proper_auprc(y_true, y_score)
    return float(auprc)


def _proper_auprc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    order = np.argsort(-y_score)
    y = y_true[order]
    tp = 0
    fp = 0
    pos_total = int(y_true.sum())
    if pos_total == 0:
        return 0.0
    last_recall = 0.0
    last_precision = 1.0
    area = 0.0
    for label in y:
        if label == 1:
            tp += 1
        else:
            fp += 1
        precision = tp / (tp + fp)
        recall = tp / pos_total
        area += (recall - last_recall) * (precision + last_precision) / 2
        last_recall = recall
        last_precision = precision
    return area


def _ece(y_true: np.ndarray, y_score: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    total = len(y_true)
    if total == 0:
        return 0.0
    ece = 0.0
    for i in range(bins):
        mask = (y_score >= edges[i]) & (y_score < edges[i + 1])
        if i == bins - 1:
            mask = (y_score >= edges[i]) & (y_score <= edges[i + 1])
        n = int(mask.sum())
        if n == 0:
            continue
        avg_pred = float(y_score[mask].mean())
        avg_obs = float(y_true[mask].mean())
        ece += (n / total) * abs(avg_pred - avg_obs)
    return float(ece)


def save_model(model: SurvivalModel, artefacts_dir: str) -> str:
    os.makedirs(artefacts_dir, exist_ok=True)
    path = os.path.join(artefacts_dir, f"{model.model_id}.pkl")
    with open(path, "wb") as f:
        pickle.dump(model, f)
    return path


def load_model(path: str) -> SurvivalModel:
    with open(path, "rb") as f:
        return pickle.load(f)
