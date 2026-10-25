import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from app.ml.eta_engine import eta_engine
from app.agent.resolver_agent import resolver_agent

app = FastAPI(
    title="ResolveGrid AI Agent & Hybrid ML Engine",
    version="1.0.0",
    description="Multi-Provider NIPOST Tool-Calling Agent + Champion LightGBM & Challenger Online River ETA Engine",
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
    postcode: str
    candidates: List[Dict[str, Any]]


class OnlineLearnRequest(BaseModel):
    task_id: str
    postcode: str
    road_distance_m: int
    osrm_base_duration_sec: int
    gate_delay_sec: int
    rain_mm: float = 0.0
    predicted_eta_sec: int
    actual_duration_sec: int


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
async def dispatch_eta(body: DispatchEtaRequest) -> Dict[str, Any]:
    return eta_engine.score_candidates(
        postcode=body.postcode,
        candidates=body.candidates,
        ml_profile=body.ml_profile,
    )


@app.post("/v1/ml/learn")
async def ml_learn(body: OnlineLearnRequest) -> Dict[str, Any]:
    return eta_engine.learn_one(body.model_dump())
