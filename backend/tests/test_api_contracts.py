"""Tests for the newer API surface: /api/status, /api/provenance, GET /api/simulate/{run_id}, the
road-segment /explain endpoint, and error-handling regressions (clean 4xx, no raw tracebacks).

Follows the pattern in test_api_smoke.py: endpoints depending on modules from other agents may answer 503;
we then assert the message is informative and skip.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from floodnet.api.main import app
from floodnet.config import DATA_PROCESSED
from floodnet.data.load import REQUIRED

client = TestClient(app)

REAL_PILOT_BUILT = all((DATA_PROCESSED / f).exists() for f in REQUIRED)


def _skip_if_503(r):
    if r.status_code == 503:
        body = r.json()
        assert body.get("error") == "module_missing"
        assert "floodnet." in body.get("detail", ""), body
        pytest.skip(f"module missing: {body['detail'][:120]}")


def _first_scenario_id():
    r = client.get("/api/scenarios"); _skip_if_503(r)
    return r.json()[0]["id"]


# ----------------------------------------------------------------------------- /api/status, /api/provenance
def test_status():
    # /api/status itself never touches the pilot, so force it to load first (mirroring /api/health, which
    # has the same lazy-load characteristic) -- otherwise data_mode can still read "UNLOADED" if this is
    # the first request the process has served.
    m = client.get("/api/meta"); _skip_if_503(m)
    r = client.get("/api/status"); _skip_if_503(r)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["data_mode"] in ("REAL", "DEMONSTRATION")
    assert isinstance(body["runs"], list)
    providers = body["rainfall_providers"]
    assert len(providers) >= 1
    for entry in providers:
        assert {"id", "source_type", "data_mode"} <= set(entry)
        assert entry["source_type"] in ("scenario", "historical_replay")  # never "external_nowcast" (inert)


def test_provenance():
    r = client.get("/api/provenance"); _skip_if_503(r)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"terrain", "impervious", "buildings", "network", "roads", "data_mode", "attribution"} <= set(body)
    assert isinstance(body["attribution"], list) and len(body["attribution"]) > 0


# ----------------------------------------------------------------------------- GET /api/simulate/{run_id}
def test_get_simulate_valid_and_404():
    sid = _first_scenario_id()
    r = client.post("/api/simulate", json={"scenario_id": sid, "horizon_min": 15})
    _skip_if_503(r)
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]

    r2 = client.get(f"/api/simulate/{run_id}")
    assert r2.status_code == 200, r2.text
    assert r2.json()["run_id"] == run_id
    assert r2.json()["scenario_id"] == sid

    r3 = client.get("/api/simulate/does-not-exist")
    assert r3.status_code == 404
    assert "Traceback" not in r3.text


# ----------------------------------------------------------------------------- /api/scenarios additive "source"
def test_scenarios_keeps_existing_keys_and_adds_source():
    r = client.get("/api/scenarios"); _skip_if_503(r)
    assert r.status_code == 200
    sc = r.json()
    assert len(sc) > 0
    for s in sc:
        assert {"id", "name", "description", "t_min", "intensity_mm_h", "total_mm", "provenance", "source"} <= set(s)
    ids = {s["id"] for s in sc}
    for s in sc:
        if s["id"] in ("moderate", "heavy", "cloudburst"):
            assert s["source"] is not None
            assert s["source"]["source_type"] == "scenario"
            assert s["source"]["data_mode"] == "SYNTHETIC"
        if s["id"] == "july2005":
            assert s["source"]["source_type"] == "historical_replay"
            assert s["source"]["data_mode"] == "REAL"


# ----------------------------------------------------------------------------- explain endpoint
def _run_scenario(scenario_id: str, blockage=None, horizon_min: int = 60):
    r = client.post("/api/simulate", json={"scenario_id": scenario_id,
                                            "blockage": blockage or {"mode": "none"},
                                            "horizon_min": horizon_min})
    _skip_if_503(r)
    assert r.status_code == 200, r.text
    return r.json()["run_id"]


def test_explain_valid_segment():
    sid = _first_scenario_id()
    run_id = _run_scenario(sid)
    rr = client.get("/api/roads"); _skip_if_503(rr)
    feats = rr.json()["features"]
    if not feats:
        pytest.skip("no road segments in pilot bundle")
    seg_id = feats[0]["properties"]["seg_id"]

    r = client.get(f"/api/simulation/{run_id}/explain/{seg_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    expected_keys = {"run_id", "seg_id", "seg_name", "t_min", "depth_cm", "severity", "passable_car",
                      "passable_ambulance", "rainfall_mm_h", "nearest_drainage_node", "dominant_cause",
                      "terrain_context", "provenance"}
    assert expected_keys <= set(body)
    assert body["run_id"] == run_id
    assert body["seg_id"] == seg_id
    assert body["seg_name"] is not None
    assert body["t_min"] is not None
    assert body["depth_cm"] is not None
    assert body["severity"] in ("clear", "minor", "moderate", "severe", "critical")
    assert isinstance(body["passable_car"], bool)
    assert isinstance(body["passable_ambulance"], bool)
    assert body["rainfall_mm_h"] is not None
    node = body["nearest_drainage_node"]
    assert {"id", "distance_m", "surcharging", "cause", "utilization"} <= set(node)
    assert node["id"] is not None and node["distance_m"] is not None
    assert body["dominant_cause"] in ("drainage_overcapacity", "drainage_blockage",
                                       "drainage_downstream_backup", "surface_ponding_only", "unknown")
    tc = body["terrain_context"]
    assert "ground_elevation_m" in tc and "note" in tc
    assert isinstance(body["provenance"], dict) and {"roads", "network", "terrain"} <= set(body["provenance"])


def test_explain_unknown_seg_id_404():
    sid = _first_scenario_id()
    run_id = _run_scenario(sid)
    r = client.get(f"/api/simulation/{run_id}/explain/not-a-real-segment-id")
    assert r.status_code == 404
    assert "Traceback" not in r.text


def test_explain_unknown_run_id_404():
    roads = client.get("/api/roads").json()
    feats = roads.get("features") or []
    seg_id = feats[0]["properties"]["seg_id"] if feats else "whatever"
    r = client.get(f"/api/simulation/does-not-exist/explain/{seg_id}")
    assert r.status_code == 404
    assert "Traceback" not in r.text


def test_explain_negative_t_min_422():
    sid = _first_scenario_id()
    run_id = _run_scenario(sid)
    roads = client.get("/api/roads").json()["features"]
    if not roads:
        pytest.skip("no road segments in pilot bundle")
    seg_id = roads[0]["properties"]["seg_id"]
    r = client.get(f"/api/simulation/{run_id}/explain/{seg_id}", params={"t_min": -5})
    assert r.status_code == 422
    assert "Traceback" not in r.text


@pytest.mark.skipif(not REAL_PILOT_BUILT, reason="processed pilot data not built (run floodnet.data.build_pilot)")
def test_explain_dry_vs_flooded_segment_differ_sensibly():
    """Under a real pilot + the 'heavy' scenario with a severe forced blockage, a segment near a
    surcharging node should show a different (or at least not-less-severe) picture than the driest segment."""
    run_id = _run_scenario("heavy", blockage={"mode": "fraction", "fraction": 0.9}, horizon_min=180)
    series = client.get(f"/api/simulation/{run_id}/series").json()
    streets = series["streets"]
    if not streets:
        pytest.skip("no street depth series produced (street aggregation unavailable)")
    wettest_id = max(streets, key=lambda sid: max(streets[sid]))
    driest_id = min(streets, key=lambda sid: max(streets[sid]))

    wet = client.get(f"/api/simulation/{run_id}/explain/{wettest_id}").json()
    dry = client.get(f"/api/simulation/{run_id}/explain/{driest_id}").json()
    assert wet["depth_cm"] >= dry["depth_cm"]
    if max(streets[wettest_id]) > max(streets[driest_id]):
        assert wet["dominant_cause"] != "unknown" or wet["depth_cm"] > 0


# ----------------------------------------------------------------------------- invalid-request regressions
def test_unknown_scenario_id_404_regression():
    r = client.post("/api/simulate", json={"scenario_id": "not-a-real-scenario"})
    _skip_if_503(r)
    assert r.status_code == 404
    assert "Traceback" not in r.text


def test_malformed_simulate_body_422():
    r = client.post("/api/simulate", json={})  # missing required scenario_id
    assert r.status_code == 422
    assert "Traceback" not in r.text


def test_bad_vehicle_route_422():
    rr = client.get("/api/roads"); _skip_if_503(rr)
    feats = rr.json().get("features") or []
    if not feats:
        pytest.skip("no road segments in pilot bundle")
    a = feats[0]["geometry"]["coordinates"][0]
    b = feats[-1]["geometry"]["coordinates"][-1]
    r = client.post("/api/route", json={"origin": a, "dest": b, "vehicle": "not-a-real-vehicle"})
    _skip_if_503(r)
    assert r.status_code == 422, r.text
    assert "Traceback" not in r.text


def test_out_of_range_coordinates_route_422():
    r = client.post("/api/route", json={"origin": [999.0, 999.0], "dest": [72.84, 19.02], "vehicle": "car"})
    assert r.status_code == 422
    assert "Traceback" not in r.text
    r2 = client.post("/api/route", json={"origin": [72.84, 19.02], "dest": [-500.0, 12.0], "vehicle": "car"})
    assert r2.status_code == 422
    assert "Traceback" not in r2.text


def test_negative_t_min_frame_422():
    r = client.get("/api/simulation/does-not-exist/frame/-5")
    # negative t_min is checked before the run-id lookup, so this is 422 not 404
    assert r.status_code == 422
    assert "Traceback" not in r.text


def test_unknown_run_id_series_404():
    r = client.get("/api/simulation/does-not-exist/series")
    assert r.status_code == 404
    assert "Traceback" not in r.text
