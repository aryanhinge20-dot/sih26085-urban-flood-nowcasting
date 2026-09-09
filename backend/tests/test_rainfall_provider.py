"""Tests for floodnet.rainfall: the rainfall-source abstraction (separate from the simulation engine)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from floodnet.contracts import RainfallScenario
from floodnet.provenance import Tag
from floodnet.rainfall.provider import (
    ECMWF_ID,
    LIVE_ID,
    ECMWFForecastProvider,
    ExternalNowcastProvider,
    HistoricalReplayProvider,
    IMDObservationProvider,
    ProviderUnavailable,
    RainfallSourceMeta,
    ScenarioProvider,
    get_source_meta,
    list_providers,
    provider_status,
)


def test_scenario_provider_returns_synthetic_scenario():
    scen, meta = ScenarioProvider().get("heavy")
    assert isinstance(scen, RainfallScenario)
    assert isinstance(meta, RainfallSourceMeta)
    assert scen.id == "heavy"
    assert scen.provenance.tag == Tag.SYNTHETIC
    assert meta.source_type == "scenario"
    assert meta.data_mode == "SYNTHETIC"
    assert meta.provenance.tag == Tag.SYNTHETIC
    assert meta.timestamp == "N/A (design storm)"
    assert meta.resolution_min > 0 and meta.forecast_horizon_min > 0


def test_scenario_provider_covers_moderate_heavy_cloudburst():
    p = ScenarioProvider()
    for sid in ("moderate", "heavy", "cloudburst"):
        scen, meta = p.get(sid)
        assert scen.id == sid
        assert meta.source_type == "scenario"
        assert meta.data_mode == "SYNTHETIC"


def test_scenario_provider_unknown_id_raises():
    with pytest.raises(KeyError):
        ScenarioProvider().get("july2005")
    with pytest.raises(KeyError):
        ScenarioProvider().get("not-a-real-scenario")


def test_historical_replay_provider_returns_real_scenario():
    scen, meta = HistoricalReplayProvider().get("july2005")
    assert isinstance(scen, RainfallScenario)
    assert scen.id == "july2005"
    assert scen.provenance.tag == Tag.REAL
    assert meta.source_type == "historical_replay"
    assert meta.data_mode == "REAL"
    assert meta.provenance.tag == Tag.REAL
    assert meta.timestamp == "2005-07-26"
    assert meta.resolution_min == 60


def test_historical_replay_provider_default_id():
    scen, meta = HistoricalReplayProvider().get()
    assert scen.id == "july2005"


def test_historical_replay_provider_does_not_duplicate_scenario_numbers():
    """Its RainfallScenario must be the SAME object floodnet.data.scenarios.scenarios() produces --
    i.e. numbers are pulled, not re-declared."""
    from floodnet.data.scenarios import scenarios as _scenarios
    scen, _ = HistoricalReplayProvider().get()
    expected = _scenarios()["july2005"]
    assert scen.name == expected.name
    assert scen.description == expected.description
    assert list(scen.intensity_mm_h) == list(expected.intensity_mm_h)


def test_historical_replay_provider_wrong_id_raises():
    with pytest.raises(KeyError):
        HistoricalReplayProvider().get("heavy")


def test_external_nowcast_provider_raises_not_implemented_and_fabricates_nothing():
    prov = ExternalNowcastProvider()
    with pytest.raises(NotImplementedError):
        prov.get()
    with pytest.raises(NotImplementedError):
        prov.get(scenario_id="anything")


def test_list_providers_covers_all_wired_sources():
    providers = list_providers()
    for sid in ("moderate", "heavy", "cloudburst", "july2005", LIVE_ID, ECMWF_ID, "external_nowcast"):
        assert sid in providers
    assert isinstance(providers["external_nowcast"], ExternalNowcastProvider)
    assert isinstance(providers["july2005"], HistoricalReplayProvider)
    assert isinstance(providers["heavy"], ScenarioProvider)
    assert isinstance(providers[LIVE_ID], IMDObservationProvider)
    assert isinstance(providers[ECMWF_ID], ECMWFForecastProvider)


def test_get_source_meta():
    meta = get_source_meta("moderate")
    assert meta is not None and meta.source_type == "scenario" and meta.data_mode == "SYNTHETIC"
    meta2 = get_source_meta("july2005")
    assert meta2 is not None and meta2.source_type == "historical_replay" and meta2.data_mode == "REAL"
    assert get_source_meta("external_nowcast") is None
    assert get_source_meta("does-not-exist") is None


def test_provider_status_never_reports_external_nowcast_active():
    """No live nowcast source is connected in this prototype -- /api/status must never claim otherwise."""
    status = provider_status()
    assert len(status) >= 6   # moderate, heavy, cloudburst, july2005, live, ecmwf
    for entry in status:
        assert entry["source_type"] in ("scenario", "historical_replay", "live_observation", "ecmwf_forecast")
        assert entry["source_type"] != "external_nowcast"
    ids = {e["id"] for e in status}
    assert {"moderate", "heavy", "cloudburst", "july2005", "live", "ecmwf"} <= ids


def test_provider_status_ecmwf_needs_no_credentials():
    """Unlike 'live' (gated on IMD_API_KEY), 'ecmwf' must always report available=True -- Open-Meteo's ECMWF
    endpoint needs no key. provider_status() must not perform a real network call to determine this."""
    from floodnet.rainfall.provider import _ecmwf_provider
    _ecmwf_provider.clear_cache()
    status = {e["id"]: e for e in provider_status()}
    assert status[ECMWF_ID]["available"] is True
    assert "credentials" in status[ECMWF_ID].get("reason", "").lower()


# ---------------------------------------------------------------------- IMDObservationProvider (live)
# Real access requirements verified in docs/LIVE_RAINFALL_AUDIT.md: api.imd.gov.in requires an API key
# (empirically confirmed: an unauthenticated GET returns HTTP 401 {"error":"API key missing"}) obtained
# through a manual, non-self-service registration process. These tests never make a real network call --
# httpx.Client is monkeypatched with a fake response built from IMD's own documented field names, so they
# are fully deterministic and safe to run in normal CI with no credentials and no network access.

class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _FakeClient:
    """Stands in for `httpx.Client(...)` used as a context manager; records the call it received."""
    last_call = {}

    def __init__(self, headers=None, timeout=None):
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, params=None):
        _FakeClient.last_call = {"url": url, "params": params, "headers": self.headers}
        return _FakeClient.response


def _patch_httpx_client(monkeypatch, response):
    import httpx
    _FakeClient.response = response
    monkeypatch.setattr(httpx, "Client", _FakeClient)


def _imd_sample_row(rainfall_mm="42.5", station="Mumbai-Santacruz"):
    # Field names exactly as documented in api.imd.gov.in's api_reference.html for current_wx.
    return {"Station Id": "43003", "Station": station, "Date of Observation": "2026-09-09",
            "Time of Observation": "05:30:00", "M.S.L.P": "1008.2", "Wind Direction": "220",
            "Wind Speed": "12", "Temperature": "27.4", "Weather Code": "61", "Nebulosity": "7",
            "Humidity": "88", "Last 24 hrs Rainfall": rainfall_mm}


def test_imd_provider_unavailable_when_not_configured(monkeypatch):
    monkeypatch.delenv("IMD_API_KEY", raising=False)
    prov = IMDObservationProvider(api_key=None)
    prov._api_key = None
    with pytest.raises(ProviderUnavailable, match="not configured"):
        prov.get()
    assert prov.is_configured() is False


def test_imd_provider_parses_real_documented_field_shape(monkeypatch):
    _patch_httpx_client(monkeypatch, _FakeResponse(200, [_imd_sample_row("42.5")]))
    prov = IMDObservationProvider(station_id="43003", api_key="test-key-123")
    scen, meta = prov.get()
    assert isinstance(scen, RainfallScenario) and scen.id == LIVE_ID
    # persistence normalisation: 42.5 mm / 24 h, held flat over every 5-min step
    expected_mm_h = 42.5 / 24.0
    assert scen.intensity_mm_h == pytest.approx([expected_mm_h] * len(scen.intensity_mm_h))
    assert scen.provenance.tag == Tag.ESTIMATED     # real observation, but a stated assumption shapes the series
    assert "persistence" in scen.provenance.note.lower()
    assert "42.5" in scen.provenance.note
    assert meta.source_type == "live_observation"
    assert meta.data_mode == "ESTIMATED"
    assert "Mumbai-Santacruz" in meta.source_name


def test_imd_provider_structured_detail_and_persistence_label(monkeypatch):
    """The UI must render SOURCE/MODE/STATION/RETRIEVED/RAINFALL/FORECAST EXTENSION as distinct fields, not
    by parsing prose -- meta.detail carries exactly those, plus the exact required label text."""
    _patch_httpx_client(monkeypatch, _FakeResponse(200, [_imd_sample_row("18.4", station="Mumbai-Santacruz")]))
    scen, meta = IMDObservationProvider(api_key="k").get()
    d = meta.detail
    assert d["source"] == "IMD"
    assert d["station"] == "Mumbai-Santacruz"
    assert d["observed_rainfall_mm"] == pytest.approx(18.4)
    assert d["persistence_intensity_mm_h"] == pytest.approx(18.4 / 24.0, abs=1e-3)  # detail rounds to 3 dp
    assert d["retrieved_at"]  # non-empty ISO8601 timestamp
    # exact required label -- never "nowcast" or "forecast" standing alone
    assert d["forecast_extension_label"] == "3-HOUR PERSISTENCE ESTIMATE"
    label_lc = d["forecast_extension_label"].lower()
    assert "nowcast" not in label_lc and "radar" not in label_lc
    assert "radar" not in d["forecast_extension_note"].lower()
    assert scen.provenance.to_dict() == meta.provenance.to_dict()  # same object both places, not re-declared


def test_imd_provider_sends_the_configured_key(monkeypatch):
    _patch_httpx_client(monkeypatch, _FakeResponse(200, [_imd_sample_row()]))
    IMDObservationProvider(station_id="43003", api_key="my-secret-key").get()
    call = _FakeClient.last_call
    assert call["params"]["id"] == "43003"
    assert call["params"]["apikey"] == "my-secret-key"
    assert call["headers"]["Authorization"] == "Bearer my-secret-key"


def test_imd_provider_raises_unavailable_on_http_error(monkeypatch):
    _patch_httpx_client(monkeypatch, _FakeResponse(401, {"error": "API key missing"}))
    prov = IMDObservationProvider(api_key="wrong-or-unactivated-key")
    with pytest.raises(ProviderUnavailable):
        prov.get()


def test_imd_provider_never_leaks_the_api_key_in_a_failure_message(monkeypatch):
    """Regression test: the key is sent as a query parameter (see _fetch_current_wx's auth note), so a naive
    `str(exception)` on a failed request includes the full request URL *with the key in it*. The message
    raised to callers (and therefore returned in the HTTP 503 body) must never contain it."""
    secret = "SECRET-DO-NOT-LEAK-98765"

    class _RaisingClient(_FakeClient):
        def get(self, url, params=None):
            # simulate httpx's own exception text embedding the full URL, as it really does
            raise RuntimeError(f"Client error '401 Unauthorized' for url '{url}?apikey={params.get('apikey')}'")

    monkeypatch.setattr(__import__("httpx"), "Client", _RaisingClient)
    prov = IMDObservationProvider(api_key=secret)
    with pytest.raises(ProviderUnavailable) as exc_info:
        prov.get()
    assert secret not in str(exc_info.value)


def test_imd_provider_raises_unavailable_rather_than_guess_missing_rainfall_field(monkeypatch):
    row = _imd_sample_row(); del row["Last 24 hrs Rainfall"]
    _patch_httpx_client(monkeypatch, _FakeResponse(200, [row]))
    prov = IMDObservationProvider(api_key="test-key")
    with pytest.raises(ProviderUnavailable, match="Last 24 hrs Rainfall"):
        prov.get()


def test_imd_provider_wrong_scenario_id_raises_keyerror():
    with pytest.raises(KeyError):
        IMDObservationProvider(api_key="k").get("heavy")


def test_imd_provider_caches_within_ttl(monkeypatch):
    _patch_httpx_client(monkeypatch, _FakeResponse(200, [_imd_sample_row("10.0")]))
    prov = IMDObservationProvider(api_key="k")
    prov.get()
    calls_after_first = len(_FakeClient.last_call)  # just a presence check
    _patch_httpx_client(monkeypatch, _FakeResponse(200, [_imd_sample_row("999.0")]))  # would change the result if re-fetched
    scen2, _ = prov.get()
    assert scen2.intensity_mm_h[0] == pytest.approx(10.0 / 24.0), "cached value must be reused within TTL, not re-fetched"
    prov.clear_cache()
    scen3, _ = prov.get()
    assert scen3.intensity_mm_h[0] == pytest.approx(999.0 / 24.0), "clear_cache() must force a fresh fetch"


def test_imd_provider_never_used_for_external_nowcast_id():
    """ExternalNowcastProvider stays a separate, still-inert class -- IMDObservationProvider only ever
    serves LIVE_ID, and does not become the 'external_nowcast' entry."""
    providers = list_providers()
    assert providers[LIVE_ID] is not providers["external_nowcast"]
    assert isinstance(providers["external_nowcast"], ExternalNowcastProvider)
    assert isinstance(providers[LIVE_ID], IMDObservationProvider)


# ---------------------------------------------------------------------- ECMWFForecastProvider (via Open-Meteo)
# Documented endpoint/fields verified against https://open-meteo.com/en/docs/ecmwf-api (see
# docs/ECMWF_OPENMETEO_AUDIT.md for the full audit). These tests never make a real network call -- httpx.Client
# is monkeypatched with a fake response shaped exactly like Open-Meteo's own documented example, so they are
# fully deterministic and safe to run in normal CI with no credentials and no network access. No API key is
# needed for this provider (Open-Meteo's ECMWF endpoint is free for non-commercial use).

def _future_hourly(n: int, mm=(4.0, 6.0, 2.0), start_offset_min: int = 40):
    """n (time, mm) pairs at real, whole-hour-aligned UTC timestamps starting just under an hour from now --
    mirrors Open-Meteo's own hourly-aligned response shape without needing to monkeypatch datetime.now()."""
    base = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=start_offset_min)
    base = base.replace(minute=0) + timedelta(hours=1)  # round up to the next clean hour boundary
    times = [(base + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(n)]
    return times, list(mm[:n])


def test_ecmwf_provider_successful_response_and_extraction(monkeypatch):
    times, mm = _future_hourly(3)
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm}}))
    scen, meta = ECMWFForecastProvider(lat=19.02, lon=72.845).get()
    assert isinstance(scen, RainfallScenario) and scen.id == ECMWF_ID
    assert meta.source_type == "ecmwf_forecast"
    assert meta.data_mode == "NWP"
    assert scen.provenance.tag == Tag.NWP
    # correct precipitation extraction: each hour's mm held constant across that hour's 5-min steps
    assert scen.intensity_mm_h[0] == pytest.approx(mm[0])
    assert scen.intensity_mm_h[11] == pytest.approx(mm[0])   # last 5-min step still inside hour 0 (55 min)
    assert scen.intensity_mm_h[12] == pytest.approx(mm[1])   # first step of hour 1 (60 min)
    assert scen.intensity_mm_h[24] == pytest.approx(mm[2])   # first step of hour 2 (120 min)
    # correct timestamp handling: exactly the 3 real timestamps Open-Meteo returned, in order
    assert meta.detail["forecast_timestamps"] == times
    assert meta.detail["precipitation_mm"] == pytest.approx(mm)


def test_ecmwf_provider_provenance_and_detail_fields(monkeypatch):
    times, mm = _future_hourly(3)
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm}}))
    scen, meta = ECMWFForecastProvider(lat=19.02, lon=72.845).get()
    d = meta.detail
    assert d["source"] == "Open-Meteo"
    assert d["model"] == "ECMWF"
    assert d["data_type"] == "Numerical Weather Prediction"
    assert d["classification"] == "FORECAST"
    assert d["retrieved_at"]  # non-empty ISO8601 timestamp
    assert d["location_lonlat"] == [72.845, 19.02]
    note_lc = scen.provenance.note.lower()
    assert "forecast" in note_lc
    # The note must explicitly DISCLAIM being a nowcast/IMD product (the honesty distinction instruction 5/14
    # requires), never AFFIRM one -- so these phrases must appear only inside a "not a ..." negation.
    assert "not a radar nowcast" in note_lc
    assert "not an imd product" in note_lc
    assert "live observation" not in note_lc  # never claims to be the IMD live-observation path
    assert scen.provenance.to_dict() == meta.provenance.to_dict()  # same object both places, not re-declared


def test_ecmwf_provider_uses_pilot_bbox_centroid_by_default():
    from floodnet import config
    west, south, east, north = config.PILOT_BBOX_LONLAT
    prov = ECMWFForecastProvider()
    assert prov.lon == pytest.approx((west + east) / 2.0)
    assert prov.lat == pytest.approx((south + north) / 2.0)


def test_ecmwf_provider_sends_hourly_precipitation_request(monkeypatch):
    times, mm = _future_hourly(3)
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm}}))
    ECMWFForecastProvider(lat=19.02, lon=72.845).get()
    call = _FakeClient.last_call
    assert call["params"]["latitude"] == pytest.approx(19.02)
    assert call["params"]["longitude"] == pytest.approx(72.845)
    assert call["params"]["hourly"] == "precipitation"


def test_ecmwf_provider_missing_precipitation_raises(monkeypatch):
    times, _ = _future_hourly(3)
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times}}))
    with pytest.raises(ProviderUnavailable, match="precipitation"):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_malformed_response_raises(monkeypatch):
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"unexpected": "shape"}))
    with pytest.raises(ProviderUnavailable, match="hourly"):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_mismatched_array_lengths_raises(monkeypatch):
    times, mm = _future_hourly(3)
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm[:2]}}))
    with pytest.raises(ProviderUnavailable, match="mismatched"):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_null_precipitation_in_needed_window_raises(monkeypatch):
    times, mm = _future_hourly(3)
    mm[1] = None
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm}}))
    with pytest.raises(ProviderUnavailable, match="null"):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_insufficient_forecast_horizon_raises_not_zero_filled(monkeypatch):
    """No fake fallback: fewer than 3 real future hourly values must raise, never be zero-filled to look
    like 'no rain' for the missing hour(s)."""
    times, mm = _future_hourly(2)  # only 2 usable hours, engine window needs 3
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm}}))
    with pytest.raises(ProviderUnavailable, match="3"):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_api_failure_raises_unavailable(monkeypatch):
    class _RaisingClient(_FakeClient):
        def get(self, url, params=None):
            raise RuntimeError("connection refused")

    monkeypatch.setattr(__import__("httpx"), "Client", _RaisingClient)
    with pytest.raises(ProviderUnavailable):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_timeout_raises_unavailable(monkeypatch):
    import httpx

    class _TimeoutClient(_FakeClient):
        def get(self, url, params=None):
            raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(httpx, "Client", _TimeoutClient)
    with pytest.raises(ProviderUnavailable):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_http_error_raises_unavailable(monkeypatch):
    _patch_httpx_client(monkeypatch, _FakeResponse(500, {"error": "upstream failure"}))
    with pytest.raises(ProviderUnavailable):
        ECMWFForecastProvider().get()


def test_ecmwf_provider_wrong_scenario_id_raises_keyerror():
    with pytest.raises(KeyError):
        ECMWFForecastProvider().get("heavy")


def test_ecmwf_provider_caches_within_ttl(monkeypatch):
    times, mm = _future_hourly(3, mm=(1.0, 1.0, 1.0))
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times, "precipitation": mm}}))
    prov = ECMWFForecastProvider()
    prov.get()
    times2, mm2 = _future_hourly(3, mm=(99.0, 99.0, 99.0))  # would change the result if re-fetched
    _patch_httpx_client(monkeypatch, _FakeResponse(200, {"hourly": {"time": times2, "precipitation": mm2}}))
    scen2, _ = prov.get()
    assert scen2.intensity_mm_h[0] == pytest.approx(1.0), "cached value must be reused within TTL, not re-fetched"
    prov.clear_cache()
    scen3, _ = prov.get()
    assert scen3.intensity_mm_h[0] == pytest.approx(99.0), "clear_cache() must force a fresh fetch"


def test_ecmwf_provider_never_used_for_external_nowcast_or_live_id():
    """ECMWFForecastProvider stays a separate, distinct class -- it only ever serves ECMWF_ID, and is not
    conflated with IMDObservationProvider (LIVE_ID) or the inert ExternalNowcastProvider."""
    providers = list_providers()
    assert providers[ECMWF_ID] is not providers[LIVE_ID]
    assert providers[ECMWF_ID] is not providers["external_nowcast"]
    assert isinstance(providers[ECMWF_ID], ECMWFForecastProvider)


def test_existing_providers_unaffected_by_ecmwf_wiring():
    """Regression: adding ECMWFForecastProvider must not change behaviour of the existing providers."""
    scen, meta = ScenarioProvider().get("heavy")
    assert scen.id == "heavy" and meta.source_type == "scenario"
    scen2, meta2 = HistoricalReplayProvider().get("july2005")
    assert scen2.id == "july2005" and meta2.source_type == "historical_replay"
    with pytest.raises(NotImplementedError):
        ExternalNowcastProvider().get()
