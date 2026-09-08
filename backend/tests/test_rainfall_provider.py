"""Tests for floodnet.rainfall: the rainfall-source abstraction (separate from the simulation engine)."""
from __future__ import annotations

import pytest

from floodnet.contracts import RainfallScenario
from floodnet.provenance import Tag
from floodnet.rainfall.provider import (
    ExternalNowcastProvider,
    HistoricalReplayProvider,
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
    for sid in ("moderate", "heavy", "cloudburst", "july2005", "external_nowcast"):
        assert sid in providers
    assert isinstance(providers["external_nowcast"], ExternalNowcastProvider)
    assert isinstance(providers["july2005"], HistoricalReplayProvider)
    assert isinstance(providers["heavy"], ScenarioProvider)


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
    assert len(status) >= 4
    for entry in status:
        assert entry["source_type"] in ("scenario", "historical_replay")
        assert entry["source_type"] != "external_nowcast"
    ids = {e["id"] for e in status}
    assert {"moderate", "heavy", "cloudburst", "july2005"} <= ids
