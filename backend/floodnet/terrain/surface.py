"""2D surface water: simplified storage-cell (diffusive-wave) scheme on the Terrain grid.

Physics (explainable, mass-conserving, fully vectorised):
  * Each cell stores depth h (m); water surface H = z + h.
  * For each of the 4 neighbour faces the unit-width flux is a Manning-type resistance law
        q = (1/n) * h_eff^(5/3) * sqrt(|dH| / dx)          [m2/s]
    with h_eff = depth in the upstream (higher-H) cell above the higher of the two bed elevations
    (LISFLOOD-FP style "flow depth", Bates & De Roo 2000).
  * Face volume per sub-step V = q * res * dt is limited so that (a) the total outflow of a cell never exceeds
    its stored volume and (b) a face never moves more than half the head-difference volume (no overshoot /
    level inversion between the two cells).
  * Adaptive sub-stepping inside step(): dt_sub <= 0.5 * res / max(velocity), velocity = q / h_eff,
    with a floor DT_MIN_S to bound the work.
  * Buildings are no-flow obstacles (all faces touching a building cell are masked).
  * Boundary: CLOSED for the MVP (no water leaves the grid edge). Water reaching the edge accumulates there;
    a documented simplification — the pilot area drains through the MCGM network / outfalls, not overland exits.
  * Depths below H_MIN are treated as dry for flux purposes (state is never truncated, so mass is conserved).
  * Infiltration: optional constant rate on the pervious fraction (default 0 for the MVP); accumulated in
    infiltrated_m3().
"""
from __future__ import annotations

import numpy as np

from ..contracts import Terrain
from ..provenance import Provenance, Tag

MANNING_N = 0.03      # urban street / mixed surface roughness
H_MIN = 1e-6          # m, dry threshold for flux computation
DT_MIN_S = 0.05       # s, floor for the adaptive sub-step
CFL = 0.5

PROVENANCE = Provenance(
    Tag.ESTIMATED,
    "Manning n for overland flow on urban streets (Chow 1959 Table 5-6: asphalt/concrete 0.011-0.016; "
    "Engman 1986 / HEC-RAS 2D urban-mixed 0.02-0.05)",
    f"n={MANNING_N} single value for the whole grid: streets plus kerbs, parked vehicles, debris. "
    "Storage-cell diffusive-wave scheme after Bates & De Roo (2000), flow limiter after Hunter et al. (2005).",
)


class StorageCellSurface:
    """Implements floodnet.contracts.SurfaceModel."""

    def __init__(self, terrain: Terrain, n: float = MANNING_N, infiltration_rate_mm_h: float = 0.0,
                 dt_min_s: float = DT_MIN_S, cfl: float = CFL):
        self.terrain = terrain
        self.grid = terrain.grid
        self.res = float(self.grid.res)
        self.area = float(self.grid.cell_area)
        self.n = float(n)
        self.dt_min = float(dt_min_s)
        self.cfl = float(cfl)
        self.z = np.asarray(terrain.z, dtype=np.float64)
        self.building = np.asarray(terrain.building, dtype=bool)
        self.open = ~self.building
        self.imp = np.clip(np.asarray(terrain.impervious, dtype=np.float64), 0.0, 1.0)
        self.depth = np.zeros(self.z.shape, dtype=np.float64)      # live state, metres
        # infiltration: m/s on the pervious fraction of open cells
        self.infil_rate = float(infiltration_rate_mm_h) / 1000.0 / 3600.0
        self._infil_depth_rate = self.infil_rate * (1.0 - self.imp) * self.open
        self._infiltrated = 0.0
        # precomputed face geometry (x-faces: between (j,i) and (j,i+1); y-faces: between (j,i) and (j+1,i))
        self.zmax_x = np.maximum(self.z[:, :-1], self.z[:, 1:])
        self.zmax_y = np.maximum(self.z[:-1, :], self.z[1:, :])
        self.open_x = self.open[:, :-1] & self.open[:, 1:]
        self.open_y = self.open[:-1, :] & self.open[1:, :]
        self.inv_n = 1.0 / self.n
        self.sqrt_inv_dx = 1.0 / np.sqrt(self.res)
        self.last_dt_used = 0.0
        self.substeps = 0

    # ------------------------------------------------------------------ sources / sinks
    def add_volume(self, j: np.ndarray, i: np.ndarray, volume_m3: np.ndarray) -> None:
        j = np.asarray(j, dtype=np.int64); i = np.asarray(i, dtype=np.int64)
        v = np.asarray(volume_m3, dtype=np.float64)
        if j.size == 0:
            return
        np.add.at(self.depth, (j, i), v / self.area)

    def add_runoff(self, runoff_depth_m: np.ndarray) -> None:
        self.depth += np.asarray(runoff_depth_m, dtype=np.float64)

    def take_volume(self, j: np.ndarray, i: np.ndarray, max_m3: np.ndarray) -> np.ndarray:
        j = np.asarray(j, dtype=np.int64); i = np.asarray(i, dtype=np.int64)
        req = np.maximum(np.asarray(max_m3, dtype=np.float64), 0.0)
        if j.size == 0:
            return np.zeros(0, dtype=np.float64)
        nx = self.depth.shape[1]
        flat = j * nx + i
        avail = self.depth.reshape(-1)[flat] * self.area
        # duplicates in the same cell share the available volume proportionally
        req_cell = np.bincount(flat, weights=req, minlength=self.depth.size)[flat]
        frac = np.where(req_cell > 0, np.minimum(1.0, avail / np.maximum(req_cell, 1e-300)), 0.0)
        removed = req * frac
        np.add.at(self.depth, (j, i), -removed / self.area)
        np.maximum(self.depth, 0.0, out=self.depth)
        return removed

    # ------------------------------------------------------------------ routing
    def _face_fluxes(self, h: np.ndarray):
        """Returns signed unit fluxes qx, qy (m2/s, + means toward increasing index), head diffs, h_eff and max velocity."""
        H = self.z + h
        # x faces
        dHx = H[:, :-1] - H[:, 1:]
        hx = np.maximum(np.maximum(H[:, :-1], H[:, 1:]) - self.zmax_x, 0.0)
        hx[~self.open_x] = 0.0
        hx[hx < H_MIN] = 0.0
        sx = np.sqrt(np.abs(dHx)) * self.sqrt_inv_dx
        qx = self.inv_n * hx ** (5.0 / 3.0) * sx * np.sign(dHx)
        # y faces
        dHy = H[:-1, :] - H[1:, :]
        hy = np.maximum(np.maximum(H[:-1, :], H[1:, :]) - self.zmax_y, 0.0)
        hy[~self.open_y] = 0.0
        hy[hy < H_MIN] = 0.0
        sy = np.sqrt(np.abs(dHy)) * self.sqrt_inv_dx
        qy = self.inv_n * hy ** (5.0 / 3.0) * sy * np.sign(dHy)
        # velocity = q / h_eff = (1/n) h^(2/3) sqrt(S)
        vx = self.inv_n * hx ** (2.0 / 3.0) * sx
        vy = self.inv_n * hy ** (2.0 / 3.0) * sy
        vmax = max(float(vx.max()) if vx.size else 0.0, float(vy.max()) if vy.size else 0.0)
        return qx, qy, dHx, dHy, vmax

    def _substep(self, dt: float) -> None:
        h = self.depth
        A = self.area
        qx, qy, dHx, dHy, _ = self._face_fluxes(h)
        # face volumes (m3), capped at half the head-difference volume (no level inversion)
        Vx = qx * self.res * dt
        Vy = qy * self.res * dt
        capx = 0.5 * np.abs(dHx) * A
        capy = 0.5 * np.abs(dHy) * A
        Vx = np.clip(Vx, -capx, capx)
        Vy = np.clip(Vy, -capy, capy)
        # total outflow per cell must not exceed stored volume
        out = np.zeros_like(h)
        px = np.maximum(Vx, 0.0); nxv = np.maximum(-Vx, 0.0)
        py = np.maximum(Vy, 0.0); nyv = np.maximum(-Vy, 0.0)
        out[:, :-1] += px; out[:, 1:] += nxv
        out[:-1, :] += py; out[1:, :] += nyv
        stored = h * A
        scale = np.where(out > stored, stored / np.maximum(out, 1e-300), 1.0)
        # scale each face by its upstream cell's factor
        Vx = np.where(Vx > 0, Vx * scale[:, :-1], Vx * scale[:, 1:])
        Vy = np.where(Vy > 0, Vy * scale[:-1, :], Vy * scale[1:, :])
        dh = np.zeros_like(h)
        dh[:, :-1] -= Vx; dh[:, 1:] += Vx
        dh[:-1, :] -= Vy; dh[1:, :] += Vy
        h += dh / A
        np.maximum(h, 0.0, out=h)
        # infiltration (pervious fraction of open cells)
        if self.infil_rate > 0.0:
            inf = np.minimum(h, self._infil_depth_rate * dt)
            h -= inf
            self._infiltrated += float(inf.sum()) * A

    def step(self, dt_s: float) -> float:
        """Advance the surface by dt_s using adaptive sub-steps. Returns the first sub-step size used."""
        remaining = float(dt_s)
        first = None
        while remaining > 1e-9:
            _, _, _, _, vmax = self._face_fluxes(self.depth)
            dt = remaining if vmax <= 0.0 else min(remaining, self.cfl * self.res / vmax)
            dt = max(dt, min(self.dt_min, remaining))
            self._substep(dt)
            remaining -= dt
            self.substeps += 1
            if first is None:
                first = dt
        self.last_dt_used = first if first is not None else float(dt_s)
        return self.last_dt_used

    # ------------------------------------------------------------------ diagnostics
    def total_volume_m3(self) -> float:
        return float(self.depth.sum()) * self.area

    def infiltrated_m3(self) -> float:
        return float(self._infiltrated)
