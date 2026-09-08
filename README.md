# SIH26085 — Urban Flood Nowcasting System (Mumbai pilot)

Coupled prototype: rainfall scenario → runoff → contour-derived DTM → simplified 2D surface routing ⇄ real MCGM
drainage graph (Manning capacity, surcharge, blockage) → 0–3 h street-level depth → Leaflet dashboard → flood-aware routing.

Pilot: **Hindmata / Dadar–Parel–Matunga**, ~4.7 km², 10 m grid. See `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.

## Quick start (Windows, PowerShell)

```powershell
cd backend
uv venv .venv ; uv pip install --python .venv\Scripts\python.exe -e .     # once
.venv\Scripts\python.exe -m floodnet.data.build_pilot                       # builds data/processed/pilot (needs internet for contours/OSM; falls back with labels)
.venv\Scripts\python.exe -m uvicorn floodnet.api.main:app --port 8000
```
Open http://localhost:8000 . Run tests: `.venv\Scripts\python.exe -m pytest tests -q`.

## Data provenance (summary — full detail in `data/raw/mcgm_gis/PROVENANCE.md` and `data/processed/pilot/PROVENANCE.md`)

| Component | Tag | Source |
|---|---|---|
| Drainage geometry, connectivity, sizes, inverts, ground levels | **REAL** | MCGM ArcGIS REST layers 7 & 6 (BRIMSTOWAD), snapshot 2026-09-08 |
| Terrain | **REAL (interpolated)** | MCGM 20 cm contours (layer 301) + manhole ground levels; falls back to labelled alternatives |
| Roads, buildings | **REAL** | © OpenStreetMap contributors, ODbL |
| Flooding hotspots | **REAL** | MCGM Flooding Spots (layer 344), vintage ~2017 |
| Manning n, inlet capacity, manhole storage area, impervious fractions | **ESTIMATED** | stated rules / cited ranges, see module docstrings |
| Rainfall scenarios | **SYNTHETIC** (or REAL where transcribed from the Chitale report and labelled so) | `floodnet/data/scenarios.py` |
| Blockage | **SYNTHETIC scenario input** | never an observed condition |

Not an operational warning system. Physics is deliberately simplified (storage-cell surface routing, capacity-based graph
hydraulics — not Saint-Venant). Depth precision is bounded by a contour-derived DTM (~0.2 m vertical) and assumed parameters.
