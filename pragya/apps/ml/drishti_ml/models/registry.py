"""In-process model registry. Persists active model id to disk so it survives restarts."""

from __future__ import annotations

import json
import os
from typing import Optional

from ..config import Settings
from .survival import SurvivalModel, load_model


def _registry_path(settings: Settings) -> str:
    return os.path.join(settings.artefacts_dir, "registry.json")


def set_active_model(model_id: str, artefact_path: str, settings: Settings) -> None:
    os.makedirs(settings.artefacts_dir, exist_ok=True)
    payload = {"active_model_id": model_id, "artefact_path": artefact_path}
    with open(_registry_path(settings), "w", encoding="utf-8") as f:
        json.dump(payload, f)
    # Bust the cache.
    _cached["model"] = None


_cached: dict[str, Optional[SurvivalModel]] = {"model": None}


def load_active_model(settings: Settings) -> Optional[SurvivalModel]:
    if _cached["model"] is not None:
        return _cached["model"]
    path = _registry_path(settings)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        artefact = payload.get("artefact_path")
        if not artefact or not os.path.exists(artefact):
            return None
        model = load_model(artefact)
        _cached["model"] = model
        return model
    except Exception:
        return None
