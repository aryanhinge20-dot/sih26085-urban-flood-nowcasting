"""MCGM storm-water snapshot (layers 6 + 7) -> DrainageNetwork for a bbox.

Source files: data/raw/mcgm_gis/c7_*.json (conduits) and n6_*.json (manholes), Esri JSON in EPSG:4326.
See data/raw/mcgm_gis/PROVENANCE.md for the full caveat list (mTHD datum, Proposal conduits, no roughness).

REAL: node x/y, GROUND_LEV, conduit length, shape, W/H, US/DS inverts, Existing/Proposal status.
ESTIMATED (rules stated in provenance): node invert (min of connected conduit inverts), outfalls (graph sinks
plus clip-boundary sinks), slope floor, Manning n, storage area, inlet capacity, full-bore capacity.
"""
from __future__ import annotations

import glob
import json
import logging
import math
from collections import defaultdict

import numpy as np
from pyproj import Transformer

from ..config import MCGM_RAW, CRS_GEO, CRS_COMPUTE, GRID_RES_M
from ..contracts import DrainageNetwork, Grid
from ..provenance import Provenance, Tag, MCGM_SNAPSHOT

log = logging.getLogger(__name__)

# --- ESTIMATED parameter table (every value labelled; cite where a citation exists) -------------------
MANNING_N_BY_SHAPE = {          # Chow (1959) Open-Channel Hydraulics, table 5-6: concrete, finished/unfinished 0.012-0.015
    "CIRC": 0.013, "RECT": 0.013, "OREC": 0.013, "ARCH": 0.013,
}
MANNING_N_DEFAULT = 0.013
SLOPE_MIN = 1e-4                # floor for flat/adverse conduits (26 adverse + 119 flat network-wide, DRAINAGE.md)
STORAGE_AREA_M2 = 1.5           # ASSUMPTION: typical manhole plan area (~1.2-1.5 m chamber); not from MCGM data
INLET_CAP_M3S = 0.05            # ASSUMPTION: order-of-magnitude capture rate of one kerb inlet/manhole; not from MCGM data

_T_GEO_TO_UTM = Transformer.from_crs(CRS_GEO, CRS_COMPUTE, always_xy=True)


def _load_esri(pattern: str) -> list[dict]:
    feats: list[dict] = []
    files = sorted(glob.glob(str(MCGM_RAW / pattern)))
    if not files:
        raise FileNotFoundError(f"No MCGM snapshot files matching {pattern} in {MCGM_RAW}")
    for f in files:
        with open(f, "r", encoding="utf-8") as fh:
            feats.extend(json.load(fh)["features"])
    return feats


def load_nodes() -> dict[str, tuple[float, float, float]]:
    """NODE_ID -> (lon, lat, ground_lev mTHD)."""
    out = {}
    for ft in _load_esri("n6_*.json"):
        a, g = ft["attributes"], ft["geometry"]
        out[str(a["NODE_ID"])] = (float(g["x"]), float(g["y"]), float(a["GROUND_LEV"]))
    return out


def load_conduits() -> list[dict]:
    out = []
    for ft in _load_esri("c7_*.json"):
        a = ft["attributes"]
        out.append({
            "id": str(a["OBJECTID"]), "us": str(a["US_NODE_ID"]), "ds": str(a["DS_NODE_ID"]),
            "length": float(a["CONDUIT_LE"]), "shape": str(a["SHAPE_1"] or "").strip().upper(),
            "w_mm": float(a["CONDUIT_WI"]), "h_mm": float(a["CONDUIT_HE"]),
            "us_inv": float(a["US_INVERT"]), "ds_inv": float(a["DS_INVERT"]),
            "status": str(a.get("USER_TEXT2") or "").strip(),
        })
    return out


def bbox_utm(bbox_lonlat, margin_m: float) -> tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax) in EPSG:32643 of the lon/lat bbox expanded by margin_m."""
    w, s, e, n = bbox_lonlat
    xs, ys = _T_GEO_TO_UTM.transform([w, e, w, e], [s, s, n, n])
    return min(xs) - margin_m, min(ys) - margin_m, max(xs) + margin_m, max(ys) + margin_m


def pilot_grid(bbox_lonlat, margin_m: float, res: float = GRID_RES_M) -> Grid:
    xmin, ymin, xmax, ymax = bbox_utm(bbox_lonlat, margin_m)
    nx = int(math.ceil((xmax - xmin) / res)); ny = int(math.ceil((ymax - ymin) / res))
    return Grid(x0=float(xmin), y0=float(ymin), res=float(res), nx=nx, ny=ny)


def full_bore_capacity(shape: str, w_m: float, h_m: float, slope: float, n: float) -> float:
    """Manning full-bore Q = A R^(2/3) S^(1/2) / n. CIRC: A=pi D^2/4, R=D/4. Others: rectangle W x H, R=A/P."""
    if shape == "CIRC":
        d = w_m if w_m > 0 else h_m
        area = math.pi * d * d / 4.0; rh = d / 4.0
    else:
        w = w_m if w_m > 0 else h_m; h = h_m if h_m > 0 else w_m
        area = w * h; per = 2.0 * (w + h)
        rh = area / per if per > 0 else 0.0
    if area <= 0 or rh <= 0:
        return 0.0
    return area * rh ** (2.0 / 3.0) * math.sqrt(max(slope, SLOPE_MIN)) / n


def build_network(bbox_lonlat, margin_m: float, include_proposal: bool = False,
                  grid: Grid | None = None) -> DrainageNetwork:
    nodes = load_nodes()
    conduits = load_conduits()
    if grid is None:
        grid = pilot_grid(bbox_lonlat, margin_m)
    xmin, ymin, xmax, ymax = bbox_utm(bbox_lonlat, margin_m)

    # project all nodes once
    ids = list(nodes.keys())
    lon = np.array([nodes[i][0] for i in ids]); lat = np.array([nodes[i][1] for i in ids])
    ux, uy = _T_GEO_TO_UTM.transform(lon, lat)
    xy = {i: (float(x), float(y)) for i, x, y in zip(ids, ux, uy)}
    in_box = {i for i, x, y in zip(ids, ux, uy) if xmin <= x <= xmax and ymin <= y <= ymax}

    # conduits: status filter + at least one endpoint inside the clip box
    keep = []
    for c in conduits:
        if c["status"] != "Existing" and not include_proposal:
            continue
        if c["us"] in in_box or c["ds"] in in_box:
            keep.append(c)
    if not keep:
        raise ValueError("No conduits in bbox")

    node_ids = sorted({c["us"] for c in keep} | {c["ds"] for c in keep})
    idx = {nid: k for k, nid in enumerate(node_ids)}
    N, E = len(node_ids), len(keep)

    # out-degree in the CLIPPED graph vs the FULL (existing) graph -> detect clip-severed outfalls
    out_full = defaultdict(int)
    for c in conduits:
        if c["status"] == "Existing" or include_proposal:
            out_full[c["us"]] += 1
    out_clip = np.zeros(N, dtype=int)
    for c in keep:
        out_clip[idx[c["us"]]] += 1
    is_outfall = out_clip == 0
    clip_boundary = np.array([is_outfall[k] and out_full[nid] > 0 for k, nid in enumerate(node_ids)], dtype=bool)

    node_invert = np.full(N, np.inf, dtype=np.float64)
    for c in keep:
        node_invert[idx[c["us"]]] = min(node_invert[idx[c["us"]]], c["us_inv"])
        node_invert[idx[c["ds"]]] = min(node_invert[idx[c["ds"]]], c["ds_inv"])
    node_ground = np.array([nodes[n][2] for n in node_ids], dtype=np.float32)
    node_invert = np.where(np.isfinite(node_invert), node_invert, node_ground - 1.0).astype(np.float32)

    nx_ = np.array([xy[n][0] for n in node_ids]); ny_ = np.array([xy[n][1] for n in node_ids])
    cj, ci = grid.cell_of(nx_, ny_)
    inside = grid.inside(cj, ci)
    cj = np.where(inside, cj, -1); ci = np.where(inside, ci, -1)

    shapes = np.array([c["shape"] if c["shape"] in MANNING_N_BY_SHAPE else (c["shape"] or "RECT") for c in keep])
    w_m = np.array([c["w_mm"] / 1000.0 for c in keep], dtype=np.float32)
    h_m = np.array([c["h_mm"] / 1000.0 for c in keep], dtype=np.float32)
    length = np.array([c["length"] for c in keep], dtype=np.float32)
    us_inv = np.array([c["us_inv"] for c in keep], dtype=np.float32)
    ds_inv = np.array([c["ds_inv"] for c in keep], dtype=np.float32)
    raw_slope = (us_inv - ds_inv) / np.maximum(length, 0.1)
    n_floored = int(np.sum(raw_slope < SLOPE_MIN))
    slope = np.maximum(raw_slope, SLOPE_MIN).astype(np.float32)
    n_arr = np.array([MANNING_N_BY_SHAPE.get(s, MANNING_N_DEFAULT) for s in shapes], dtype=np.float32)
    cap = np.array([full_bore_capacity(s, float(w), float(h), float(sl), float(nn))
                    for s, w, h, sl, nn in zip(shapes, w_m, h_m, slope, n_arr)], dtype=np.float32)

    prov = {
        "geometry": Provenance(Tag.REAL, MCGM_SNAPSHOT,
                               "layer 7 Storm Water Drains + layer 6 Storm Water Manholes; EPSG:4326 -> 32643 via pyproj; "
                               f"clipped to pilot bbox + {margin_m:.0f} m; status filter = "
                               + ("Existing+Proposal" if include_proposal else "Existing only")
                               + "; elevations mTHD (Town Hall Datum), offset to MSL UNVERIFIED").to_dict(),
        "ground_level": Provenance(Tag.REAL, MCGM_SNAPSHOT, "GROUND_LEV from layer 6, mTHD").to_dict(),
        "node_invert": Provenance(Tag.ESTIMATED, MCGM_SNAPSHOT,
                                  "rule: min of US_INVERT/DS_INVERT of connected conduits (REAL inputs)").to_dict(),
        "outfalls": Provenance(Tag.ESTIMATED, MCGM_SNAPSHOT,
                               f"out-degree-0 nodes of clipped graph = outfall; {int(clip_boundary.sum())} of "
                               f"{int(is_outfall.sum())} are clip-boundary outfalls (conduit continues outside bbox); "
                               "no tide/tailwater attribute in source").to_dict(),
        "slope": Provenance(Tag.ESTIMATED, MCGM_SNAPSHOT,
                            f"(US_INVERT-DS_INVERT)/CONDUIT_LE from REAL inverts; floored at {SLOPE_MIN} for "
                            f"{n_floored} flat/adverse conduits").to_dict(),
        "roughness": Provenance(Tag.ESTIMATED, "Chow (1959) Open-Channel Hydraulics, Table 5-6",
                                "Manning n = 0.013 assumed for all shapes (concrete, range 0.012-0.015); "
                                "MCGM data has no material field").to_dict(),
        "capacity": Provenance(Tag.ESTIMATED, "Manning full-bore formula",
                               "Q = A R^(2/3) S^(1/2)/n with REAL W/H/inverts and ESTIMATED n; "
                               "CIRC R=D/4, RECT/OREC/ARCH treated as rectangle W x H").to_dict(),
        "storage_area": Provenance(Tag.ESTIMATED, "assumption",
                                   f"{STORAGE_AREA_M2} m2 plan area per manhole (typical chamber size); not in MCGM data").to_dict(),
        "inlet_capacity": Provenance(Tag.ESTIMATED, "assumption",
                                     f"{INLET_CAP_M3S} m3/s per node, order-of-magnitude for a kerb inlet; not in MCGM data").to_dict(),
    }

    return DrainageNetwork(
        node_id=np.array(node_ids, dtype=object), node_x=nx_.astype(np.float64), node_y=ny_.astype(np.float64),
        node_ground=node_ground, node_invert=node_invert, node_is_outfall=is_outfall,
        node_storage_area_m2=np.full(N, STORAGE_AREA_M2, dtype=np.float32),
        node_inlet_cap_m3s=np.full(N, INLET_CAP_M3S, dtype=np.float32),
        node_cell_j=cj.astype(int), node_cell_i=ci.astype(int),
        edge_id=np.array([c["id"] for c in keep], dtype=object),
        edge_us=np.array([idx[c["us"]] for c in keep], dtype=int),
        edge_ds=np.array([idx[c["ds"]] for c in keep], dtype=int),
        edge_length_m=length, edge_shape=np.array(shapes, dtype=object), edge_width_m=w_m, edge_height_m=h_m,
        edge_us_invert=us_inv, edge_ds_invert=ds_inv, edge_slope=slope, edge_n=n_arr, edge_capacity_m3s=cap,
        edge_blockage=np.zeros(E, dtype=np.float32),
        edge_status=np.array([c["status"] for c in keep], dtype=object),
        provenance=prov,
    )


def network_to_dict(net: DrainageNetwork) -> dict:
    d = {}
    for k, v in net.__dict__.items():
        if k == "provenance":
            d[k] = v
        elif isinstance(v, np.ndarray):
            d[k] = v.tolist()
        else:
            d[k] = v
    return d


def network_from_dict(d: dict) -> DrainageNetwork:
    kw = {}
    for k, v in d.items():
        if k == "provenance":
            kw[k] = v
        elif k in ("node_id", "edge_id", "edge_shape", "edge_status"):
            kw[k] = np.array(v, dtype=object)
        elif k == "node_is_outfall":
            kw[k] = np.array(v, dtype=bool)
        elif k in ("node_cell_j", "node_cell_i", "edge_us", "edge_ds"):
            kw[k] = np.array(v, dtype=int)
        elif k in ("node_x", "node_y"):
            kw[k] = np.array(v, dtype=np.float64)
        else:
            kw[k] = np.array(v, dtype=np.float32)
    return DrainageNetwork(**kw)
