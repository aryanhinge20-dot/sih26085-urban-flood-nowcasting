# SIH26085 — Urban Flood Nowcasting System (Mumbai pilot)

Coupled prototype: rainfall input (scenario / historical replay / live IMD observation / live ECMWF NWP
forecast) → runoff → contour-derived DTM → simplified 2D surface routing ⇄ real MCGM drainage graph (Manning
capacity, surcharge, blockage) → 0–3 h street-level depth → forecast alerts & hotspot ranking → React
command-centre dashboard → flood-aware routing on the real pilot road network.

Pilot: **Hindmata / Dadar–Parel–Matunga**, ~4.7 km², 10 m grid. See `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.

## Architecture at a glance

- **Backend** (`backend/floodnet/`, FastAPI + numpy): terrain/drainage/simulation physics, the
  `RainfallProvider` abstraction (`ScenarioProvider` / `HistoricalReplayProvider` / `IMDObservationProvider` /
  `ECMWFForecastProvider` / `IMDVeravaliSRIImageProvider` — see below), flood-aware routing
  (`routing/router.py`: direct vs lower flood-risk route, multi-candidate lowest-flood-risk / shortest /
  balanced, time-aware), a CAP 1.2
  government alert-draft generator (`alerts/cap.py`, `GET /api/simulation/{run_id}/alert` — always a
  human-reviewed draft, never an issued warning), REST API, provenance. See `docs/ARCHITECTURE.md`.
- **3D terrain** (2026-09-21): a 2D | 3D toggle renders the solver's own MCGM-derived DEM as a true terrain mesh
  (three.js, lossless `/api/terrain/dem`, display-only visual relief, forecast water draped on it, DEM elevation
  inspector). No online terrain service. `docs/TERRAIN_3D.md`.
- **Technology story** (2026-09-21): one data file (`src/lib/story/stages.js`) drives the landing "How FloodNet
  Works" chain (Rain → Spatial rainfall → Runoff → 2D surface flow → Drainage network → Flood depth → Action), the
  dashboard story strip (click a stage → the real tab/layer/timeline is spotlighted) and **Demo Story**, a spoken
  technical walkthrough on the Guided Briefing engine (en/हिन्दी/मराठी). See `docs/TECHNOLOGY_EXPLAINER.md`;
  competitor evidence in `docs/COMPETITIVE_VIDEO_ANALYSIS.md`.
- **Frontend** (`frontend-react/`, React + Vite + Leaflet): map, timeline, scenario/route/provenance panels,
  flood-aware route planner (direct vs lower flood-risk comparison) with A/B (From/To) search over real OSM street names and landmarks, and a FloodNet
  Forecast Alert layer (`src/lib/alerts.js` + `AlertsPanel`) — a separate, purely client-side advisory
  computed from data already fetched into Context (no new API calls of its own), distinct from the backend
  CAP draft above; both are explicitly labelled system-generated, never an official warning.
- **Rainfall sources as the operator sees them** (one mapping, `frontend-react/src/lib/sources.js`):
  `SCENARIO` design storms, `HISTORICAL` 26 July 2005 replay, `IMD LIVE` observation (verified live
  2026-09-18; needs key + token + IP-bound key, otherwise reported unavailable, never substituted —
  `docs/LIVE_RAINFALL_AUDIT.md` §12), `FORECAST` ECMWF NWP via Open-Meteo (never called a nowcast or an IMD
  product — `docs/ECMWF_OPENMETEO_AUDIT.md`), and `RADAR-DERIVED` IMD Mumbai-Veravali DWR (below). The header
  always names the source that is actually active. **Current one-page status: `docs/FINAL_STATUS.md`;
  deployment: `docs/DEPLOYMENT.md`.**
- **Radar: experimental, image-derived only (2026-09-18).** IMD's API portal has no radar-product API, and the
  public Mumbai-Veravali DWR SRI/PAC products are *images*. `IMDVeravaliSRIImageProvider` (scenario `imd_sri`)
  decodes the public SRI image into a `[T, ny, nx]` field labelled `RADAR_IMAGE_DERIVED_ESTIMATE` — legend-band
  precision (47 bands, ~23.7–26.2 mm/h band excluded, capped at ~49 mm/h), approximate georeference from the
  image axes, IMD reuse terms unconfirmed. Forecast periods are source-labelled: observed frame → gated
  "experimental radar-image nowcast" (5–30 min, only when two distinct frames exist; logic-tested, not yet
  run on consecutive real scans — `docs/RADAR_NOWCAST_STATUS.md`) → ECMWF or persistence. Never
  presented as IMD QPE or gridded radar. Evidence: `docs/RADAR_SRI_IMAGE.md`, `docs/DECISIONS.md` D-20
  (earlier rejection history: D-14/D-15/D-19, `docs/VALIDATION.md` §2.E). Needs the optional `[radar]` extra
  (Pillow).
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
Run tests: `cd backend && .venv\Scripts\python.exe -m pytest tests -q`. Frontend unit tests (story/route wording and navigation targets, no extra dependency): `cd frontend-react && npm run test:unit`. Frontend dev server (hot reload,
proxies `/api` to the backend, and doesn't have the build-order constraint above): `cd frontend-react && npm run dev`.

### Deploying

Static frontend on Vercel (`vercel.json` at the repo root; set `VITE_API_BASE_URL` in the Vercel project) + the FastAPI
backend as a container (`Dockerfile`) on a host with a static outbound IP. Why not a Vercel Python function, the
environment variables, and what has / has not been verified: `docs/DEPLOYMENT.md`.

### Configuring live IMD observations (optional)

Live mode works without any key configured (it will show `LIVE UNAVAILABLE`, honestly, not fake data).
Real IMD access (verified 2026-09-18) needs all three: `IMD_API_KEY` (sent as `X-API-Key`), `IMD_API_TOKEN`
(the JWT from the logged-in portal, sent as `Authorization: Bearer`; it expires and must be renewed by hand),
and the caller's public IP bound to the key. Put both values in the root `.env` (never in `VITE_*` vars) and
restart the backend. See `docs/LIVE_RAINFALL_AUDIT.md` §12 for details.

Live IMD smoke tests are opt-in (a plain `pytest -q` never needs a credential):
`cd backend && RUN_LIVE_IMD=1 .venv/Scripts/python.exe -m pytest tests/test_imd_live_smoke.py -v -m live`

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
