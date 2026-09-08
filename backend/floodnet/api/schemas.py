"""Pydantic request models for the FloodNet API."""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


class BlockageSpec(BaseModel):
    mode: Literal["none", "fraction", "edges", "random", "near"] = "none"
    fraction: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="blockage fraction 0..1 applied to selected edges")
    edge_ids: Optional[list[str]] = None
    share: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="share of edges to block (mode=random)")
    lonlat: Optional[list[float]] = Field(default=None, min_length=2, max_length=2)
    radius_m: Optional[float] = Field(default=None, gt=0)
    seed: Optional[int] = None

    def to_spec(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class SimulateRequest(BaseModel):
    scenario_id: str
    blockage: BlockageSpec = Field(default_factory=BlockageSpec)
    horizon_min: int = Field(default=180, ge=5, le=720)


class ReplayRequest(BaseModel):
    blockage: BlockageSpec = Field(default_factory=BlockageSpec)
    horizon_min: int = Field(default=180, ge=5, le=720)


class CompareRequest(BaseModel):
    scenario_id: str
    blockage: BlockageSpec = Field(default_factory=BlockageSpec)
    horizon_min: int = Field(default=180, ge=5, le=720)


class RouteRequest(BaseModel):
    origin: list[float] = Field(min_length=2, max_length=2, description="[lon, lat]")
    dest: list[float] = Field(min_length=2, max_length=2, description="[lon, lat]")
    t_min: float = Field(default=0.0, ge=0.0)
    vehicle: str = "car"
    run_id: Optional[str] = None

    @field_validator("origin", "dest")
    @classmethod
    def _valid_lonlat(cls, v: list[float]) -> list[float]:
        lon, lat = v[0], v[1]
        if not (-180.0 <= lon <= 180.0) or not (-90.0 <= lat <= 90.0):
            raise ValueError(f"coordinate out of range: lon={lon}, lat={lat} "
                              "(expected abs(lon)<=180, abs(lat)<=90)")
        return v
