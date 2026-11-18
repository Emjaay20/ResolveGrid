import os
import secrets
from pathlib import Path
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from app.ml.eta_engine import eta_engine
from app.agent.resolver_agent import resolver_agent

app = FastAPI(
    title="ResolveGrid AI Agent & Hybrid ML Engine",
    version="1.0.0",
    description="NIPOST tool-calling agent plus an explainable ETA baseline and online residual learner",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ResolveRequest(BaseModel):
    query: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class DispatchEtaRequest(BaseModel):
    tenant_id: str = "tenant_logistics_ng"
    ml_profile: str = "logistics_eta_v1"
    postcode: str = Field(min_length=3, max_length=64)
    candidates: List[Dict[str, Any]] = Field(min_length=1, max_length=100)


class OnlineLearnRequest(BaseModel):
    task_id: str = Field(min_length=1, max_length=128)
    postcode: str = Field(min_length=3, max_length=64)
    road_distance_m: int = Field(ge=0, le=1000000)
    osrm_base_duration_sec: int = Field(gt=0, le=86400)
    gate_delay_sec: int = Field(ge=0, le=7200)
    compound_walk_meters: float = Field(default=25, ge=0, le=5000, allow_inf_nan=False)
    rain_mm: float = Field(default=0, ge=0, le=500, allow_inf_nan=False)
    wind_speed_kmh: float = Field(default=10, ge=0, le=250, allow_inf_nan=False)
    velocity_kmh: float = Field(default=30, ge=0, le=200, allow_inf_nan=False)
    rolling_1h_on_time_rate: float = Field(default=0.96, ge=0, le=1, allow_inf_nan=False)
    active_load: int = Field(default=0, ge=0, le=100)
    predicted_eta_sec: int = Field(gt=0, le=86400)
    actual_duration_sec: int = Field(gt=0, le=86400)


def require_ml_service_token(token: Optional[str]) -> None:
    """Fail closed for the internal inference and learning endpoints."""
    expected = os.getenv("ML_SERVICE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="ML service authentication is not configured")
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid ML service credential")


@app.get("/v1/health")
async def health() -> Dict[str, Any]:
    return {
        "service": "resolvegrid-ml-engine",
        "version": "1.0.0",
        "llm_providers": resolver_agent.get_configured_providers(),
        "ml_engine": eta_engine.get_status(),
    }


@app.post("/v1/agent/resolve")
async def agent_resolve(
    body: ResolveRequest,
    x_nipost_key: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    return await resolver_agent.resolve(
        query=body.query,
        lat=body.lat,
        lng=body.lng,
        nipost_key=x_nipost_key,
    )


@app.post("/v1/ml/dispatch-eta")
async def dispatch_eta(
    body: DispatchEtaRequest,
    x_ml_service_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_ml_service_token(x_ml_service_token)
    try:
        return eta_engine.score_candidates(
            postcode=body.postcode,
            candidates=body.candidates,
            ml_profile=body.ml_profile,
        )
    except (ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(status_code=422, detail="Invalid numeric ETA features") from exc


@app.post("/v1/ml/learn")
async def ml_learn(
    body: OnlineLearnRequest,
    x_ml_service_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_ml_service_token(x_ml_service_token)
    try:
        return eta_engine.learn_one(body.model_dump())
    except (ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(status_code=422, detail="Invalid learning observation") from exc
