# SIH26085 — Urban Flood Nowcasting System (Mumbai pilot)

Coupled prototype: rainfall input (scenario / historical replay / live IMD observation / live ECMWF NWP
forecast) → runoff → contour-derived DTM → simplified 2D surface routing ⇄ real MCGM drainage graph (Manning
capacity, surcharge, blockage) → 0–3 h street-level depth → forecast alerts & hotspot ranking → React
command-centre dashboard → flood-aware routing on the real pilot road network.

Pilot: **Hindmata / Dadar–Parel–Matunga**, ~4.7 km², 10 m grid. See `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.

## Architecture at a glance

- **Backend** (`backend/floodnet/`, FastAPI + numpy): terrain/drainage/simulation physics, the
  `RainfallProvider` abstraction (`ScenarioProvider` / `HistoricalReplayProvider` / `IMDObservationProvider` /
  `ECMWFForecastProvider` / inert `ExternalNowcastProvider` for radar — see below), flood-aware routing
  (`routing/router.py`: single route, multi-candidate safest/fastest/balanced, time-aware safety), a CAP 1.2
  government alert-draft generator (`alerts/cap.py`, `GET /api/simulation/{run_id}/alert` — always a
  human-reviewed draft, never an issued warning), REST API, provenance. See `docs/ARCHITECTURE.md`.
- **Frontend** (`frontend-react/`, React + Vite + Leaflet): map, timeline, scenario/route/provenance panels,
  flood-safe route planner with A/B (From/To) search over real OSM street names and landmarks, and a FloodNet
  Forecast Alert layer (`src/lib/alerts.js` + `AlertsPanel`) — a separate, purely client-side advisory
  computed from data already fetched into Context (no new API calls of its own), distinct from the backend
  CAP draft above; both are explicitly labelled system-generated, never an official warning.
- **Data modes** shown everywhere in the UI: `SYNTHETIC SCENARIO`, `HISTORICAL REPLAY` (26 July 2005),
  `LIVE OBSERVATION` (real IMD data when `IMD_API_KEY` is configured — see below; shows `LIVE UNAVAILABLE`
  otherwise, never a silent fallback; full audit: `docs/LIVE_RAINFALL_AUDIT.md`), and `ECMWF NWP FORECAST`
  (real ECMWF precipitation forecast via Open-Meteo, no key needed — a temporary stand-in while IMD access is
  pending; never called a nowcast or IMD product. Full audit: `docs/ECMWF_OPENMETEO_AUDIT.md`).
- **Radar: deliberately not built.** The SIH brief asks for Doppler-radar-derived rainfall; IMD's only free
  Mumbai product censors intensities above 100 mm/h (below this project's own storm scenarios) and has no
  licence grant or historical archive, so it was investigated and rejected rather than faked — see
  `docs/DECISIONS.md` (D-14/D-15) and `docs/VALIDATION.md` §2.E. `ExternalNowcastProvider` stays an inert stub.
- **Current, actively-maintained status**: `context.md` (verified repository state), `docs/VALIDATION.md`
  (what is/isn't scientifically validated — no accuracy percentage is claimed anywhere), and
  `docs/SIH_REQUIREMENTS.md` (per-requirement COMPLETE/PARTIAL/BLOCKED status with evidence). `docs/STATUS.md`
  is an earlier, now-superseded snapshot — kept for history, not for current numbers.

## Quick start (Windows, PowerShell)

```powershell
# 1. backend deps + data (once)
cd backend
uv venv .venv ; uv pip install --python .venv\Scripts\python.exe -e .     # once
.venv\Scripts\python.exe -m floodnet.data.build_pilot                       # builds data/processed/pilot (needs internet for contours/OSM; falls back with labels)

# 2. frontend production build -- MUST run before starting the backend below: FRONTEND_DIR is
#    resolved once, at backend import time, from whether frontend-react/dist exists yet. Building it
#    after the backend is already running will not be picked up without restarting the backend.
cd ..\frontend-react
npm install ; npm run build

# 3. start the backend (serves the build above at http://localhost:8000/static/)
cd ..\backend
.venv\Scripts\python.exe -m uvicorn floodnet.api.main:app --port 8000
```
Run tests: `cd backend && .venv\Scripts\python.exe -m pytest tests -q`. Frontend dev server (hot reload,
proxies `/api` to the backend, and doesn't have the build-order constraint above): `cd frontend-react && npm run dev`.

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
