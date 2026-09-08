"""Rainfall provider abstraction: separates rainfall SOURCE from the simulation.

The simulation engine (`floodnet.simulation.engine`) consumes a `RainfallScenario` (see `contracts.py`) as its
only rainfall interface and is untouched by this module. A `RainfallProvider` is simply a different way of
producing a `RainfallScenario`, plus a `RainfallSourceMeta` describing where that scenario's numbers came
from, so callers (the API layer) can ask "give me rainfall input X" without knowing whether X is a hardcoded
design storm, a replayed historical event, or (in the future) a live nowcast feed.

Four providers are wired today:
  - `ScenarioProvider`          SYNTHETIC design storms: moderate / heavy / cloudburst.
  - `HistoricalReplayProvider`  REAL, transcribed historical event: 26 July 2005 (Chitale Committee report).
  - `IMDObservationProvider`    REAL observed rainfall from the IMD API Management Platform
                                 (api.imd.gov.in), when `IMD_API_KEY` is configured -- see
                                 `docs/LIVE_RAINFALL_AUDIT.md` for the full access audit. Raises
                                 `ProviderUnavailable` (not a fabricated value) when no key is configured or
                                 the call fails.
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

import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from ..config import HORIZON_S, RAIN_DT_S
from ..contracts import RainfallScenario
from ..provenance import Provenance, Tag

log = logging.getLogger(__name__)

SCENARIO_IDS: tuple[str, ...] = ("moderate", "heavy", "cloudburst")
HISTORICAL_REPLAY_ID = "july2005"
LIVE_ID = "live"


@dataclass(frozen=True)
class RainfallSourceMeta:
    """Metadata about WHERE a `RainfallScenario`'s numbers came from (not what they are)."""
    source_type: str            # "scenario" | "historical_replay" | "live_observation" | "external_nowcast"
    source_name: str
    timestamp: str               # ISO8601 fetch/production time; "N/A (design storm)" for synthetic scenarios,
                                  # or the real historical event date for a replay
    forecast_horizon_min: int
    resolution_min: int          # temporal resolution of the underlying source series (minutes)
    data_mode: str                # "SYNTHETIC" | "REAL" | "DEMONSTRATION" | "NWP" (matches provenance.Tag)
    provenance: Provenance
    # Small structured extras a UI can render as distinct labelled fields without parsing prose out of
    # `provenance.note`. Empty for scenario/replay (their note text is already a complete, short story);
    # populated by IMDObservationProvider with exactly the fields a "live" run needs to show honestly:
    # station, the raw observed value, when it was observed, the derived persistence rate, and an explicit
    # "forecast_extension" label the UI must show verbatim (never call it a nowcast/forecast on its own).
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"source_type": self.source_type, "source_name": self.source_name, "timestamp": self.timestamp,
                "forecast_horizon_min": self.forecast_horizon_min, "resolution_min": self.resolution_min,
                "data_mode": self.data_mode, "provenance": self.provenance.to_dict(), "detail": self.detail}


class ProviderUnavailable(RuntimeError):
    """Raised by a REAL (non-stub) provider that cannot serve a value right now -- missing credentials, the
    upstream call failed, or the response couldn't be parsed. Distinct from `NotImplementedError` (raised by
    `ExternalNowcastProvider`, where no adapter exists at all): this means a working adapter exists but this
    particular attempt did not succeed. Callers must treat this as "show the user the source is unavailable
    and let them pick replay/scenario instead" -- never as a signal to substitute synthetic data while still
    claiming LIVE."""


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


class IMDObservationProvider(RainfallProvider):
    """REAL, currently-observed rainfall from the IMD API Management Platform (api.imd.gov.in), used to
    drive a "LIVE" run -- see `docs/LIVE_RAINFALL_AUDIT.md` for the full source audit this class implements.

    WHAT THIS ACTUALLY GETS, and why it cannot be a true radar/NWP nowcast
    ------------------------------------------------------------------------
    The audit found no IMD API product that returns a quantitative rainfall INTENSITY time series at the
    engine's native 5-min resolution. The best real, quantitative, station-specific value documented is the
    `current_wx` endpoint's "Last 24 hrs Rainfall" (mm) -- a single cumulative total for the last 24 hours at
    one station, current as of its last observation time. `district_nowcast`/`station_nowcast` exist but are
    CATEGORICAL warning bands (e.g. "Cat12: Heavy rain: > 15 mm/hr"), not a numeric mm/h value -- using them
    to synthesise a quantitative hyetograph would be exactly the kind of silent fabrication this project
    forbids, so this class does not use them.

    NORMALISATION (the only transformation applied, and it is a real one, not hidden):
    the observed 24h total is divided by 24 to get a mean mm/h rate, then held CONSTANT (a "persistence"
    assumption -- the simplest, most conservative real nowcasting baseline, not a radar extrapolation) across
    every 5-min step of the 3h forecast window. This is why the resulting `RainfallScenario` is tagged
    `Tag.ESTIMATED`, not `Tag.REAL`: the OBSERVATION is real, the 3h SHAPE is a stated, simple assumption
    layered on top of it -- exactly the same "REAL input + stated derivation rule = ESTIMATED" pattern
    already used elsewhere in this codebase (e.g. Manning's n, node inverts).
    """

    STATION_ID_ENV = "IMD_STATION_ID"
    API_KEY_ENV = "IMD_API_KEY"
    API_KEY_HEADER_ENV = "IMD_API_KEY_HEADER"     # see note below -- transmission mechanism unverified
    DEFAULT_STATION_ID = "43003"                  # Mumbai-Santacruz; see audit doc for how this was verified
    BASE_URL = "https://api.imd.gov.in/api/v1"
    TIMEOUT_S = 10.0
    CACHE_TTL_S = 600.0    # 10 min: IMD's own portal guidance says "use client-side caching to optimise
                            # performance during peak weather events" -- current_wx is a synoptic observation
                            # that does not change faster than this, so re-fetching more often than every
                            # ~10 min would only hammer the API without adding real information.

    def __init__(self, station_id: Optional[str] = None, api_key: Optional[str] = None):
        self.station_id = station_id or os.environ.get(self.STATION_ID_ENV, self.DEFAULT_STATION_ID)
        self._api_key = api_key  # if None, read fresh from the environment on every call (see _api_key_now)
        self._cache: Optional[tuple[float, RainfallScenario, RainfallSourceMeta]] = None

    def _api_key_now(self) -> Optional[str]:
        return self._api_key if self._api_key is not None else os.environ.get(self.API_KEY_ENV)

    def is_configured(self) -> bool:
        return bool(self._api_key_now())

    def clear_cache(self) -> None:
        self._cache = None

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        sid = scenario_id or LIVE_ID
        if sid != LIVE_ID:
            raise KeyError(f"IMDObservationProvider only serves {LIVE_ID!r}, got {sid!r}")
        key = self._api_key_now()
        if not key:
            raise ProviderUnavailable(
                f"{self.API_KEY_ENV} is not configured -- live IMD data is disabled, not faked. "
                f"Set it in .env (see .env.example) to enable. Registration is not self-service: see "
                f"docs/LIVE_RAINFALL_AUDIT.md.")
        import time
        now = time.monotonic()
        if self._cache is not None and (now - self._cache[0]) < self.CACHE_TTL_S:
            return self._cache[1], self._cache[2]
        payload, retrieved_at = self._fetch_current_wx(key)
        scen, meta = self._normalize(payload, retrieved_at)
        self._cache = (now, scen, meta)
        return scen, meta

    def _fetch_current_wx(self, key: str) -> tuple[dict, datetime]:
        import httpx
        # NOTE ON AUTH: IMD's published materials (api_reference.html, apis.php, the API_doc.pdf) confirm a
        # key is required (empirically: a real unauthenticated call to this exact endpoint returns HTTP 401
        # {"error":"API key missing"}) but do not document HOW the key is transmitted (header vs query
        # param). We send it both ways -- an `Authorization: Bearer` header, a custom header (name
        # configurable via IMD_API_KEY_HEADER, default X-API-Key), AND an `apikey` query parameter -- so
        # whichever convention IMD actually uses will pick it up; harmless if the others are ignored. This
        # is the one genuinely unverified detail in this integration (see the audit doc) and should be
        # confirmed against IMD's real onboarding documentation once a key is issued.
        header_name = os.environ.get(self.API_KEY_HEADER_ENV, "X-API-Key")
        headers = {"Authorization": f"Bearer {key}", header_name: key}
        url = f"{self.BASE_URL}/current_wx"
        status_code: Optional[int] = None
        try:
            with httpx.Client(headers=headers, timeout=self.TIMEOUT_S) as client:
                r = client.get(url, params={"id": self.station_id, "apikey": key})
                status_code = r.status_code
                r.raise_for_status()
                data = r.json()
        except Exception as ex:  # noqa: BLE001
            # SECURITY: never put `ex` (or the request URL) into the message that reaches the HTTP client --
            # the key is sent as a query parameter (see note above), so httpx's own exception text for a
            # failed request includes the full URL *with the key in it*. Full detail (safe: server-side only)
            # goes to the log; only a sanitised, key-free summary is raised/returned to callers.
            log.warning("IMD current_wx request failed (station %s): %s", self.station_id, ex)
            reason = f"HTTP {status_code}" if status_code else type(ex).__name__
            raise ProviderUnavailable(f"IMD current_wx request failed (station {self.station_id}): {reason}") from None
        return data, datetime.now(timezone.utc)

    def _normalize(self, payload: dict, retrieved_at: datetime) -> tuple[RainfallScenario, RainfallSourceMeta]:
        # Response is a list with one object per IMD's documented sample shape, or a single object -- accept
        # either rather than assuming, but never guess a rainfall number if the field is genuinely absent.
        row = payload[0] if isinstance(payload, list) and payload else payload
        if not isinstance(row, dict):
            raise ProviderUnavailable(f"IMD current_wx returned an unexpected shape: {type(payload).__name__}")
        raw = row.get("Last 24 hrs Rainfall")
        if raw is None:
            raise ProviderUnavailable("IMD current_wx response did not include a 'Last 24 hrs Rainfall' field")
        try:
            total_24h_mm = float(raw)
        except (TypeError, ValueError) as ex:
            raise ProviderUnavailable(f"IMD current_wx 'Last 24 hrs Rainfall' was not numeric: {raw!r}") from ex

        station_name = row.get("Station") or f"station {self.station_id}"
        obs_time = f"{row.get('Date of Observation', '')} {row.get('Time of Observation', '')}".strip()

        mean_mm_h = max(0.0, total_24h_mm) / 24.0
        t_s = np.arange(0, HORIZON_S + 1, RAIN_DT_S, dtype=float)
        intensity_mm_h = np.full_like(t_s, mean_mm_h)

        note = (f"IMD current_wx, station {station_name} (id {self.station_id}): observed 24h cumulative "
                f"rainfall = {total_24h_mm:.1f} mm as of {obs_time or 'unknown time'} (station-local). "
                f"Forecast intensity is a PERSISTENCE assumption: {total_24h_mm:.1f} mm / 24h = "
                f"{mean_mm_h:.2f} mm/h, held constant for the 3h forecast window -- this is NOT a radar or "
                f"NWP nowcast; IMD publishes no quantitative sub-hourly nowcast product via this API (see "
                f"docs/LIVE_RAINFALL_AUDIT.md). District/station-level input only, applied uniformly over "
                f"the Hindmata/Dadar pilot grid.")
        prov = Provenance(Tag.ESTIMATED, "IMD API Management Platform (api.imd.gov.in), current_wx endpoint", note)
        scen = RainfallScenario(id=LIVE_ID, name=f"Live (IMD-observed, {station_name})", t_s=t_s,
                                 intensity_mm_h=intensity_mm_h, provenance=prov,
                                 description="Persistence forecast from IMD's live 24h observed rainfall total; "
                                             "see provenance note for the exact figures and the assumption used.")
        detail = {
            "source": "IMD", "station": station_name, "station_id": self.station_id,
            "retrieved_at": retrieved_at.isoformat(),
            "observed_at": obs_time or None,
            "observation_type": "24h cumulative rainfall (observed)",
            "observed_rainfall_mm": round(total_24h_mm, 2),
            "persistence_intensity_mm_h": round(mean_mm_h, 3),
            # Exact label the UI must display verbatim -- NEVER "nowcast"/"forecast"/"radar" on their own.
            "forecast_extension_label": "3-HOUR PERSISTENCE ESTIMATE",
            "forecast_extension_note": ("Not an official IMD nowcast or forecast -- a simple persistence "
                                        "assumption (last observed rate held constant) applied by FloodNet, "
                                        "documented in docs/LIVE_RAINFALL_AUDIT.md."),
        }
        meta = RainfallSourceMeta(source_type="live_observation", source_name=f"IMD {station_name}",
                                   timestamp=retrieved_at.isoformat(), forecast_horizon_min=HORIZON_S // 60,
                                   resolution_min=24 * 60, data_mode=Tag.ESTIMATED.value, provenance=prov,
                                   detail=detail)
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


# Module-level singleton: IMDObservationProvider caches its last successful fetch internally (see
# CACHE_TTL_S) so repeated status checks / live-run requests within one process don't re-hit the IMD API
# needlessly. list_providers() must always return this SAME instance for 'live', not a fresh one, or the
# cache would never persist across calls.
_imd_live_provider = IMDObservationProvider()


def list_providers() -> dict[str, RainfallProvider]:
    """One place to ask "give me rainfall input X" without knowing which provider class backs it.

    Keyed by scenario/source id: 'moderate', 'heavy', 'cloudburst' -> the shared `ScenarioProvider`;
    'july2005' -> `HistoricalReplayProvider`; 'live' -> the shared `IMDObservationProvider` (may raise
    `ProviderUnavailable` if `IMD_API_KEY` isn't configured -- that is expected, not an error to hide);
    'external_nowcast' -> the inert `ExternalNowcastProvider`.
    """
    out: dict[str, RainfallProvider] = {}
    scen_provider = ScenarioProvider()
    for sid in scen_provider.ids:
        out[sid] = scen_provider
    out[HistoricalReplayProvider.SCENARIO_ID] = HistoricalReplayProvider()
    out[LIVE_ID] = _imd_live_provider
    out["external_nowcast"] = ExternalNowcastProvider()
    return out


def get_source_meta(scenario_id: str) -> Optional[RainfallSourceMeta]:
    """Convenience for API callers: `RainfallSourceMeta` for a known, currently-servable scenario id, or
    None if unrecognised or unavailable (e.g. a scenario id present in a loaded pilot's scenarios.json that
    isn't one of the provider-wired ids, the inert 'external_nowcast' stub, or 'live' when IMD_API_KEY isn't
    configured / the request failed). Use `provider_status()` instead of this function when you need to
    distinguish "unavailable" from "doesn't exist" (e.g. to show *why* LIVE isn't offered right now)."""
    providers = list_providers()
    p = providers.get(scenario_id)
    if p is None or scenario_id == "external_nowcast":
        return None
    try:
        _, meta = p.get(scenario_id)
    except (KeyError, NotImplementedError, ProviderUnavailable):
        return None
    return meta


def provider_status() -> list[dict]:
    """Rainfall sources worth showing to a caller (excludes the fully inert `ExternalNowcastProvider`, which
    can never work in this build under any configuration). Used by GET /api/status.

    Unlike `get_source_meta`, this does NOT call `IMDObservationProvider.get()` (which performs a real
    network request) -- a status endpoint that's polled routinely must stay cheap. It reports whether the
    live provider is *configured* (no network call) and, if a cached fetch already succeeded, includes that
    cached metadata; it never blocks a status check on IMD's network being reachable.
    """
    out = []
    for sid in list(ScenarioProvider().ids) + [HistoricalReplayProvider.SCENARIO_ID]:
        meta = get_source_meta(sid)
        if meta is None:
            continue
        out.append({"id": sid, "source_type": meta.source_type, "source_name": meta.source_name,
                     "data_mode": meta.data_mode, "timestamp": meta.timestamp,
                     "resolution_min": meta.resolution_min, "available": True})

    live_row: dict = {"id": LIVE_ID, "source_type": "live_observation", "source_name": "IMD (live observation)",
                       "data_mode": None, "timestamp": None, "resolution_min": None}
    if not _imd_live_provider.is_configured():
        live_row.update(available=False, reason=f"{IMDObservationProvider.API_KEY_ENV} not configured")
    elif _imd_live_provider._cache is not None:  # a cached successful fetch exists -- report it, no new call
        _, scen, meta = _imd_live_provider._cache
        live_row.update(available=True, source_name=meta.source_name, data_mode=meta.data_mode,
                         timestamp=meta.timestamp, resolution_min=meta.resolution_min)
    else:
        live_row.update(available=True, reason="configured, not yet fetched this process")
    out.append(live_row)
    return out
