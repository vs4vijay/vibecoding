from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Modality = Literal["mri", "biochem", "oct", "cognitive"]


class RiskInterval(BaseModel):
    horizon_years: int
    risk_point: float
    risk_lo_80: float
    risk_hi_80: float
    risk_lo_95: float
    risk_hi_95: float


class PredictRequest(BaseModel):
    participant_id: str
    model_id: str | None = None
    horizons_years: list[int] = Field(default_factory=lambda: [1, 3, 5])
    features: dict[str, Any]
    seed: int | None = None


class PredictResponse(BaseModel):
    participant_id: str
    model_id: str
    model_version: str
    predictions: list[RiskInterval]


class HarmoniseRow(BaseModel):
    visit_id: str
    cohort_id: str
    features: dict[str, dict[str, float]]  # modality -> feature name -> value


class HarmoniseRequest(BaseModel):
    cohort_ids: list[str]
    modalities: list[Modality] = Field(default_factory=lambda: ["mri", "biochem"])
    seed: int | None = None
    rows: list[HarmoniseRow] = Field(default_factory=list)


class HarmonisedRow(BaseModel):
    visit_id: str
    modality: str
    payload: dict[str, float]


class HarmoniseResponse(BaseModel):
    run_id: str
    cohort_ids: list[str]
    feature_count: int
    before_means: dict[str, dict[str, float]]
    after_means: dict[str, dict[str, float]]
    parameters: dict[str, Any]
    harmonised_rows: list[HarmonisedRow]


class TrainRow(BaseModel):
    participant_id: str
    cohort_id: str
    sex: str
    age_baseline: float
    education_years: int
    urban_rural: str
    apoe4_carrier: bool
    features: dict[str, dict[str, float]]  # modality -> feature -> value
    time_years: float
    mci_status: bool


class TrainRequest(BaseModel):
    cohort_ids: list[str]
    modalities: list[Modality] = Field(
        default_factory=lambda: ["mri", "biochem", "cognitive"]
    )
    horizons_years: list[int] = Field(default_factory=lambda: [1, 3, 5])
    ensemble_size: int = 3
    seed: int = 42
    harmonisation_run_id: str | None = None
    rows: list[TrainRow] = Field(default_factory=list)


class TrainResponse(BaseModel):
    model_id: str
    model_version: str
    metrics: dict[str, dict[str, float]]
    params: dict[str, Any]
    ensemble_size: int


class AuditRequest(BaseModel):
    model_id: str
    cohort_ids: list[str] | None = None
    seed: int | None = None
    rows: list[TrainRow] = Field(default_factory=list)


class CalibrationBin(BaseModel):
    predicted: float
    observed: float
    n: int


class SubgroupMetric(BaseModel):
    subgroup: str
    value: str
    n: int
    auroc: dict[str, float]
    auprc: dict[str, float]
    calibration_error: dict[str, float]


class AuditResponse(BaseModel):
    model_id: str
    calibration: dict[str, list[CalibrationBin]]
    subgroups: list[SubgroupMetric]
