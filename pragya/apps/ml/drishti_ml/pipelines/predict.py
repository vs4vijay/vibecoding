from __future__ import annotations

import hashlib

import numpy as np

from ..config import Settings
from ..models.registry import load_active_model
from .types import PredictRequest, PredictResponse, RiskInterval


def _stub_risk(participant_id: str, horizon: int, seed: int | None) -> float:
    h = hashlib.sha256(f"{participant_id}:{horizon}:{seed}".encode()).hexdigest()
    r = int(h[:8], 16) / 0xFFFFFFFF
    # Bias risk to grow with horizon.
    return float(min(0.95, max(0.01, r * 0.3 + (horizon / 10.0))))


def run(req: PredictRequest, settings: Settings) -> PredictResponse:
    active = load_active_model(settings)
    if active is None:
        # Phase 4 stub path.
        seed = req.seed if req.seed is not None else settings.default_seed
        predictions = []
        for h in req.horizons_years:
            p = _stub_risk(req.participant_id, h, seed)
            half80 = 0.05
            half95 = 0.10
            predictions.append(
                RiskInterval(
                    horizon_years=h,
                    risk_point=p,
                    risk_lo_80=max(0.0, p - half80),
                    risk_hi_80=min(1.0, p + half80),
                    risk_lo_95=max(0.0, p - half95),
                    risk_hi_95=min(1.0, p + half95),
                )
            )
        return PredictResponse(
            participant_id=req.participant_id,
            model_id="stub-v0",
            model_version="0.0.0",
            predictions=predictions,
        )

    # Phase 7: real model. The active model carries an ensemble of per-horizon classifiers.
    intervals = active.predict_intervals(req.features, req.horizons_years, seed=req.seed)
    return PredictResponse(
        participant_id=req.participant_id,
        model_id=active.model_id,
        model_version=active.version,
        predictions=[RiskInterval(**iv) for iv in intervals],
    )
