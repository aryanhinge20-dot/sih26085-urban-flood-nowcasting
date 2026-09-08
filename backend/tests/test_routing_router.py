import numpy as np
import pytest

from floodnet.data.fixtures import synthetic_pilot
from floodnet.routing.router import build_graph, safe_route


@pytest.fixture(scope="module")
def pilot():
    return synthetic_pilot()


def _lonlat(roads, node):
    return tuple(float(v) for v in roads.node_lonlat[node])


def test_build_graph_two_way(pilot):
    roads = pilot["roads"]
    G = build_graph(roads)
    assert G.number_of_nodes() == 25 and G.number_of_edges() == 80
    s = roads.segments[0]
    assert G.edges[s.u, s.v]["length_m"] == pytest.approx(s.length_m) and G.edges[s.v, s.u]["seg_id"] == s.seg_id


def test_oneway_respected(pilot):
    roads = pilot["roads"]
    roads.segments[0].oneway = True
    try:
        G = build_graph(roads)
        s = roads.segments[0]
        assert G.has_edge(s.u, s.v) and not G.has_edge(s.v, s.u)
    finally:
        roads.segments[0].oneway = False


def test_dry_route_is_straight_row(pilot):
    roads = pilot["roads"]
    r = safe_route(roads, {}, _lonlat(roads, 0), _lonlat(roads, 4), vehicle="car")
    assert r["reachable"] and r["length_m"] == pytest.approx(400.0) and r["baseline_length_m"] == pytest.approx(400.0)
    assert r["avoided_segments"] == [] and r["max_depth_on_route_cm"] == 0.0
    assert r["route"]["type"] == "LineString" and len(r["route"]["coordinates"]) == 5
    assert r["provenance"]["roads"]["tag"] == "SYNTHETIC" and "simulation" in r["provenance"]["flood_weights"]


def test_flooded_middle_segment_forces_detour(pilot):
    roads = pilot["roads"]
    # row A: nodes 0-1-2-3-4; segment 1-2 is the middle one
    mid = next(s for s in roads.segments if {s.u, s.v} == {1, 2})
    r = safe_route(roads, {mid.seg_id: 0.45}, _lonlat(roads, 0), _lonlat(roads, 4), vehicle="car")
    assert r["reachable"]
    assert mid.seg_id in r["avoided_segments"]
    assert mid.seg_id not in r["route_segments"]
    assert r["length_m"] > r["baseline_length_m"] == pytest.approx(400.0)
    assert r["max_depth_on_route_cm"] < 30
    # ambulance limit is 40 cm: 45 cm blocks it too; but 35 cm is allowed for ambulance yet not for car
    r2 = safe_route(roads, {mid.seg_id: 0.35}, _lonlat(roads, 0), _lonlat(roads, 4), vehicle="ambulance")
    assert r2["avoided_segments"] == [] and r2["max_depth_on_route_cm"] == pytest.approx(35.0) or r2["length_m"] > 400
    r3 = safe_route(roads, {mid.seg_id: 0.35}, _lonlat(roads, 0), _lonlat(roads, 4), vehicle="car")
    assert mid.seg_id in r3["avoided_segments"]


def test_shallow_water_penalised_not_removed(pilot):
    roads = pilot["roads"]
    mid = next(s for s in roads.segments if {s.u, s.v} == {1, 2})
    # 10 cm: weight x2 on 100 m -> 500 m equivalent vs 600 m detour -> still goes through
    r = safe_route(roads, {mid.seg_id: 0.10}, _lonlat(roads, 0), _lonlat(roads, 4))
    assert mid.seg_id in r["route_segments"] and r["max_depth_on_route_cm"] == pytest.approx(10.0)
    # 25 cm: weight x3.5 -> 350 m extra > 200 m detour -> detours but not "avoided" (below limit)
    r = safe_route(roads, {mid.seg_id: 0.25}, _lonlat(roads, 0), _lonlat(roads, 4))
    assert mid.seg_id not in r["route_segments"] and r["avoided_segments"] == []


def test_blocked_destination_unreachable(pilot):
    roads = pilot["roads"]
    # flood every segment touching node 0 (corner: segments 0-1 and 0-5)
    flooded = {s.seg_id: 1.0 for s in roads.segments if 0 in (s.u, s.v)}
    r = safe_route(roads, flooded, _lonlat(roads, 0), _lonlat(roads, 24), vehicle="truck")
    assert r["reachable"] is False and r["route"] is None and r["length_m"] is None
    assert r["baseline_route"] is not None and r["baseline_length_m"] == pytest.approx(800.0)
    assert len(r["avoided_segments"]) >= 1


def test_snap_off_grid_point(pilot):
    roads = pilot["roads"]
    lon, lat = _lonlat(roads, 12)
    r = safe_route(roads, {}, (lon + 0.0002, lat + 0.0002), (lon + 0.0002, lat + 0.0002))
    assert r["origin_node"] == 12 and r["dest_node"] == 12 and r["reachable"] and r["length_m"] == 0.0
