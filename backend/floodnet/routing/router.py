"""Flood-aware routing on the RoadGraph.

Edge weight = length_m * (1 + penalty_per_cm * depth_cm); edges whose depth >= VEHICLE_LIMIT_CM[vehicle] are removed.
A flood-agnostic `baseline` route is always computed for comparison.
"""
from __future__ import annotations

import numpy as np
import networkx as nx

from ..contracts import RoadGraph
from ..config import CRS_COMPUTE, CRS_GEO, VEHICLE_LIMIT_CM

DEFAULT_PENALTY_PER_CM = 0.1


def build_graph(roads: RoadGraph) -> nx.DiGraph:
    """Directed graph; two-way segments get both directions. Edge attrs: length_m, seg_id, reversed."""
    G = nx.DiGraph()
    for k, (x, y) in enumerate(np.asarray(roads.node_xy)):
        G.add_node(k, x=float(x), y=float(y))
    for seg in roads.segments:
        G.add_edge(seg.u, seg.v, length_m=float(seg.length_m), seg_id=seg.seg_id, reversed=False)
        if not seg.oneway:
            G.add_edge(seg.v, seg.u, length_m=float(seg.length_m), seg_id=seg.seg_id, reversed=True)
    return G


def _snap(roads: RoadGraph, lonlat_points: list[tuple[float, float]]) -> list[int]:
    from pyproj import Transformer
    from scipy.spatial import cKDTree
    fwd = Transformer.from_crs(CRS_GEO, CRS_COMPUTE, always_xy=True)
    pts = np.asarray(lonlat_points, dtype=float)
    x, y = fwd.transform(pts[:, 0], pts[:, 1])
    _, idx = cKDTree(np.asarray(roads.node_xy, dtype=float)).query(np.column_stack([x, y]))
    return [int(i) for i in np.atleast_1d(idx)]


def _path_geometry(roads: RoadGraph, G: nx.DiGraph, path: list[int]) -> tuple[dict, float, list[str]]:
    seg_by_id = {s.seg_id: s for s in roads.segments}
    coords: list[list[float]] = []
    length = 0.0
    seg_ids: list[str] = []
    for a, b in zip(path[:-1], path[1:]):
        e = G.edges[a, b]
        seg = seg_by_id[e["seg_id"]]
        ll = np.asarray(seg.lonlat, dtype=float)
        if e["reversed"]:
            ll = ll[::-1]
        pts = ll.round(7).tolist()
        if coords and coords[-1] == pts[0]:
            pts = pts[1:]
        coords.extend(pts)
        length += float(seg.length_m)
        seg_ids.append(seg.seg_id)
    if len(path) == 1:
        p = np.asarray(roads.node_lonlat[path[0]], dtype=float).round(7).tolist()
        coords = [p, p]
    return {"type": "LineString", "coordinates": coords}, length, seg_ids


def safe_route(roads: RoadGraph, street_depth_m: dict[str, float], origin_lonlat, dest_lonlat,
               vehicle: str = "car", penalty_per_cm: float | None = None) -> dict:
    if vehicle not in VEHICLE_LIMIT_CM:
        raise KeyError(f"unknown vehicle '{vehicle}'; known: {sorted(VEHICLE_LIMIT_CM)}")
    limit = VEHICLE_LIMIT_CM[vehicle]
    penalty = DEFAULT_PENALTY_PER_CM if penalty_per_cm is None else float(penalty_per_cm)
    G = build_graph(roads)
    o, d = _snap(roads, [tuple(origin_lonlat), tuple(dest_lonlat)])

    # baseline: shortest by length, flood ignored
    try:
        base_path = nx.shortest_path(G, o, d, weight="length_m")
    except nx.NetworkXNoPath:
        base_path = None
    base_geom, base_len, base_segs = (_path_geometry(roads, G, base_path) if base_path else (None, None, []))

    # flood-aware graph
    H = nx.DiGraph(); H.add_nodes_from(G.nodes(data=True))
    depth_cm_of: dict[str, float] = {}
    for a, b, e in G.edges(data=True):
        d_cm = float(street_depth_m.get(e["seg_id"], 0.0)) * 100.0
        depth_cm_of[e["seg_id"]] = d_cm
        if d_cm >= limit:
            continue
        H.add_edge(a, b, weight=e["length_m"] * (1.0 + penalty * d_cm), **e)
    try:
        path = nx.shortest_path(H, o, d, weight="weight")
        reachable = True
    except nx.NetworkXNoPath:
        path, reachable = None, False

    if path:
        geom, length, segs = _path_geometry(roads, H, path)
        max_depth = max([depth_cm_of.get(s, 0.0) for s in segs], default=0.0)
    else:
        geom, length, segs, max_depth = None, None, [], None

    avoided = [s for s in base_segs if depth_cm_of.get(s, 0.0) >= limit]
    return {"route": geom, "length_m": length, "max_depth_on_route_cm": max_depth, "route_segments": segs,
            "avoided_segments": avoided, "baseline_route": base_geom, "baseline_length_m": base_len,
            "reachable": reachable, "vehicle": vehicle, "vehicle_limit_cm": limit,
            "origin_node": o, "dest_node": d,
            "provenance": {"roads": roads.provenance.to_dict(), "flood_weights": "derived from simulation frame"}}
