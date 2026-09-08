"""Rainfall provider abstraction: separates rainfall SOURCE from the simulation.

The simulation engine (`floodnet.simulation.engine`) consumes a `RainfallScenario` (see `contracts.py`) as its
only rainfall interface and is untouched by this module. A `RainfallProvider` is simply a different way of
producing a `RainfallScenario`, plus a `RainfallSourceMeta` describing where that scenario's numbers came
from, so callers (the API layer) can ask "give me rainfall input X" without knowing whether X is a hardcoded
design storm, a replayed historical event, or (in the future) a live nowcast feed.

Three providers are wired today:
  - `ScenarioProvider`          SYNTHETIC design storms: moderate / heavy / cloudburst.
  - `HistoricalReplayProvider`  REAL, transcribed historical event: 26 July 2005 (Chitale Committee report).
  - `ExternalNowcastProvider`   inert interface stub for a future IMD/radar/pysteps adapter. Calling `.get()`
                                 raises `NotImplementedError` -- no live nowcast source is connected in this
                                 prototype, and this module will never fabricate one.

No rainfall data is invented or duplicated here: `ScenarioProvider` and `HistoricalReplayProvider` both
delegate to the existing `floodnet.data.scenarios.scenarios()` dict (see that module's docstring for the
full provenance of each series) rather than re-declaring the numbers.

`RainfallSourceMeta` is a NEW dataclass local to this module (not `contracts.py`) -- it augments, but never
replaces, a scenario's own `.provenance` field.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

from ..config import HORIZON_S, RAIN_DT_S
from ..contracts import RainfallScenario
from ..provenance import Provenance, Tag

SCENARIO_IDS: tuple[str, ...] = ("moderate", "heavy", "cloudburst")
HISTORICAL_REPLAY_ID = "july2005"


@dataclass(frozen=True)
class RainfallSourceMeta:
    """Metadata about WHERE a `RainfallScenario`'s numbers came from (not what they are)."""
    source_type: str            # "scenario" | "historical_replay" | "external_nowcast"
    source_name: str
    timestamp: str               # ISO8601 fetch/production time; "N/A (design storm)" for synthetic scenarios,
                                  # or the real historical event date for a replay
    forecast_horizon_min: int
    resolution_min: int          # temporal resolution of the underlying source series (minutes)
    data_mode: str                # "SYNTHETIC" | "REAL" | "DEMONSTRATION" | "NWP" (matches provenance.Tag)
    provenance: Provenance

    def to_dict(self) -> dict:
        return {"source_type": self.source_type, "source_name": self.source_name, "timestamp": self.timestamp,
                "forecast_horizon_min": self.forecast_horizon_min, "resolution_min": self.resolution_min,
                "data_mode": self.data_mode, "provenance": self.provenance.to_dict()}


class RainfallProvider(ABC):
    """Common interface for "a source of rainfall input to the simulation engine".

    Implementations must never fabricate rainfall: if a source cannot produce a real value, raise (see
    `ExternalNowcastProvider`) rather than inventing one.
    """

    @abstractmethod
    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        """Return (scenario, meta) for the requested rainfall input."""
        ...


class ScenarioProvider(RainfallProvider):
    """SYNTHETIC design-storm scenarios (moderate / heavy / cloudburst).

    Sourced from `floodnet.data.scenarios.scenarios()` -- the numbers are not duplicated here.
    """

    def __init__(self, ids: tuple[str, ...] = SCENARIO_IDS):
        self.ids = ids

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        from ..data.scenarios import scenarios as _scenarios
        sid = scenario_id or self.ids[0]
        if sid not in self.ids:
            raise KeyError(f"ScenarioProvider does not serve {sid!r}; available: {list(self.ids)}")
        scen = _scenarios()[sid]
        meta = RainfallSourceMeta(source_type="scenario", source_name=scen.name,
                                   timestamp="N/A (design storm)", forecast_horizon_min=HORIZON_S // 60,
                                   resolution_min=RAIN_DT_S // 60, data_mode=Tag.SYNTHETIC.value,
                                   provenance=scen.provenance)
        return scen, meta


class HistoricalReplayProvider(RainfallProvider):
    """REAL historical event replay: 26 July 2005, IMD Santacruz gauge, via the Chitale Committee report.

    Sourced from `floodnet.data.scenarios.scenarios()['july2005']` -- does not re-declare the Chitale
    Committee / Santacruz numbers, only reads them from the existing scenario object.
    """

    SCENARIO_ID = HISTORICAL_REPLAY_ID

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        from ..data.scenarios import scenarios as _scenarios
        sid = scenario_id or self.SCENARIO_ID
        if sid != self.SCENARIO_ID:
            raise KeyError(f"HistoricalReplayProvider only serves {self.SCENARIO_ID!r}, got {sid!r}")
        scen = _scenarios()[self.SCENARIO_ID]
        meta = RainfallSourceMeta(source_type="historical_replay", source_name=scen.name,
                                   timestamp="2005-07-26", forecast_horizon_min=HORIZON_S // 60,
                                   resolution_min=60, data_mode=Tag.REAL.value, provenance=scen.provenance)
        return scen, meta


class ExternalNowcastProvider(RainfallProvider):
    """Interface stub for a future live rainfall-nowcast source (e.g. IMD radar QPE/QPF, a pysteps
    extrapolation nowcast, or another NWP feed).

    NOT WIRED IN THIS PROTOTYPE -- intentionally inert; no HTTP client or external library is imported or
    referenced here. A real implementation would need to:
      - fetch a gridded or point rainfall INTENSITY time series (mm/h) covering the pilot bbox/period, at
        whatever native temporal resolution the source provides;
      - record the FETCH TIMESTAMP (when the nowcast was produced/pulled, distinct from the valid period it
        forecasts);
      - record the FORECAST HORIZON the source actually supports (nowcasts are typically short-lived, e.g.
        0-2h for radar extrapolation, vs multi-day for an NWP feed);
      - resample/regrid that into the same `RainfallScenario` shape (`t_s` seconds, `intensity_mm_h` mm/h)
        the engine already consumes, tagged with `provenance.Tag.NWP` (model output) or a REAL radar tag as
        appropriate -- never SYNTHETIC.

    Calling `.get()` raises `NotImplementedError` rather than returning fabricated numbers.
    """

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        raise NotImplementedError(
            "ExternalNowcastProvider is an interface stub: no IMD/radar/pysteps adapter is connected in this "
            "build. Wire a real implementation of RainfallProvider.get() here before use.")


def list_providers() -> dict[str, RainfallProvider]:
    """One place to ask "give me rainfall input X" without knowing which provider class backs it.

    Keyed by scenario/source id: 'moderate', 'heavy', 'cloudburst' -> the shared `ScenarioProvider`;
    'july2005' -> `HistoricalReplayProvider`; 'external_nowcast' -> the inert `ExternalNowcastProvider`.
    """
    out: dict[str, RainfallProvider] = {}
    scen_provider = ScenarioProvider()
    for sid in scen_provider.ids:
        out[sid] = scen_provider
    out[HistoricalReplayProvider.SCENARIO_ID] = HistoricalReplayProvider()
    out["external_nowcast"] = ExternalNowcastProvider()
    return out


def get_source_meta(scenario_id: str) -> Optional[RainfallSourceMeta]:
    """Convenience for API callers: `RainfallSourceMeta` for a known, currently-servable scenario id, or
    None if unrecognised (e.g. a scenario id present in a loaded pilot's scenarios.json that isn't one of
    the provider-wired ids, or the inert 'external_nowcast' stub which cannot produce a value)."""
    providers = list_providers()
    p = providers.get(scenario_id)
    if p is None or scenario_id == "external_nowcast":
        return None
    try:
        _, meta = p.get(scenario_id)
    except (KeyError, NotImplementedError):
        return None
    return meta


def provider_status() -> list[dict]:
    """Rainfall sources that are actually usable right now (excludes the inert `ExternalNowcastProvider`,
    which cannot serve a value in this build). Used by GET /api/status."""
    out = []
    for sid in list(ScenarioProvider().ids) + [HistoricalReplayProvider.SCENARIO_ID]:
        meta = get_source_meta(sid)
        if meta is None:
            continue
        out.append({"id": sid, "source_type": meta.source_type, "source_name": meta.source_name,
                     "data_mode": meta.data_mode, "timestamp": meta.timestamp,
                     "resolution_min": meta.resolution_min})
    return out
