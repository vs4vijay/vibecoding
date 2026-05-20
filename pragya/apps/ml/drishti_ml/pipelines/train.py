from __future__ import annotations

from typing import Any

from ..config import Settings
from ..models.feature_utils import DEFAULT_FEATURE_NAMES, ordered_feature_names
from ..models.registry import set_active_model
from ..models.survival import save_model, train_model
from .types import TrainRequest, TrainResponse


def _rows_to_dicts(rows) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        out.append(
            {
                "participant_id": r.participant_id,
                "cohort_id": r.cohort_id,
                "sex": r.sex,
                "age_baseline": r.age_baseline,
                "education_years": r.education_years,
                "urban_rural": r.urban_rural,
                "apoe4_carrier": r.apoe4_carrier,
                "features": r.features,
                "time_years": r.time_years,
                "mci_status": r.mci_status,
            }
        )
    return out


def run(req: TrainRequest, settings: Settings) -> TrainResponse:
    rows = _rows_to_dicts(req.rows)
    if not rows:
        return TrainResponse(
            model_id="empty",
            model_version="0.0.0",
            metrics={"auroc": {}, "auprc": {}, "brier": {}, "calibration_error": {}},
            params={"reason": "no rows"},
            ensemble_size=req.ensemble_size,
        )

    feature_names = ordered_feature_names(rows[0]) or DEFAULT_FEATURE_NAMES
    model = train_model(
        rows=rows,
        horizons_years=req.horizons_years,
        ensemble_size=req.ensemble_size,
        seed=req.seed,
        feature_names=feature_names,
    )
    artefact_path = save_model(model, settings.artefacts_dir)
    set_active_model(model.model_id, artefact_path, settings)
    return TrainResponse(
        model_id=model.model_id,
        model_version=model.version,
        metrics=model.metrics,
        params=model.params,
        ensemble_size=req.ensemble_size,
    )
