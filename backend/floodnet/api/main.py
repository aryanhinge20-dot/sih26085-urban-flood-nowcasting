"""FloodNet FastAPI app (SIH26085, Mumbai Hindmata/Dadar pilot).

Run: cd backend && .venv/Scripts/python -m uvicorn floodnet.api.main:app --port 8000
Every data-bearing response carries `provenance`. Missing sibling modules -> HTTP 503 with a clear message.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import config
from ..contracts import SimulationResult, Frame
from . import state
from .png import grayscale_png_base64, depth_png_base64
from .schemas import SimulateRequest, ReplayRequest, CompareRequest, RouteRequest

log = logging.getLogger("floodnet.api")
FLOOD_SEG_CM = 15.0  # a segment counts as "flooded" at >= 15 cm (minor band, see config.SEVERITY_BANDS_CM)

app = FastAPI(title="FloodNet API", version="0.1.0",
              description="Urban flood nowcasting for the Mumbai Hindmata/Dadar pilot (SIH26085)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

if config.FRONTEND_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(config.FRONTEND_DIR)), name="static")


# ----------------------------------------------------------------------------- errors
@app.exception_handler(state.ModuleMissing)
async def _module_missing(_: Request, exc: state.ModuleMissing):
    return JSONResponse(status_code=503, content={"error": "module_missing", "detail": str(exc),
                                                  "hint": "A component from another agent is not available yet; the server is up."})


def _pilot() -> dict:
    return state.get_pilot()


def _f(x) -> float:
    return float(x) if x is not None and np.isfinite(x) else 0.0


# ----------------------------------------------------------------------------- root / static
@app.get("/", include_in_schema=False)
def root():
    idx = config.FRONTEND_DIR / "index.html"
    if idx.is_file():
        return FileResponse(str(idx))
    return JSONResponse({"message": "FloodNet API is running; frontend/index.html not found", "docs": "/docs"})


@app.get("/api/health")
def health():
    return {"ok": True, "data_mode": state.data_mode(), "runs": state.list_runs()}


# ----------------------------------------------------------------------------- meta / topology / terrain
@app.get("/api/meta")
def meta():
    p = _pilot()
    g = p["terrain"].grid
    return {"pilot": {"name": config.PILOT_NAME, "bbox_lonlat": list(config.PILOT_BBOX_LONLAT),
                      "grid_bbox_lonlat": state.grid_bbox_lonlat(g), "crs": config.CRS_COMPUTE,
                      "grid": {"x0": g.x0, "y0": g.y0, "res": g.res, "nx": g.nx, "ny": g.ny}},
            "data_mode": state.data_mode(),
            "n_nodes": int(p["net"].n_nodes), "n_edges": int(p["net"].n_edges),
            "n_road_segments": int(len(p["roads"].segments)) if p.get("roads") is not None else 0,
            "scenario_ids": list(p["scenarios"].keys()),
            "severity_bands_cm": config.SEVERITY_BANDS_CM, "vehicle_limit_cm": config.VEHICLE_LIMIT_CM,
            "frame_dt_min": config.FRAME_DT_S // 60, "horizon_min": config.HORIZON_S // 60,
            "provenance": state.pilot_provenance(p), "attribution": state.ATTRIBUTION}


@app.get("/api/topology")
def topology():
    p = _pilot(); net = p["net"]
    lon, lat = state.xy_to_lonlat(net.node_x, net.node_y)
    nodes = [{"id": str(net.node_id[k]), "lon": _f(lon[k]), "lat": _f(lat[k]), "ground_m": _f(net.node_ground[k]),
              "invert_m": _f(net.node_invert[k]), "is_outfall": bool(net.node_is_outfall[k])}
             for k in range(net.n_nodes)]
    edges = []
    for e in range(net.n_edges):
        us, ds = int(net.edge_us[e]), int(net.edge_ds[e])
        edges.append({"id": str(net.edge_id[e]), "us": str(net.node_id[us]), "ds": str(net.node_id[ds]),
                      "geom": [[_f(lon[us]), _f(lat[us])], [_f(lon[ds]), _f(lat[ds])]],
                      "shape": str(net.edge_shape[e]), "width_m": _f(net.edge_width_m[e]),
                      "height_m": _f(net.edge_height_m[e]), "length_m": _f(net.edge_length_m[e]),
                      "capacity_m3s": _f(net.edge_capacity_m3s[e]), "status": str(net.edge_status[e]),
                      "blockage": _f(net.edge_blockage[e])})
    return {"nodes": nodes, "edges": edges, "provenance": state.pilot_provenance(p)["network"],
            "data_mode": state.data_mode()}


@app.get("/api/terrain")
def terrain():
    p = _pilot(); t = p["terrain"]; g = t.grid
    png, zmin, zmax = grayscale_png_base64(t.z)
    return {"grid": g.to_dict(), "bbox_lonlat": state.grid_bbox_lonlat(g), "z_min": zmin, "z_max": zmax,
            "png_base64": png, "provenance": t.provenance.to_dict(),
            "impervious_mean": _f(np.nanmean(t.impervious)), "building_fraction": _f(np.mean(t.building)),
            "data_mode": state.data_mode()}


# ----------------------------------------------------------------------------- roads / hotspots / scenarios
def _seg_feature(seg, props: dict) -> dict:
    coords = np.asarray(seg.lonlat, dtype=float).tolist()
    return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"seg_id": seg.seg_id, "name": seg.name, "highway": seg.highway, **props}}


@app.get("/api/roads")
def roads():
    p = _pilot(); r = p.get("roads")
    if r is None:
        raise state.ModuleMissing("roads not present in pilot bundle (floodnet.data.osm / build_pilot)")
    feats = [_seg_feature(s, {"length_m": _f(s.length_m), "oneway": bool(s.oneway)}) for s in r.segments]
    return {"type": "FeatureCollection", "features": feats, "provenance": r.provenance.to_dict(),
            "attribution": state.ATTRIBUTION[0], "data_mode": state.data_mode()}


HOTSPOT_PROV = "MCGM Flooding Spots layer 344 (REAL, vintage ~2017)"


@app.get("/api/hotspots")
def hotspots():
    p = _pilot(); hs = p.get("hotspots") or []
    feats = []
    for h in hs:
        lon = h.get("lon", h.get("centroid_lon")); lat = h.get("lat", h.get("centroid_lat"))
        cen = h.get("lonlat_centroid") or h.get("centroid")
        if lon is None and cen:
            lon, lat = cen[0], cen[1]
        if lon is None and h.get("x") is not None:
            lon, lat = state.xy_to_lonlat(h["x"], h["y"])
        props = {"name": h.get("name", ""), "location": h.get("location", ""), "ward": h.get("ward", ""),
                 "affect_road": h.get("affect_road", ""), "stretch_m": h.get("stretch_m"),
                 "depth_attr": h.get("depth_attr", h.get("depth", "")), "active": h.get("active", True),
                 "provenance": h.get("provenance", HOTSPOT_PROV)}
        if lon is not None:
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [_f(lon), _f(lat)]},
                          "properties": {**props, "kind": "centroid"}})
        poly = h.get("polygon_lonlat") or h.get("polygon")
        if poly:
            ring = np.asarray(poly, dtype=float).tolist()
            feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                          "properties": {**props, "kind": "polygon"}})
    return {"type": "FeatureCollection", "features": feats, "provenance": {"tag": "REAL", "source": HOTSPOT_PROV},
            "data_mode": state.data_mode()}


@app.get("/api/scenarios")
def scenarios():
    p = _pilot()
    return [s.to_dict() for s in p["scenarios"].values()]


# ----------------------------------------------------------------------------- simulation serialisation
def _frame_index(res: SimulationResult, t_min: float) -> int:
    ts = np.array([f.t_s for f in res.frames]); k = int(np.argmin(np.abs(ts - float(t_min) * 60.0)))
    return k


def _street_stats(f: Frame) -> tuple[int, float]:
    if not f.street_depth_m:
        return 0, 0.0
    v = np.array(list(f.street_depth_m.values()), dtype=float) * 100.0
    return int(np.sum(v >= FLOOD_SEG_CM)), _f(v.max()) if v.size else 0.0


def _frame_max_cm(f: Frame) -> float:
    return _f(np.nanmax(f.depth) * 100.0) if f.depth.size else 0.0


def summarize(res: SimulationResult) -> dict:
    frames = res.frames
    max_cm = [_frame_max_cm(f) for f in frames]
    surch = [int(np.sum(f.node_surcharging)) for f in frames]
    flooded = [_street_stats(f)[0] for f in frames]
    mb = res.mass_balance
    return {"run_id": res.run_id, "scenario_id": res.scenario.id, "scenario_name": res.scenario.name,
            "blockage": res.blockage, "frames_t_min": [f.t_s / 60.0 for f in frames],
            "mass_balance": {k: _f(v) for k, v in vars(mb).items()},
            "runtime_s": _f(res.runtime_s), "n_frames": len(frames),
            "summary": {"max_depth_cm": max(max_cm) if max_cm else 0.0,
                        "peak_surcharging_nodes": max(surch) if surch else 0,
                        "peak_flooded_segments": max(flooded) if flooded else 0,
                        "total_surcharge_m3": _f(sum(float(f.node_surcharge_m3.sum()) for f in frames)),
                        "peak_rain_mm_h": _f(max((f.rain_mm_h for f in frames), default=0.0))},
            "notes": list(res.notes), "provenance": res.provenance, "data_mode": state.data_mode()}


def _severity(cm: float) -> str:
    try:
        from ..streets.aggregate import severity
        return severity(cm)
    except Exception:  # noqa: BLE001
        for lim, label in config.SEVERITY_BANDS_CM:
            if cm < lim:
                return label
        return "critical"


def _passable(cm: float, vehicle: str) -> bool:
    try:
        from ..streets.aggregate import passable
        return bool(passable(cm, vehicle))
    except Exception:  # noqa: BLE001
        return cm < config.VEHICLE_LIMIT_CM.get(vehicle, 30)


def _streets_geojson(roads_graph, street_depth_m: dict) -> dict:
    try:
        from ..streets.aggregate import streets_geojson
        return streets_geojson(roads_graph, street_depth_m)
    except Exception:  # noqa: BLE001
        pass
    feats = []
    if roads_graph is not None:
        for s in roads_graph.segments:
            cm = _f(street_depth_m.get(s.seg_id, 0.0)) * 100.0
            feats.append(_seg_feature(s, {"depth_cm": round(cm, 1), "severity": _severity(cm),
                                          "passable_car": _passable(cm, "car"),
                                          "passable_ambulance": _passable(cm, "ambulance")}))
    return {"type": "FeatureCollection", "features": feats}


def serialize_frame(res: SimulationResult, k: int) -> dict:
    p = _pilot(); net = p["net"]; f = res.frames[k]
    lon, lat = state.xy_to_lonlat(net.node_x, net.node_y)
    nodes = [{"id": str(net.node_id[n]), "lon": _f(lon[n]), "lat": _f(lat[n]), "hgl_m": _f(f.node_hgl[n]),
              "surcharging": bool(f.node_surcharging[n]), "surcharge_m3": _f(f.node_surcharge_m3[n]),
              "cause": str(f.node_cause[n])} for n in range(net.n_nodes)]
    edges = [{"id": str(net.edge_id[e]), "util": _f(f.edge_util[e]), "flow_m3s": _f(f.edge_flow_m3s[e])}
             for e in range(net.n_edges)]
    run_max_m = max((float(np.nanmax(fr.depth)) for fr in res.frames), default=0.0)
    png, vmax = depth_png_base64(f.depth, max_depth_m=run_max_m if run_max_m > 0 else None)
    return {"run_id": res.run_id, "t_min": f.t_s / 60.0, "rain_mm_h": _f(f.rain_mm_h),
            "streets": _streets_geojson(p.get("roads"), f.street_depth_m),
            "nodes": nodes, "edges": edges,
            "depth_grid": {"grid": res.grid.to_dict(), "bbox_lonlat": state.grid_bbox_lonlat(res.grid),
                           "png_base64": png, "max_depth_cm": _frame_max_cm(f), "scale_max_cm": vmax * 100.0},
            "provenance": res.provenance, "data_mode": state.data_mode()}


def _get_run_or_404(run_id: str) -> SimulationResult:
    r = state.get_run(run_id)
    if r is None:
        raise HTTPException(404, f"run {run_id!r} not found (cache keeps the last {state.MAX_RUNS} runs: {state.list_runs()})")
    return r


async def _simulate(scenario_id: str, blockage: dict, horizon_min: int) -> SimulationResult:
    p = _pilot()
    if scenario_id not in p["scenarios"]:
        raise HTTPException(404, f"unknown scenario_id {scenario_id!r}; available: {list(p['scenarios'])}")
    try:
        return await run_in_threadpool(state.run_scenario, scenario_id, blockage, horizon_min)
    except state.ModuleMissing:
        raise
    except ValueError as e:
        raise HTTPException(422, str(e))


# ----------------------------------------------------------------------------- simulation endpoints
@app.post("/api/simulate")
async def simulate(req: SimulateRequest):
    res = await _simulate(req.scenario_id, req.blockage.to_spec(), req.horizon_min)
    return summarize(res)


@app.get("/api/simulation/{run_id}/frame/{t_min}")
def frame(run_id: str, t_min: float):
    res = _get_run_or_404(run_id)
    return serialize_frame(res, _frame_index(res, t_min))


@app.get("/api/simulation/{run_id}/series")
def series(run_id: str):
    res = _get_run_or_404(run_id)
    fr = res.frames
    seg_ids = sorted({sid for f in fr for sid in f.street_depth_m.keys()})
    streets = {sid: [round(_f(f.street_depth_m.get(sid, 0.0)) * 100.0, 1) for f in fr] for sid in seg_ids}
    return {"run_id": run_id, "t_min": [f.t_s / 60.0 for f in fr], "rain_mm_h": [_f(f.rain_mm_h) for f in fr],
            "surcharging_count": [int(np.sum(f.node_surcharging)) for f in fr],
            "flooded_segments": [_street_stats(f)[0] for f in fr],
            "max_depth_cm": [_frame_max_cm(f) for f in fr],
            "surcharge_m3": [_f(f.node_surcharge_m3.sum()) for f in fr],
            "streets": streets, "provenance": res.provenance, "data_mode": state.data_mode()}


@app.get("/api/nowcast")
def nowcast():
    res = state.latest_run()
    if res is None:
        raise HTTPException(404, "no simulation run yet; POST /api/simulate first")
    out = summarize(res); out["current_frame_index"] = 0
    return out


@app.post("/api/storm/replay")
async def storm_replay(req: ReplayRequest):
    p = _pilot(); ids = list(p["scenarios"].keys())
    sid = "july2005" if "july2005" in ids else next((i for i in ids if "2005" in i), None)
    if sid is None:
        raise HTTPException(404, f"no 26-July-2005 replay scenario available; scenarios: {ids}")
    res = await _simulate(sid, req.blockage.to_spec(), req.horizon_min)
    out = summarize(res); out["replay"] = True
    return out


@app.post("/api/compare")
async def compare(req: CompareRequest):
    spec = req.blockage.to_spec()
    if spec.get("mode", "none") == "none":
        raise HTTPException(422, "compare needs a blockage with mode != 'none'")
    normal = await _simulate(req.scenario_id, {"mode": "none"}, req.horizon_min)
    blocked = await _simulate(req.scenario_id, spec, req.horizon_min)

    def side(res: SimulationResult) -> dict:
        s = summarize(res)
        return {"run_id": res.run_id, "summary": s["summary"], "mass_balance": s["mass_balance"],
                "max_depth_cm": [_frame_max_cm(f) for f in res.frames],
                "surcharging_count": [int(np.sum(f.node_surcharging)) for f in res.frames],
                "flooded_segments": [_street_stats(f)[0] for f in res.frames]}
    n, b = side(normal), side(blocked)
    return {"scenario_id": req.scenario_id, "blockage": spec, "frames_t_min": [f.t_s / 60.0 for f in normal.frames],
            "normal": n, "blocked": b,
            "delta": {"max_depth_cm": b["summary"]["max_depth_cm"] - n["summary"]["max_depth_cm"],
                      "peak_flooded_segments": b["summary"]["peak_flooded_segments"] - n["summary"]["peak_flooded_segments"],
                      "peak_surcharging_nodes": b["summary"]["peak_surcharging_nodes"] - n["summary"]["peak_surcharging_nodes"]},
            "provenance": blocked.provenance, "data_mode": state.data_mode()}


# ----------------------------------------------------------------------------- routing
@app.post("/api/route")
async def route(req: RouteRequest):
    p = _pilot(); roads_graph = p.get("roads")
    if roads_graph is None:
        raise state.ModuleMissing("roads not present in pilot bundle; routing impossible")
    try:
        from ..routing.router import safe_route
    except Exception as e:  # noqa: BLE001
        raise state.ModuleMissing(f"floodnet.routing.router.safe_route unavailable (Agent F): {e}")
    res: Optional[SimulationResult] = state.get_run(req.run_id) if req.run_id else state.latest_run()
    if req.run_id and res is None:
        raise HTTPException(404, f"run {req.run_id!r} not found")
    depth = res.frames[_frame_index(res, req.t_min)].street_depth_m if res is not None else {}
    try:
        out: Any = await run_in_threadpool(safe_route, roads_graph, depth, tuple(req.origin), tuple(req.dest), req.vehicle)
    except (ValueError, KeyError) as e:
        raise HTTPException(422, str(e))
    out = dict(out or {})
    out.update({"t_min": req.t_min, "run_id": res.run_id if res is not None else None, "vehicle": req.vehicle,
                "depth_source": "simulation frame" if res is not None else "no run: dry network assumed",
                "data_mode": state.data_mode()})
    out.setdefault("provenance", {"roads": roads_graph.provenance.to_dict(),
                                  "depths": res.provenance if res is not None else None})
    return out
