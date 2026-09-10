"""Rainfall provider abstraction: separates rainfall SOURCE from the simulation.

The simulation engine (`floodnet.simulation.engine`) consumes a `RainfallScenario` (see `contracts.py`) as its
only rainfall interface and is untouched by this module. A `RainfallProvider` is simply a different way of
producing a `RainfallScenario`, plus a `RainfallSourceMeta` describing where that scenario's numbers came
from, so callers (the API layer) can ask "give me rainfall input X" without knowing whether X is a hardcoded
design storm, a replayed historical event, or (in the future) a live nowcast feed.

Six providers are wired today:
  - `ScenarioProvider`          SYNTHETIC design storms: moderate / heavy / cloudburst.
  - `HistoricalReplayProvider`  REAL, transcribed historical event: 26 July 2005 (Chitale Committee report).
  - `IMDObservationProvider`    REAL observed rainfall from the IMD API Management Platform
                                 (api.imd.gov.in), when `IMD_API_KEY` is configured -- see
                                 `docs/LIVE_RAINFALL_AUDIT.md` for the full access audit. Raises
                                 `ProviderUnavailable` (not a fabricated value) when no key is configured or
                                 the call fails.
  - `ECMWFForecastProvider`     NWP forecast (0-3h precipitation) from ECMWF via Open-Meteo
                                 (api.open-meteo.com/v1/ecmwf), used as a temporary stand-in while official
                                 IMD API access is pending -- see `docs/ECMWF_OPENMETEO_AUDIT.md`. This is a
                                 numerical-weather-prediction FORECAST, not a radar nowcast and not an IMD
                                 product; never labelled as either. Raises `ProviderUnavailable` (not a
                                 fabricated value) if the call fails or returns insufficient data.
  - `IMDRadarNowcastProvider`   DISABLED-BY-DEFAULT integration boundary for IMD Doppler Weather Radar. It is
                                 the honest place a radar feed would attach, and it is deliberately inert:
                                 `.get()` always raises `ProviderUnavailable` with an "ACCESS PENDING -- ..."
                                 reason. No radar image is fetched, no pixel is decoded, no rainfall value is
                                 invented or borrowed from another source. See decision D-14
                                 (`docs/DECISIONS.md`) and `docs/LIVE_RAINFALL_AUDIT.md` §8b/§8c.
  - `ExternalNowcastProvider`   DEPRECATED, retained only for import compatibility -- superseded by
                                 `IMDRadarNowcastProvider`. Calling `.get()` raises `NotImplementedError`.

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

from .. import config
from ..config import HORIZON_S, RAIN_DT_S
from ..contracts import RainfallScenario
from ..provenance import Provenance, Tag

log = logging.getLogger(__name__)

SCENARIO_IDS: tuple[str, ...] = ("moderate", "heavy", "cloudburst")
HISTORICAL_REPLAY_ID = "july2005"
LIVE_ID = "live"
ECMWF_ID = "ecmwf"
RADAR_ID = "imd_radar"


@dataclass(frozen=True)
class RainfallSourceMeta:
    """Metadata about WHERE a `RainfallScenario`'s numbers came from (not what they are)."""
    source_type: str            # "scenario" | "historical_replay" | "live_observation" | "ecmwf_forecast"
                                  # | "radar_nowcast" (reported by provider_status() only -- the radar
                                  # boundary never produces a scenario, so it never produces a meta either)
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
    upstream call failed, the credentials are wrong, the source is deliberately disabled, or the response
    couldn't be parsed. Distinct from `NotImplementedError` (raised by the deprecated
    `ExternalNowcastProvider`, where no adapter exists at all): this means the provider exists and is wired,
    but this particular attempt cannot legitimately produce a value. Callers must treat this as "show the
    user the source is unavailable and let them pick replay/scenario instead" -- never as a signal to
    substitute synthetic data while still claiming LIVE, and never as a signal to fall through to a
    different provider under the requested source's label."""


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

    AUTHENTICATION (resolved -- two DIFFERENT credentials, not one value sent twice)
    --------------------------------------------------------------------------------
    The IMD API Management Platform evaluates auth BEFORE routing (proven with a nonsense-path control that
    returned a byte-identical 401), and it requires BOTH headers on every request:
        X-API-Key:     <subscription key>     -> IMD_API_KEY
        Authorization: Bearer <JWT>            -> IMD_API_TOKEN   (a different value; NOT the API key)
    An earlier version of this class sent the single `IMD_API_KEY` value as both headers and additionally as
    an `apikey` query parameter, because the transmission mechanism was then unverified. That is now settled:
    the `apikey` query parameter is NOT accepted (a request carrying it and nothing else returns
    `{"error":"API key missing"}`), so it has been removed -- it could never authenticate and only risked
    leaking the key into URLs, logs and proxies. See docs/LIVE_RAINFALL_AUDIT.md.
    """

    STATION_ID_ENV = "IMD_STATION_ID"
    API_KEY_ENV = "IMD_API_KEY"                   # value of the X-API-Key header (subscription key)
    API_TOKEN_ENV = "IMD_API_TOKEN"               # value of the Authorization: Bearer header (JWT)
    API_KEY_HEADER_ENV = "IMD_API_KEY_HEADER"     # override the API-key header NAME only; default X-API-Key
    DEFAULT_STATION_ID = "43003"                  # Mumbai-Santacruz; see audit doc for how this was verified
    BASE_URL = "https://api.imd.gov.in/api/v1"
    TIMEOUT_S = 10.0
    CACHE_TTL_S = 600.0    # 10 min: IMD's own portal guidance says "use client-side caching to optimise
                            # performance during peak weather events" -- current_wx is a synoptic observation
                            # that does not change faster than this, so re-fetching more often than every
                            # ~10 min would only hammer the API without adding real information.

    def __init__(self, station_id: Optional[str] = None, api_key: Optional[str] = None,
                 api_token: Optional[str] = None):
        self.station_id = station_id or os.environ.get(self.STATION_ID_ENV, self.DEFAULT_STATION_ID)
        self._api_key = api_key  # if None, read fresh from the environment on every call (see _api_key_now)
        self._api_token = api_token
        self._cache: Optional[tuple[float, RainfallScenario, RainfallSourceMeta]] = None

    def _api_key_now(self) -> Optional[str]:
        return self._api_key if self._api_key is not None else os.environ.get(self.API_KEY_ENV)

    def _api_token_now(self) -> Optional[str]:
        return self._api_token if self._api_token is not None else os.environ.get(self.API_TOKEN_ENV)

    def is_configured(self) -> bool:
        """True when the API key is present. The JWT (`IMD_API_TOKEN`) is a SECOND, separate credential the
        platform also requires; a key-only configuration is reported as configured here (so the operator sees
        the same "not configured" message they always did when nothing is set) but the request will be
        rejected by IMD with a specific 401 that `_auth_failure_reason` turns into a precise diagnostic --
        never into a fabricated rainfall value."""
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
                f"Live access needs BOTH {self.API_KEY_ENV} (sent as X-API-Key) and {self.API_TOKEN_ENV} "
                f"(sent as Authorization: Bearer <JWT>) -- they are different credentials. "
                f"Set them in .env (see .env.example) to enable. Registration is not self-service: see "
                f"docs/LIVE_RAINFALL_AUDIT.md.")
        import time
        now = time.monotonic()
        if self._cache is not None and (now - self._cache[0]) < self.CACHE_TTL_S:
            return self._cache[1], self._cache[2]
        payload, retrieved_at = self._fetch_current_wx(key, self._api_token_now())
        scen, meta = self._normalize(payload, retrieved_at)
        self._cache = (now, scen, meta)
        return scen, meta

    def _auth_failure_reason(self, body: object) -> str:
        """Turn one of IMD's three distinct HTTP 401 bodies into a diagnostic that names the exact credential
        at fault. These bodies are precise signals -- the platform authenticates before routing, so they say
        which of the two required credentials the gateway objected to, not merely "unauthorised".

        Never includes a credential value in its output (this text reaches the HTTP client verbatim).
        """
        msg = ""
        if isinstance(body, dict):
            msg = str(body.get("error") or body.get("message") or "").strip().lower()
        elif isinstance(body, str):
            msg = body.strip().lower()
        if "api key" in msg:                       # {"error": "API key missing"}
            return (f"IMD returned 401 'API key missing': the X-API-Key header was absent or not recognised. "
                    f"Check {self.API_KEY_ENV} (this is the subscription key, not the JWT).")
        if "authorization header" in msg:          # {"error": "Authorization header missing or invalid"}
            return (f"IMD returned 401 'Authorization header missing or invalid': the "
                    f"'Authorization: Bearer <JWT>' header was absent or malformed. Set {self.API_TOKEN_ENV} "
                    f"to the JWT issued with your account -- it is a DIFFERENT value from {self.API_KEY_ENV}.")
        if "jwt" in msg or "expired" in msg:       # {"error": "Invalid or expired JWT token"}
            return (f"IMD returned 401 'Invalid or expired JWT token': the X-API-Key was accepted but "
                    f"{self.API_TOKEN_ENV} is wrong or has expired -- re-issue the token.")
        return "IMD returned HTTP 401 with an unrecognised authentication error body."

    def _fetch_current_wx(self, key: str, token: Optional[str]) -> tuple[dict, datetime]:
        import httpx
        # AUTH (resolved -- see the class docstring): the platform requires BOTH an X-API-Key header (the
        # subscription key) and an Authorization: Bearer <JWT> header, carrying DIFFERENT values. The
        # `apikey` query parameter is not accepted and is no longer sent. If the JWT is missing we still
        # make the request rather than guessing a value: IMD's own 401 body then tells the operator exactly
        # which credential is at fault (see _auth_failure_reason), which is more useful -- and more honest --
        # than a locally invented diagnosis.
        header_name = os.environ.get(self.API_KEY_HEADER_ENV, "X-API-Key")
        headers = {header_name: key}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            log.warning("%s is not set: sending %s only. IMD requires an Authorization: Bearer <JWT> header "
                        "as well and will very likely reject this request with HTTP 401.",
                        self.API_TOKEN_ENV, header_name)
        url = f"{self.BASE_URL}/current_wx"
        status_code: Optional[int] = None
        auth_reason: Optional[str] = None
        try:
            with httpx.Client(headers=headers, timeout=self.TIMEOUT_S) as client:
                r = client.get(url, params={"id": self.station_id})
                status_code = r.status_code
                if status_code == 401:
                    try:
                        auth_reason = self._auth_failure_reason(r.json())
                    except Exception:  # noqa: BLE001 -- body wasn't JSON; fall back to the generic 401 text
                        auth_reason = self._auth_failure_reason(None)
                r.raise_for_status()
                data = r.json()
        except Exception as ex:  # noqa: BLE001
            # SECURITY: never put `ex` (or the request URL) into the message that reaches the HTTP client.
            # Credentials now travel in headers only (never in the URL), but httpx exception text embeds the
            # full request URL and this defensive sanitisation is kept regardless: full detail (safe:
            # server-side only) goes to the log, only a sanitised, credential-free summary is raised.
            log.warning("IMD current_wx request failed (station %s): %s", self.station_id, ex)
            if auth_reason:
                raise ProviderUnavailable(f"{auth_reason} (station {self.station_id})") from None
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


class ECMWFForecastProvider(RainfallProvider):
    """Temporary REAL rainfall FORECAST source: ECMWF numerical weather prediction, fetched from Open-Meteo's
    free ECMWF endpoint (api.open-meteo.com/v1/ecmwf) -- used while official IMD API access (D-05,
    docs/LIVE_RAINFALL_AUDIT.md) is still pending. See `docs/ECMWF_OPENMETEO_AUDIT.md` for the full source
    audit this class implements: endpoint, exact fields, temporal resolution, and limitations.

    WHAT THIS IS, AND WHAT IT IS NOT
    ---------------------------------
    Open-Meteo's `precipitation` hourly variable is ECMWF IFS model output: "Total precipitation (rain,
    showers, snow) sum of the preceding hour" (mm) -- an NWP FORECAST, not an observation and not a radar
    nowcast. It carries no relationship to IMD; it is never labelled IMD, radar, or nowcast anywhere in this
    codebase. Tagged `Tag.NWP` (see provenance.py), a tag that already existed in this codebase specifically
    for this purpose (see `ExternalNowcastProvider`'s docstring) and was, until now, unused.

    NORMALISATION (the only transformation applied, and it is a real one, not hidden): the engine needs
    `intensity_mm_h` at RAIN_DT_S (5-min) resolution; Open-Meteo returns hourly values. Since Open-Meteo's own
    hourly figure already represents the whole hour ("sum of the preceding hour"), each real hourly value is
    held CONSTANT across that hour's 5-min steps -- the exact same convention already used by
    `floodnet.data.scenarios.scenarios()['july2005']` for the (also hourly) Chitale/Santacruz replay ("mm in
    1 h == mm/h; hourly values held constant across each hour's 5-min steps"). No value is interpolated,
    invented, or estimated between real hourly points.

    The FloodNet 0-3h engine window needs 3 consecutive future hourly values; if Open-Meteo returns fewer
    (edge-of-forecast-window, malformed response, a null in the needed hours, etc.) this raises
    `ProviderUnavailable` rather than zero-filling the missing hour(s) -- an unfilled hour would silently read
    as "no rain", which is exactly the kind of fabrication this project forbids.
    """

    BASE_URL = "https://api.open-meteo.com/v1/ecmwf"
    TIMEOUT_S = 15.0
    CACHE_TTL_S = 600.0     # 10 min courtesy TTL -- mirrors IMDObservationProvider; Open-Meteo's own model
                            # update cadence is far coarser than this, so more frequent re-fetching would
                            # only hammer their (free, no-key) endpoint without adding new information.
    FORECAST_HOURS = 4      # request one hour of buffer beyond the 3 we need, in case the first returned
                            # hourly bucket is already the (partially elapsed) current hour.
    MIN_HOURS_REQUIRED = 3  # FloodNet's engine window is HORIZON_S = 3 h; anything less is reported as
                            # unavailable, never silently zero-filled.

    def __init__(self, lat: Optional[float] = None, lon: Optional[float] = None):
        # No coordinates invented: default is the Hindmata/Dadar pilot bbox centroid, read from the single
        # source of truth for pilot geometry (config.PILOT_BBOX_LONLAT), not a re-typed literal.
        if lat is None or lon is None:
            west, south, east, north = config.PILOT_BBOX_LONLAT
            lon = lon if lon is not None else (west + east) / 2.0
            lat = lat if lat is not None else (south + north) / 2.0
        self.lat = lat
        self.lon = lon
        self._cache: Optional[tuple[float, RainfallScenario, RainfallSourceMeta]] = None

    def clear_cache(self) -> None:
        self._cache = None

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        sid = scenario_id or ECMWF_ID
        if sid != ECMWF_ID:
            raise KeyError(f"ECMWFForecastProvider only serves {ECMWF_ID!r}, got {sid!r}")
        import time
        now = time.monotonic()
        if self._cache is not None and (now - self._cache[0]) < self.CACHE_TTL_S:
            return self._cache[1], self._cache[2]
        payload, retrieved_at = self._fetch()
        scen, meta = self._normalize(payload, retrieved_at)
        self._cache = (now, scen, meta)
        return scen, meta

    def _fetch(self) -> tuple[dict, datetime]:
        import httpx
        params = {"latitude": round(self.lat, 5), "longitude": round(self.lon, 5),
                   "hourly": "precipitation", "forecast_hours": self.FORECAST_HOURS}
        try:
            with httpx.Client(timeout=self.TIMEOUT_S) as client:
                r = client.get(self.BASE_URL, params=params)
                r.raise_for_status()
                data = r.json()
        except Exception as ex:  # noqa: BLE001
            # No API key is used here (Open-Meteo's ECMWF endpoint is free for non-commercial use), so unlike
            # IMDObservationProvider there is no secret to leak -- but the message is still sanitised to a
            # short, generic summary rather than a raw exception string, for the same "never dump internals
            # to the HTTP client" discipline used everywhere else in this module.
            log.warning("Open-Meteo ECMWF request failed (lat=%s lon=%s): %s", self.lat, self.lon, ex)
            raise ProviderUnavailable(f"Open-Meteo ECMWF request failed: {type(ex).__name__}") from None
        return data, datetime.now(timezone.utc)

    def _normalize(self, payload: dict, retrieved_at: datetime) -> tuple[RainfallScenario, RainfallSourceMeta]:
        if not isinstance(payload, dict) or "hourly" not in payload:
            raise ProviderUnavailable("Open-Meteo ECMWF response did not include an 'hourly' block")
        hourly = payload["hourly"]
        if not isinstance(hourly, dict):
            raise ProviderUnavailable(f"Open-Meteo ECMWF 'hourly' block had an unexpected shape: {type(hourly).__name__}")
        times = hourly.get("time")
        precip = hourly.get("precipitation")
        if not times or not precip:
            raise ProviderUnavailable("Open-Meteo ECMWF response is missing 'time' or 'precipitation' in its hourly block")
        if len(times) != len(precip):
            raise ProviderUnavailable(
                f"Open-Meteo ECMWF 'time' ({len(times)}) and 'precipitation' ({len(precip)}) arrays have mismatched lengths")

        now_naive = retrieved_at.replace(tzinfo=None)
        parsed: list[tuple[str, datetime, object]] = []
        for t, v in zip(times, precip):
            try:
                dt = datetime.strptime(t, "%Y-%m-%dT%H:%M")
            except (TypeError, ValueError) as ex:
                raise ProviderUnavailable(f"Open-Meteo ECMWF returned an unparseable timestamp: {t!r}") from ex
            parsed.append((t, dt, v))

        future = [row for row in parsed if row[1] > now_naive]
        if not future:
            raise ProviderUnavailable("Open-Meteo ECMWF returned no forecast timestamps after the retrieval time")
        selected = future[: self.MIN_HOURS_REQUIRED]
        if len(selected) < self.MIN_HOURS_REQUIRED:
            raise ProviderUnavailable(
                f"Open-Meteo ECMWF returned only {len(selected)} usable forecast hour(s); "
                f"FloodNet's 0-3h window needs {self.MIN_HOURS_REQUIRED}")
        if any(v is None for _, _, v in selected):
            raise ProviderUnavailable("Open-Meteo ECMWF returned a null precipitation value within the needed 0-3h window")
        try:
            hourly_mm = [max(0.0, float(v)) for _, _, v in selected]
        except (TypeError, ValueError) as ex:
            raise ProviderUnavailable(f"Open-Meteo ECMWF precipitation value was not numeric: {ex}") from None

        t_s = np.arange(0, HORIZON_S + 1, RAIN_DT_S, dtype=float)
        tmin = t_s / 60.0
        intensity_mm_h = np.zeros_like(t_s)
        for h, mm in enumerate(hourly_mm):
            # mm accumulated in 1 h == mean mm/h over that hour (Open-Meteo docs: "sum of the preceding
            # hour"); held constant across the hour's 5-min steps, same convention as the july2005 replay.
            intensity_mm_h[(tmin >= 60 * h) & (tmin < 60 * (h + 1))] = mm

        timestamps = [t for t, _, _ in selected]
        hour_lines = "; ".join(f"{t} = {mm:.2f} mm" for t, mm in zip(timestamps, hourly_mm))
        note = (f"Open-Meteo ECMWF forecast API (api.open-meteo.com/v1/ecmwf), IFS 0.25 deg model, "
                f"lat={self.lat:.4f} lon={self.lon:.4f} (Hindmata/Dadar pilot bbox centroid). Retrieved "
                f"{retrieved_at.isoformat()}. Hourly precipitation (mm, sum of the preceding hour = mean "
                f"mm/h over that hour): {hour_lines}. This is a numerical-weather-prediction FORECAST, not a "
                f"radar nowcast and not an IMD product -- temporary source while IMD API access is pending, "
                f"see docs/ECMWF_OPENMETEO_AUDIT.md. Hourly values held constant across each hour's 5-min "
                f"steps (same convention as the 26 July 2005 historical replay).")
        prov = Provenance(Tag.NWP, "Open-Meteo (https://open-meteo.com), ECMWF IFS 0.25 deg forecast model", note)
        scen = RainfallScenario(id=ECMWF_ID, name="ECMWF NWP forecast (Open-Meteo)", t_s=t_s,
                                 intensity_mm_h=intensity_mm_h, provenance=prov,
                                 description="Next 3 forecast hours of ECMWF precipitation via Open-Meteo, "
                                             "hourly values held constant across 5-min steps. NWP FORECAST -- "
                                             "not a radar nowcast, not an official IMD product.")
        detail = {
            "source": "Open-Meteo", "model": "ECMWF", "data_type": "Numerical Weather Prediction",
            "classification": "FORECAST", "retrieved_at": retrieved_at.isoformat(),
            "forecast_timestamps": timestamps, "precipitation_mm": [round(mm, 3) for mm in hourly_mm],
            "location_lonlat": [round(self.lon, 5), round(self.lat, 5)],
            "location_source": "Hindmata/Dadar pilot bbox centroid (config.PILOT_BBOX_LONLAT)",
            "endpoint": self.BASE_URL,
        }
        meta = RainfallSourceMeta(source_type="ecmwf_forecast", source_name="ECMWF NWP (Open-Meteo)",
                                   timestamp=retrieved_at.isoformat(), forecast_horizon_min=HORIZON_S // 60,
                                   resolution_min=60, data_mode=Tag.NWP.value, provenance=prov, detail=detail)
        return scen, meta


class IMDRadarNowcastProvider(RainfallProvider):
    """Integration boundary for IMD Doppler Weather Radar (DWR Mumbai) -- WIRED, DOCUMENTED, AND DISABLED
    BY DEFAULT. It never produces a rainfall value; `.get()` always raises `ProviderUnavailable`.

    This class exists so that (a) radar has one honest, named place to attach if access is ever granted, and
    (b) `/api/status` can say "ACCESS PENDING" out loud instead of radar being silently absent. It fetches
    nothing: no HTTP client is imported, no image is downloaded, no pixel is decoded, no capture job exists.

    WHY IT IS DISABLED (decision D-14, docs/DECISIONS.md; evidence docs/LIVE_RAINFALL_AUDIT.md §8b/§8c)
    -----------------------------------------------------------------------------------------------------
    Two independent investigations (a specialist audit and an adversarial re-check, both against official IMD
    sources) concluded that radar is BLOCKED for defensible quantitative use:

    1. NO DOCUMENTED ENDPOINT. IMD's API reference indexes 28 APIs, but the document body ends at §20.
       "Radar Image" (`#api-25`) is a dead anchor: no URL, no parameters, no response schema is published
       anywhere. There is nothing to implement against.
    2. EXISTENCE CANNOT EVEN BE PROBED. The platform evaluates auth BEFORE routing (proven with a
       nonsense-path control returning a byte-identical 401), so without a credential one cannot tell a real
       endpoint from a typo. Auth needs two headers (X-API-Key and Authorization: Bearer <JWT>).
    3. THE PUBLIC IMAGERY IS NOT A QUANTITATIVE INPUT. `mausam.imd.gov.in/Radar/sri_mum.gif` genuinely is
       Surface Rainfall Intensity in mm/hr with its Z-R relation printed in-band (Z = 152 * R^1.5) -- but its
       top colour bin is OPEN-ENDED at ">100 mm/h", below FloodNet's own `cloudburst` (120 mm/h) and
       `july2005` (190.3 mm/h) intensities, so precisely the events this project exists to model would be
       clipped to an unknown value. Add ~+-3.33 mm/h bin quantisation, ~12.5% of the pilot footprint hidden
       under the drawn coastline, 30-40 min latency, and a rain rate inferred at 2 km altitude. Decoding a
       rendered picture is a lossy reconstruction of a visualisation, not an observation, and must never
       carry an observation-class provenance tag.
    4. NO ARCHIVE, SO NO HINDCAST. Directory listings return 403 and there are ~3 Wayback captures in six
       years; a historical radar-driven validation run is impossible from free sources.
    5. LICENCE UNRESOLVED. `copyRightPolicy.php`/`termscondition.php` 404 while `disclaimer.php` asserts IMD
       copyright with no grant; the official supply route (`radarapi.imd.gov.in`, Radar Division) requires an
       account, a written data request and payment. No harvesting has been started, deliberately.
    6. THE ENGINE COULD NOT INGEST IT ANYWAY (decision D-15). `contracts.RainfallScenario.intensity_mm_h` is
       `[T]` and `intensity_at()` returns a scalar `float`: rainfall is spatially uniform by construction for
       every provider, so a gridded radar field has nowhere to go without a contract change.

    WHAT WOULD BE REQUIRED TO ENABLE IT (all of these, not any of them)
    -------------------------------------------------------------------
    a. A written, published (or licensed) radar data endpoint from IMD with a real response schema -- product
       type, units, grid definition, timestamps -- not a rendered image.
    b. Credentials for it: `IMD_API_KEY` (X-API-Key) AND `IMD_API_TOKEN` (Bearer JWT).
    c. A resolved licence permitting programmatic retrieval and retention for this use.
    d. A `RainfallScenario` that can carry a gridded field (D-15) if the spatial resolution is to mean
       anything; until then a radar feed could only be area-averaged, which must be stated if ever done.
    e. Then, and only then: set `IMD_RADAR_ENABLED=1` and implement `_fetch()` in place of the raise below,
       tagging output `Tag.REAL` for a true QPE product or `Tag.ESTIMATED` for anything derived.

    FAILURE BEHAVIOUR: raises `ProviderUnavailable` -- the same contract the live/ECMWF providers use, which
    callers must treat as "tell the user this source is unavailable". It never falls through to another
    provider and never returns a substituted or synthesised series under a radar label.
    """

    ENABLED_ENV = "IMD_RADAR_ENABLED"
    API_KEY_ENV = IMDObservationProvider.API_KEY_ENV      # same platform credentials as the live provider
    API_TOKEN_ENV = IMDObservationProvider.API_TOKEN_ENV
    AUDIT_DOC = "docs/LIVE_RAINFALL_AUDIT.md"
    _TRUTHY = ("1", "true", "yes", "on", "enabled")

    # The single sentence a status consumer sees. Deliberately leads with ACCESS PENDING and points at the
    # evidence, so an operator can check the claim rather than take this class's word for it.
    STATUS_REASON = (
        "ACCESS PENDING -- IMD Doppler Weather Radar is not connected and is disabled by default "
        "(IMD_RADAR_ENABLED unset). IMD publishes no documented radar data endpoint (the API reference's "
        "'Radar Image' entry is a dead anchor; the document body ends at section 20), and the public radar "
        "imagery is a rendered picture whose top intensity bin is open-ended at >100 mm/h -- below this "
        "project's own cloudburst (120 mm/h) and 2005 (190.3 mm/h) intensities -- so it is not usable as a "
        "quantitative input. No radar value is estimated, decoded or substituted from another source. "
        "Evidence: docs/LIVE_RAINFALL_AUDIT.md sections 8b/8c; decision D-14 in docs/DECISIONS.md.")

    def is_enabled(self) -> bool:
        """True only if an operator has explicitly set the enable flag. Default (unset) is False: this
        provider cannot activate by accident, e.g. because IMD credentials happened to be configured for the
        separate `live` observation path."""
        return os.environ.get(self.ENABLED_ENV, "").strip().lower() in self._TRUTHY

    def is_configured(self) -> bool:
        """Both platform credentials present. Note this is NOT sufficient to enable the provider -- the
        explicit flag is required as well (see `is_enabled`)."""
        return bool(os.environ.get(self.API_KEY_ENV)) and bool(os.environ.get(self.API_TOKEN_ENV))

    def unavailable_reason(self) -> str:
        """The exact reason string reported by `provider_status()` and raised by `.get()`."""
        if not self.is_enabled():
            return self.STATUS_REASON
        # Flag set: report what is still missing, and still refuse -- setting a flag cannot conjure an
        # endpoint that IMD does not publish.
        missing = []
        if not os.environ.get(self.API_KEY_ENV):
            missing.append(self.API_KEY_ENV)
        if not os.environ.get(self.API_TOKEN_ENV):
            missing.append(self.API_TOKEN_ENV)
        creds = f" Missing credentials: {', '.join(missing)}." if missing else ""
        return (f"ACCESS PENDING -- {self.ENABLED_ENV} is set, but no radar adapter is implemented and none "
                f"can be: IMD publishes no documented radar data endpoint to call, and the public radar "
                f"imagery is a rendered picture, not a quantitative rainfall field (see {self.AUDIT_DOC} "
                f"sections 8b/8c, decision D-14).{creds} Nothing is fabricated or substituted; implement "
                f"_fetch() only once a real, licensed, documented endpoint exists.")

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        sid = scenario_id or RADAR_ID
        if sid != RADAR_ID:
            raise KeyError(f"IMDRadarNowcastProvider only serves {RADAR_ID!r}, got {sid!r}")
        # Always. There is no code path in this class that returns a RainfallScenario, by design.
        raise ProviderUnavailable(self.unavailable_reason())


class ExternalNowcastProvider(RainfallProvider):
    """DEPRECATED -- superseded by `IMDRadarNowcastProvider`, which names the actual source, documents why it
    is off, and reports itself honestly through `provider_status()`.

    Kept only so existing imports (`floodnet.rainfall.__init__`, tests) keep working; still fully inert. Do
    not wire anything new to this class -- a new source deserves its own named provider, as
    `IMDRadarNowcastProvider` and `ECMWFForecastProvider` are.

    Calling `.get()` raises `NotImplementedError` rather than returning fabricated numbers.
    """

    def get(self, scenario_id: Optional[str] = None, **kwargs) -> tuple[RainfallScenario, RainfallSourceMeta]:
        raise NotImplementedError(
            "ExternalNowcastProvider is a deprecated, inert interface stub (see IMDRadarNowcastProvider for "
            "the radar integration boundary). No adapter is connected in this build.")


# Module-level singletons: both caching providers keep their last successful fetch internally (see
# CACHE_TTL_S) so repeated status checks / run requests within one process don't re-hit their upstream API
# needlessly. list_providers() must always return these SAME instances, not fresh ones, or the cache would
# never persist across calls.
_imd_live_provider = IMDObservationProvider()
_ecmwf_provider = ECMWFForecastProvider()
# Stateless (it fetches nothing and caches nothing), but shared for the same reason: one object identity for
# the radar boundary everywhere it is reported.
_imd_radar_provider = IMDRadarNowcastProvider()


def list_providers() -> dict[str, RainfallProvider]:
    """One place to ask "give me rainfall input X" without knowing which provider class backs it.

    Keyed by scenario/source id: 'moderate', 'heavy', 'cloudburst' -> the shared `ScenarioProvider`;
    'july2005' -> `HistoricalReplayProvider`; 'live' -> the shared `IMDObservationProvider` (may raise
    `ProviderUnavailable` if `IMD_API_KEY` isn't configured -- that is expected, not an error to hide);
    'ecmwf' -> the shared `ECMWFForecastProvider` (temporary NWP forecast source, may raise
    `ProviderUnavailable` if Open-Meteo is unreachable or returns insufficient data);
    'imd_radar' -> the shared `IMDRadarNowcastProvider` (disabled-by-default integration boundary; ALWAYS
    raises `ProviderUnavailable` with an "ACCESS PENDING" reason -- that is its designed behaviour, not a
    failure, and it must never be swapped for another provider when it raises);
    'external_nowcast' -> the deprecated, inert `ExternalNowcastProvider`.
    """
    out: dict[str, RainfallProvider] = {}
    scen_provider = ScenarioProvider()
    for sid in scen_provider.ids:
        out[sid] = scen_provider
    out[HistoricalReplayProvider.SCENARIO_ID] = HistoricalReplayProvider()
    out[LIVE_ID] = _imd_live_provider
    out[ECMWF_ID] = _ecmwf_provider
    out[RADAR_ID] = _imd_radar_provider
    out["external_nowcast"] = ExternalNowcastProvider()
    return out


def get_source_meta(scenario_id: str) -> Optional[RainfallSourceMeta]:
    """Convenience for API callers: `RainfallSourceMeta` for a known, currently-servable scenario id, or
    None if unrecognised or unavailable (e.g. a scenario id present in a loaded pilot's scenarios.json that
    isn't one of the provider-wired ids, the inert 'external_nowcast' stub, the always-unavailable
    'imd_radar' boundary, or 'live' when IMD_API_KEY isn't configured / the request failed). Use
    `provider_status()` instead of this function when you need to
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
    """Rainfall sources worth showing to a caller (excludes the deprecated `ExternalNowcastProvider`, which
    names no source and can never work in this build under any configuration; the radar boundary IS listed,
    permanently unavailable, because "radar is pending" is information an operator needs). Used by
    GET /api/status.

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

    ecmwf_row: dict = {"id": ECMWF_ID, "source_type": "ecmwf_forecast", "source_name": "ECMWF NWP (Open-Meteo)",
                        "data_mode": None, "timestamp": None, "resolution_min": None}
    if _ecmwf_provider._cache is not None:  # a cached successful fetch exists -- report it, no new call
        _, _, meta = _ecmwf_provider._cache
        ecmwf_row.update(available=True, source_name=meta.source_name, data_mode=meta.data_mode,
                          timestamp=meta.timestamp, resolution_min=meta.resolution_min)
    else:
        # Unlike IMD, ECMWF via Open-Meteo needs no credentials -- "available" reflects that a fetch is
        # possible on demand, not that one has already succeeded this process.
        ecmwf_row.update(available=True, reason="no credentials required; fetched on demand")
    out.append(ecmwf_row)

    # IMD radar: listed so the honest answer to "where is radar?" is visible in the API rather than absent,
    # and permanently available=False. `unavailable_reason()` is a pure string computation -- no network
    # call, no credential use -- so a routinely-polled status endpoint stays cheap. This row is never
    # available=True in this build: see IMDRadarNowcastProvider's docstring and decision D-14.
    out.append({"id": RADAR_ID, "source_type": "radar_nowcast",
                "source_name": "IMD Doppler Weather Radar (integration boundary -- not connected)",
                "data_mode": None, "timestamp": None, "resolution_min": None,
                "available": False, "reason": _imd_radar_provider.unavailable_reason(),
                "enabled": _imd_radar_provider.is_enabled()})
    return out
