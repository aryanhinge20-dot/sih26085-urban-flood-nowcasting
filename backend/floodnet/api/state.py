"""Process-wide state for the API: loaded pilot (REAL or DEMONSTRATION fallback), run cache, CRS helpers.

All sibling packages (data, terrain, drainage, streets, routing) are imported LAZILY so the server always starts;
callers turn `ModuleMissing` into HTTP 503 with an informative message.
"""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from typing import Any, Optional

import numpy as np
from pyproj import Transformer

from .. import config
from ..contracts import SimulationResult, Grid

log = logging.getLogger("floodnet.api")

MAX_RUNS = 6
ATTRIBUTION = ["© OpenStreetMap contributors (ODbL)",
               "MCGM GIS (Storm Water Drains, Manholes, Contours, Flooding Spots)"]


class ModuleMissing(RuntimeError):
    """A sibling module written by another agent is not available yet (-> HTTP 503)."""


# ----------------------------------------------------------------------------- CRS helpers
_to_geo = Transformer.from_crs(config.CRS_COMPUTE, config.CRS_GEO, always_xy=True)
_to_utm = Transformer.from_crs(config.CRS_GEO, config.CRS_COMPUTE, always_xy=True)


def xy_to_lonlat(x, y):
    return _to_geo.transform(x, y)


def lonlat_to_xy(lon, lat):
    return _to_utm.transform(lon, lat)


def grid_bbox_lonlat(grid: Grid) -> list[float]:
    xs = [grid.x0, grid.x0 + grid.nx * grid.res]
    ys = [grid.y0, grid.y0 + grid.ny * grid.res]
    cx = np.array([xs[0], xs[1], xs[1], xs[0]]); cy = np.array([ys[0], ys[0], ys[1], ys[1]])
    lon, lat = xy_to_lonlat(cx, cy)
    return [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]


# ----------------------------------------------------------------------------- pilot loading
_pilot: Optional[dict] = None
_pilot_error: Optional[str] = None
_data_mode: str = "UNLOADED"
_pilot_lock = threading.Lock()


def _try_load() -> tuple[Optional[dict], str, Optional[str]]:
    errors = []
    try:
        from ..data.load import load_pilot  # Agent C
        p = load_pilot()
        log.info("Pilot loaded: REAL (floodnet.data.load.load_pilot)")
        return p, "REAL", None
    except Exception as e:  # noqa: BLE001
        errors.append(f"load_pilot failed: {type(e).__name__}: {e}")
        log.warning("REAL pilot unavailable (%s); falling back to SYNTHETIC/DEMONSTRATION fixture", e)
    try:
        from ..data.fixtures import synthetic_pilot  # Agent F
        p = synthetic_pilot()
        log.error("*** DATA MODE = DEMONSTRATION: serving SYNTHETIC pilot, NOT real Mumbai data ***")
        return p, "DEMONSTRATION", None
    except Exception as e:  # noqa: BLE001
        errors.append(f"synthetic_pilot failed: {type(e).__name__}: {e}")
        log.error("No pilot available: %s", errors)
    return None, "UNAVAILABLE", "; ".join(errors)


def _normalize(p: dict) -> dict:
    """Accept scenarios as list or dict; guarantee the keys the API expects."""
    p = dict(p)
    sc = p.get("scenarios") or {}
    if not isinstance(sc, dict):
        sc = {s.id: s for s in sc}
    p["scenarios"] = sc
    p.setdefault("hotspots", [])
    p.setdefault("roads", None)
    return p


def get_pilot() -> dict:
    """Returns dict(terrain, net, roads, hotspots, scenarios). Raises ModuleMissing if nothing can be loaded."""
    global _pilot, _pilot_error, _data_mode
    with _pilot_lock:
        if _pilot is None and _pilot_error is None:
            _pilot, _data_mode, _pilot_error = _try_load()
            if _pilot is not None:
                _pilot = _normalize(_pilot)
        if _pilot is None:
            raise ModuleMissing(
                "Pilot data not available: neither floodnet.data.load.load_pilot (REAL, needs build_pilot output in "
                f"{config.DATA_PROCESSED}) nor floodnet.data.fixtures.synthetic_pilot (DEMONSTRATION) could be loaded. "
                f"Details: {_pilot_error}")
        return _pilot


def set_pilot(pilot: dict, data_mode: str) -> None:
    """Test hook / integrator override."""
    global _pilot, _pilot_error, _data_mode
    with _pilot_lock:
        _pilot, _pilot_error, _data_mode = _normalize(pilot), None, data_mode


def data_mode() -> str:
    return _data_mode


def reset_pilot() -> None:
    global _pilot, _pilot_error, _data_mode
    with _pilot_lock:
        _pilot, _pilot_error, _data_mode = None, None, "UNLOADED"


def pilot_provenance(p: dict) -> dict:
    t = p["terrain"]; net = p["net"]; roads = p.get("roads")
    prov = {"terrain": t.provenance.to_dict(), "impervious": t.impervious_provenance.to_dict(),
            "buildings": t.building_provenance.to_dict(),
            "network": {k: (v.to_dict() if hasattr(v, "to_dict") else v) for k, v in (net.provenance or {}).items()},
            "roads": roads.provenance.to_dict() if roads is not None and hasattr(roads, "provenance") else None,
            "data_mode": _data_mode}
    return prov


# ----------------------------------------------------------------------------- run cache
_runs: "OrderedDict[str, SimulationResult]" = OrderedDict()
_runs_lock = threading.Lock()
sim_lock = threading.Lock()          # only one simulation at a time


def put_run(res: SimulationResult) -> None:
    with _runs_lock:
        _runs[res.run_id] = res
        while len(_runs) > MAX_RUNS:
            _runs.popitem(last=False)


def get_run(run_id: str) -> Optional[SimulationResult]:
    with _runs_lock:
        r = _runs.get(run_id)
        if r is not None:
            _runs.move_to_end(run_id)
        return r


def latest_run() -> Optional[SimulationResult]:
    with _runs_lock:
        return next(reversed(_runs.values()), None)


def list_runs() -> list[str]:
    with _runs_lock:
        return list(_runs.keys())


# ----------------------------------------------------------------------------- simulation wiring (lazy imports)
def build_models(terrain, net) -> tuple[Any, Any, Any]:
    """Returns (surface, drainage, runoff_fn); raises ModuleMissing naming the missing piece."""
    try:
        from ..terrain.runoff import runoff_fn
    except Exception as e:  # noqa: BLE001
        raise ModuleMissing(f"floodnet.terrain.runoff.runoff_fn unavailable (Agent A): {e}") from e
    try:
        from ..terrain.surface import StorageCellSurface
    except Exception as e:  # noqa: BLE001
        raise ModuleMissing(f"floodnet.terrain.surface.StorageCellSurface unavailable (Agent A): {e}") from e
    try:
        from ..drainage.hydraulics import GraphDrainage
    except Exception as e:  # noqa: BLE001
        raise ModuleMissing(f"floodnet.drainage.hydraulics.GraphDrainage unavailable (Agent B): {e}") from e
    return StorageCellSurface(terrain, open_boundary=True), GraphDrainage(net), runoff_fn


def street_fn_for(roads, grid):
    """street_fn from Agent F, or None (frames will then carry no per-street depth)."""
    try:
        from ..streets.aggregate import make_street_fn
        return make_street_fn(roads, grid)
    except Exception as e:  # noqa: BLE001
        log.warning("floodnet.streets.aggregate.make_street_fn unavailable: %s (street depths disabled)", e)
        return None


def _blockage_fallback(net, spec: dict):
    """Local implementation used only when floodnet.drainage.scenarios.apply_blockage is unavailable."""
    import copy
    n2 = copy.copy(net)
    n2.edge_blockage = np.array(net.edge_blockage, dtype=np.float32, copy=True)
    mode = spec.get("mode", "none")
    frac = float(spec.get("fraction", 0.8) if spec.get("fraction") is not None else 0.8)
    if mode == "none":
        return n2
    if mode == "fraction":
        n2.edge_blockage[:] = np.maximum(n2.edge_blockage, frac)
    elif mode == "edges":
        ids = set(spec.get("edge_ids") or [])
        m = np.array([e in ids for e in net.edge_id])
        n2.edge_blockage[m] = np.maximum(n2.edge_blockage[m], frac)
    elif mode == "random":
        share = float(spec.get("share", 0.2) or 0.2)
        rng = np.random.default_rng(spec.get("seed", 42))
        m = rng.random(net.n_edges) < share
        n2.edge_blockage[m] = np.maximum(n2.edge_blockage[m], frac)
    elif mode == "near":
        lon, lat = spec.get("lonlat") or [None, None]
        if lon is None:
            raise ValueError("blockage mode 'near' requires lonlat")
        r = float(spec.get("radius_m", 150.0) or 150.0)
        x, y = lonlat_to_xy(lon, lat)
        mx = 0.5 * (net.node_x[net.edge_us] + net.node_x[net.edge_ds])
        my = 0.5 * (net.node_y[net.edge_us] + net.node_y[net.edge_ds])
        m = np.hypot(mx - x, my - y) <= r
        n2.edge_blockage[m] = np.maximum(n2.edge_blockage[m], frac)
    else:
        raise ValueError(f"unknown blockage mode {mode!r}")
    return n2


def apply_blockage(net, spec: dict):
    if not spec or spec.get("mode", "none") == "none":
        return net
    try:
        from ..drainage.scenarios import apply_blockage as _ab
        return _ab(net, spec)
    except ImportError as e:
        log.warning("floodnet.drainage.scenarios.apply_blockage unavailable (%s); using API fallback", e)
        return _blockage_fallback(net, spec)


def run_scenario(scenario_id: str, blockage: dict, horizon_min: int) -> SimulationResult:
    """Blocking; call via run_in_threadpool. Holds sim_lock."""
    from ..simulation.engine import run_simulation
    p = get_pilot()
    scen = p["scenarios"].get(scenario_id)
    if scen is None:
        raise KeyError(scenario_id)
    net = apply_blockage(p["net"], blockage)
    terrain = p["terrain"]
    with sim_lock:
        surface, drainage, runoff_fn = build_models(terrain, net)
        street_fn = street_fn_for(p.get("roads"), terrain.grid)
        res = run_simulation(terrain, net, scen, surface, drainage, runoff_fn, street_fn=street_fn,
                             blockage=blockage or {"mode": "none"}, horizon_s=int(horizon_min) * 60,
                             frame_dt_s=config.FRAME_DT_S)
    res.provenance = dict(res.provenance)
    res.provenance["roads"] = (p["roads"].provenance.to_dict() if p.get("roads") is not None else None)
    res.provenance["data_mode"] = _data_mode
    put_run(res)
    return res
