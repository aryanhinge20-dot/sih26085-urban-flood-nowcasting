# SIH26085 — Urban Flood Nowcasting System (Mumbai pilot)

Coupled prototype: rainfall input (scenario / historical replay / live IMD observation) → runoff → contour-derived
DTM → simplified 2D surface routing ⇄ real MCGM drainage graph (Manning capacity, surcharge, blockage) → 0–3 h
street-level depth → forecast alerts & hotspot ranking → React command-centre dashboard → flood-aware routing.

Pilot: **Hindmata / Dadar–Parel–Matunga**, ~4.7 km², 10 m grid. See `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.

## Architecture at a glance

- **Backend** (`backend/floodnet/`, FastAPI + numpy): terrain/drainage/simulation physics, the
  `RainfallProvider` abstraction (`ScenarioProvider` / `HistoricalReplayProvider` / `IMDObservationProvider` /
  inert `ExternalNowcastProvider`), REST API, provenance. See `docs/ARCHITECTURE.md`.
- **Frontend** (`frontend-react/`, React + Vite): map, timeline, scenario/route/provenance panels, and a
  FloodNet Forecast Alert layer (`src/lib/alerts.js` + `AlertsPanel`) — all derived client-side from the
  existing simulation API responses, no separate alert backend/database.
- **Data modes** shown everywhere in the UI: `SYNTHETIC SCENARIO`, `HISTORICAL REPLAY` (26 July 2005), and
  `LIVE OBSERVATION` (real IMD data when `IMD_API_KEY` is configured — see below; shows `LIVE UNAVAILABLE`
  otherwise, never a silent fallback). Full audit: `docs/LIVE_RAINFALL_AUDIT.md`.
- **Scientific limitations**: `docs/VALIDATION.md`, `docs/STATUS.md`.

## Quick start (Windows, PowerShell)

```powershell
# backend
cd backend
uv venv .venv ; uv pip install --python .venv\Scripts\python.exe -e .     # once
.venv\Scripts\python.exe -m floodnet.data.build_pilot                       # builds data/processed/pilot (needs internet for contours/OSM; falls back with labels)
.venv\Scripts\python.exe -m uvicorn floodnet.api.main:app --port 8000

# frontend (separate shell) -- production build served by the backend above at http://localhost:8000/
cd frontend-react
npm install ; npm run build
```
Run tests: `cd backend && .venv\Scripts\python.exe -m pytest tests -q`. Frontend dev server (hot reload,
proxies `/api` to the backend): `cd frontend-react && npm run dev`.

### Configuring live IMD observations (optional)

Live mode works without any key configured (it will show `LIVE UNAVAILABLE`, honestly, not fake data).
To enable it: `cp .env.example .env`, set `IMD_API_KEY=<your key>`, restart the backend. See
`docs/LIVE_RAINFALL_AUDIT.md` for how a key is actually obtained (not self-service) and full details.

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
