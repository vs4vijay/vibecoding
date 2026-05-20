from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel

from . import __version__
from .config import Settings, get_settings
from .pipelines import audit as audit_pipe
from .pipelines import harmonise as harmonise_pipe
from .pipelines import predict as predict_pipe
from .pipelines import train as train_pipe
from .pipelines.types import (
    AuditRequest,
    AuditResponse,
    HarmoniseRequest,
    HarmoniseResponse,
    PredictRequest,
    PredictResponse,
    TrainRequest,
    TrainResponse,
)


def verify_internal(
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
    settings: Settings = Depends(get_settings),
):
    if not x_internal_secret or x_internal_secret != settings.internal_shared_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid internal secret",
        )


app = FastAPI(title="drishti-ml", version=__version__)


class HealthOut(BaseModel):
    status: str
    service: str
    version: str


@app.get("/healthz", response_model=HealthOut)
def healthz(settings: Settings = Depends(get_settings)) -> HealthOut:
    return HealthOut(status="ok", service="drishti-ml", version=settings.ml_version)


@app.post(
    "/pipelines/predict",
    response_model=PredictResponse,
    dependencies=[Depends(verify_internal)],
)
def predict(req: PredictRequest, settings: Settings = Depends(get_settings)) -> PredictResponse:
    return predict_pipe.run(req, settings)


@app.post(
    "/pipelines/harmonise",
    response_model=HarmoniseResponse,
    dependencies=[Depends(verify_internal)],
)
def harmonise(req: HarmoniseRequest, settings: Settings = Depends(get_settings)) -> HarmoniseResponse:
    return harmonise_pipe.run(req, settings)


@app.post(
    "/pipelines/train",
    response_model=TrainResponse,
    dependencies=[Depends(verify_internal)],
)
def train(req: TrainRequest, settings: Settings = Depends(get_settings)) -> TrainResponse:
    return train_pipe.run(req, settings)


@app.post(
    "/pipelines/audit",
    response_model=AuditResponse,
    dependencies=[Depends(verify_internal)],
)
def audit(req: AuditRequest, settings: Settings = Depends(get_settings)) -> AuditResponse:
    return audit_pipe.run(req, settings)
