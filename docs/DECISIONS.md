# DECISIONS — SIH26085 Urban Flood Nowcasting System

**Overall status: `DECIDED` for the build (D-01 … D-13). Recorded 2026-09-08 ~18:30 IST after the Mumbai research round.**
**Time budget: ~48 hours from 2026-09-08 evening.** First 12 hours = core MVP milestone, not the deadline.

Rules unchanged: nothing is decided until recorded here with evidence; supersede, never silently edit; decisions follow the data.
Evidence lives in `research/mumbai/*.md` and `docs/MUMBAI_FEASIBILITY.md`. Where the lead re-verified a worker's claim, it says so.

---

## Decision table

| # | Decision | Status | Decision (short) |
|---|---|---|---|
| D-01 | Target city | `DECIDED` | **Mumbai** (project direction) |
| D-02 | Pilot area | `DECIDED` | **Hindmata / Dadar–Parel–Matunga**, bbox 72.835–72.855 E, 19.010–19.030 N (~4.7 km²), extendable to a "wider" box |
| D-03 | Drainage dataset | `DECIDED` | **Real MCGM BRIMSTOWAD network** (layers 6 + 7), `Existing` conduits; roughness ESTIMATED |
| D-04 | DEM | `DECIDED` | **DTM interpolated from MCGM 20 cm contours (layer 301)** at 10 m (5 m optional); Copernicus GLO-30 as fallback only |
| D-05 | Rainfall source | `DECIDED` | **Scenario-driven hyetographs** (REAL 26 Jul 2005 replay from Chitale report + SYNTHETIC design/user storms) as the driver; Open-Meteo NWP as optional live feed **labelled NWP, not radar**; radar extrapolation nowcast = P2 stretch |
| D-06 | Ground truth | `DECIDED` | **MCGM Flooding Spots layer 344** (spatial-overlap check) + **Chitale 2005 named locations** (qualitative). No depth/timing validation claimed |
| D-07 | Hydraulic engine | `DECIDED` | **Own transparent graph solver** for the live system + **pyswmm/EPA SWMM offline cross-check** on the pilot subnetwork (hybrid) |
| D-08 | ML / GNN | `DECIDED` | **Not in the MVP.** P2 only, and only trained/evaluated on our own simulator output with reported metrics; CascadeFloodNet weights never used |
| D-09 | Surface routing | `DECIDED` | **Simplified 2D storage-cell (diffusive) routing on the DTM grid**, explicit timestep, mass-conserving, buildings as obstacles; D8 flow-accumulation as fallback |
| D-10 | Database | `DECIDED` | **None.** Files (JSON/NPZ) + in-memory state. No Neo4j/Supabase/Redis |
| D-11 | GIS framework | `DECIDED` | Processing: numpy/scipy/shapely/pyproj/networkx (no GDAL/rasterio dependency). Web map: **Leaflet**, vanilla JS, served by FastAPI, no bundler |
| D-12 | Routing | `DECIDED` | **OSM road graph (Overpass) + own flood-weighted Dijkstra** (networkx). No OSRM |
| D-13 | Deployment | `DECIDED` | **Single local process** (`uvicorn`), all data pre-processed to disk, demo runs offline. No Docker required |

---

### D-01 — Target city: Mumbai
- **Basis:** project direction under time pressure; compliant with the PS ("metros like Mumbai, Delhi, Chennai"). Not a data-driven comparison — we must not claim it was. Alternatives not evaluated. Irreversible at this budget.

### D-02 — Pilot area: Hindmata / Dadar
- **Evidence (lead-verified on the MCGM snapshot):** bbox 72.835–72.855 E × 19.010–19.030 N contains **1,607 manholes, 1,608 conduits (826 `Existing`)**, `GROUND_LEV` 27.4–38.2 mTHD, **1,973 twenty-cm contour lines**, **21 Flooding Spots polygons**. Two large drainage components are partly inside (617/2,829 and 547/2,909 nodes) — the network must be clipped with its downstream path to an outfall kept, or the box widened.
- **Why here:** most media-cited chronic hotspot in Mumbai (W2, Free Press Journal source), no river channel to model, dense real network, judge-recognisable.
- **Alternatives:** B Milan Subway (348 nodes — too sparse), C Kurla/Mithi (needs river), E "Sion–Matunga–Hindmata wider" (72.830–72.870 × 19.000–19.045, **6,012 nodes / 6,129 conduits, ~21 km²**) — the designated **scale-up box** if runtime allows.
- **Caveat:** bbox coordinates were inferred by W2, not gazetteer-sourced. Agent 1 must confirm Hindmata junction falls inside it before hard-coding.

### D-03 — Drainage dataset: real MCGM network
- **Evidence:** `research/mumbai/DRAINAGE.md` (verdict A) and **lead re-verification**: 34,711 conduits with 0 null `US_INVERT/DS_INVERT/CONDUIT_WI`; 34,431 nodes, all unique, 0 null `GROUND_LEV`; 0 dangling endpoints; live count re-confirmed. Snapshot in `data/raw/mcgm_gis/` with `PROVENANCE.md`.
- **What is REAL:** geometry, connectivity, direction, length, cross-section shape and size, upstream/downstream inverts, ground levels.
- **What is ESTIMATED (must be labelled):** Manning's n (by shape/assumed material, cited table), node invert (derived = min of connected conduit inverts — standard practice), node type (outfall inferred from graph sinks), inlet capture capacity, blockage factor (scenario input only).
- **Filters:** `USER_TEXT2 = 'Existing'` for the present-day model; `Proposal` conduits available as a "BRIMSTOWAD upgrade" what-if scenario. Normalise `SHAPE_1` case; fix 26 adverse / 119 flat slopes.
- **Datum:** mTHD. Because D-04 uses MCGM contours (same datum), **no datum conversion is needed in the pilot.** If Copernicus is ever mixed in, calibrate the offset first.
- **Licence:** `"MCGM, Esri India"`, no explicit open licence. Credit MCGM on every screen; do not claim redistribution rights; do not publish the raw snapshot outside the demo.
- **Rejected:** synthetic network (unnecessary); OSM drains (716 ways, no attributes — Class C).

### D-04 — DEM: DTM from MCGM 20 cm contours
- **Evidence (lead-verified):** layer 301 `Contour_20CM`, polylines with `HEIGHT` (double), `LAYER` MINOR/MAJOR, native EPSG:32643, 284,403 features city-wide, 1,973 in the pilot bbox; sample values 28.0–29.8 match adjacent manhole ground levels (~29.5) → same vertical datum.
- **Method:** contour vertices → scattered points → interpolate (scipy `griddata` linear, or natural-neighbour if available) to a regular grid at **10 m** (5 m optional) in EPSG:32643; add manhole `GROUND_LEV` points as extra samples; burn OSM building footprints as obstacles (raised/no-flow), not as elevation.
- **Honest limitation statement to ship with it:** contour-derived DTM; effective vertical resolution ≈ 0.2 m; interpolation artefacts between contours; not LiDAR. Street-segment depths carry ±~10–20 cm uncertainty from terrain alone — state it.
- **Fallback:** Copernicus GLO-30 DSM (verified no-auth fetch), only if the contour layer becomes unreachable and the snapshot is lost — with the datum offset calibrated and a 30 m caveat.
- **Rejected:** SRTM via OpenTopography (key + coarser), CartoDEM (login/queue), FABDEM (unverified download, NC licence), MCGM LiDAR (not accessible).

### D-05 — Rainfall: scenario hyetographs; NWP as labelled live feed
- **Evidence:** `research/mumbai/RAINFALL.md`; lead re-verified RainViewer `nowcast: []`. No public gridded 0–3 h radar nowcast exists for Mumbai; IMD API needs a key we don't have.
- **Drivers, each carrying a provenance tag:**
  1. `REAL` — 26–27 July 2005 Santacruz hourly series, transcribed from the Chitale Committee report (scratchpad `chitale.txt`; Agent 1 extracts and cites page). Replay labelled "historical replay", never "nowcast".
  2. `SYNTHETIC` — user-defined uniform/pulse storms and a design storm. IDF parameters only if a citable Mumbai source is found; otherwise the storm is labelled "synthetic stress test", not "design storm".
  3. `NWP` (optional live) — Open-Meteo hourly precipitation for the pilot centroid, labelled "NWP model forecast — not radar nowcast" in the API and UI. This is the fallback the PS criticises; it is shown only as the live-mode driver with that label.
  4. `P2` — IMD Veravali radar GIF (reachable, no auth) + pysteps extrapolation. Only if time remains; legal grey area noted.
- **Spatial form:** the driver is a time series applied uniformly or with a simple spatial gradient across the 4.7 km² pilot — stated openly (radar-scale spatial structure is not available).
- **Implementation note (2026-09-09):** driver 3 (Open-Meteo ECMWF NWP) implemented as `ECMWFForecastProvider`
  (`backend/floodnet/rainfall/provider.py`, `scenario_id="ecmwf"`), selectable independently alongside the
  synthetic scenarios, the 2005 replay, and the still-pending IMD live-observation path — none of which it
  replaces or disables. Full source audit: `docs/ECMWF_OPENMETEO_AUDIT.md`.

### D-06 — Ground truth: Flooding Spots + Chitale 2005
- **Evidence:** `research/mumbai/FLOOD_GROUND_TRUTH.md`; lead-verified 21 polygons in the pilot bbox. Records suffixed "(Delete)" / "(Tackled)" must be filtered or shown as such; layer vintage ~2017, currency unconfirmed.
- **Validation we will claim:** (a) spatial overlap — fraction of active Flooding Spots polygons inside our top-N ponding zones under the 2005 replay; (b) qualitative match to Chitale's named flooded roads inside the pilot; (c) conservation, behavioural and sensitivity checks (PRD V1, V2, V4); (d) runtime (V5).
- **We will not claim:** depth accuracy, timing accuracy, or any hit/miss score against a georeferenced event map (none exists publicly).

### D-07 — Hydraulic engine: own solver + pyswmm cross-check (hybrid)
- **Own solver (live path):** per conduit, full-bore Manning capacity from real shape/size/slope + ESTIMATED n; per node, storage + hydraulic grade; flow limited by downstream capacity; **surcharge** when node HGL ≥ `GROUND_LEV`, surcharged volume returned to the surface grid; **blockage factor** 0–1 scales effective capacity; **inlet capture** limits what the surface can hand to the node; cause attribution (overcapacity vs blockage vs downstream constraint). Mass balance reported every run.
- **pyswmm (validation path, offline):** export the pilot subnetwork to a SWMM `.inp` (`swmm_api`), run the same storm, compare which nodes flood and peak node depths; report agreement honestly. W6's test failed on a `swmm_api` API mismatch — the engine installs on Windows in seconds (`pyswmm 2.1.0`, `swmm_api 0.4.74` in the scratchpad venv); the authoring code must be fixed.
- **Rejected as the live engine:** SWMM alone (awkward 2D coupling, opaque to judges in 48 h); CascadeFloodNet `hydro_engine.py` (undocumented `*15` and `*1.6` factors, no blockage, no 2D).

### D-08 — ML/GNN: not in MVP
- Physical baseline first. CascadeFloodNet weights were trained on a fictional 20-node basin (`disastr/AUDIT_SIH26085.md`) and are never used or cited as Mumbai validation. If time remains after P1, a surrogate may be trained on our own simulator output with reported metrics — otherwise nothing.

### D-09 — Surface routing: simplified 2D storage-cell scheme
- Each grid cell holds a water depth; flux between 4-neighbours driven by water-surface-elevation difference with a Manning-type resistance and an explicit stability limit; buildings are no-flow obstacles; runoff enters per cell from D-05 × imperviousness; exchange with drainage nodes at inlet cells (D-07). Mass conserved to floating-point; conservation error reported. Grid 10 m default (≈46 k cells for the pilot), 5 m optional. Internal Δt adaptive (seconds); output frames every 5 min over 0–180 min.
- **Not** full shallow-water equations, and we say so. **Fallback:** D8 flow accumulation into terrain sinks with volume filling (quasi-steady), if the dynamic scheme is unstable under time pressure.

### D-10 — Database: none
- Pre-processed inputs as JSON/NPZ under `data/processed/pilot/`; simulation results in memory + optional NPZ cache. Nothing in the requirements needs a database.

### D-11 — GIS framework
- Processing: `numpy`, `scipy`, `shapely`, `pyproj`, `networkx` only. No rasterio/GDAL (no wheels-fight on Windows; not needed when the DTM is built from contour vectors).
- Web map: **Leaflet 1.9** via CDN, vanilla ES-module JS, one HTML page served by FastAPI static files. OSM tiles with mandatory attribution; if tile-usage policy is a concern for the demo, cache tiles or use a permissive provider. Reason: zero build step, fewest failure points, per the "reproducible demo" priority. CSS may be borrowed from `disastr/web/styles.css` (MIT declared in README, no LICENSE file — attribute).

### D-12 — Routing: OSM + own Dijkstra
- Overpass extract of `highway=*` within the pilot bbox (+ margin) → networkx DiGraph with `oneway` respected; edge cost = length × penalty(depth_cm at time t, vehicle class); depth ≥ vehicle threshold ⇒ edge removed. Time-aware option: use the frame at the estimated arrival time (PRD R18.5, [PROPOSED]). ODbL attribution mandatory.

### D-13 — Deployment: single local process
- `uv`-managed venv in `backend/.venv`; `uvicorn floodnet.api.main:app`; static frontend under `frontend/`; all datasets pre-processed to disk so the demo never depends on BMC/Overpass/Open-Meteo being reachable. Docker optional, later.

---

### D-14 — Radar: PATH D (blocked for defensible quantitative use); ECMWF stays the only live provider
- **Decided 2026-09-10**, on evidence from a dedicated IMD-API investigation plus an independent adversarial
  review that re-fetched and re-measured every claim. Full evidence: `docs/LIVE_RAINFALL_AUDIT.md` §8b/§8c.
- **No radar decoder will be built.** IMD documents no radar endpoint (dead index anchor, body ends at §20).
  The public `sri_mum.gif` genuinely *is* mm/hr Surface Rainfall Intensity with a published Z-R relation
  (correcting an earlier claim in this repo that it was reflectivity-only) — but its **top bin is open-ended
  at `>100 mm/h`, below this project's own `cloudburst` (120 mm/h) and `july2005` (190.3 mm/h) intensities**,
  with ±3.33 mm/h quantisation and ~12.5% coastline occlusion over the pilot. Decoding a rendered
  visualisation is a lossy reconstruction of a picture, not an observation, and must never carry an
  observation-class provenance tag.
- **No historical hindcast is possible** from free sources: no archive, directory listings 403, ~3 Wayback
  captures in six years.
- **Rejected PATH C** ("access exists but quantitative rainfall unavailable") as an understatement that would
  invite building the decoder anyway; PATH A contradicted; PATH B dead.

### D-15 — The SR-01 gap is in our own engine, not only in IMD access
- **Decided 2026-09-10.** `contracts.RainfallScenario.intensity_mm_h` is `[T]` and `intensity_at()` returns a
  `float`, which `engine.run_simulation` hands to `runoff_fn`. **Rainfall is spatially uniform by
  construction for every provider.** FloodNet cannot ingest a gridded rainfall field from any source, so
  acquiring radar data would not by itself satisfy the "high-resolution/gridded" half of SR-01.
- Generalising `RainfallScenario` to an optional `[T, ny, nx]` field is the honest prerequisite. **Not
  implemented, not scheduled** — recorded so the requirement is never reported as merely data-blocked.

## Decisions deliberately NOT made
- Whether to extend from Pilot A to box E (decide after measuring runtime at 10 m).
- Depth severity thresholds — provisional bands (5/15/30/60 cm) are carried over from the Antigravity code **as working thresholds, not cited guidance**; label them so until a source is found.
- Any live IMD integration.
- **OPEN LICENCE QUESTION (2026-09-10):** whether IMD's public radar imagery at `mausam.imd.gov.in/Radar/`
  may be programmatically retrieved/retained for non-commercial research. `copyRightPolicy.php` and
  `termscondition.php` both 404, while `/responsive/disclaimer.php` asserts "© Copyright 2026 India
  Meteorological Department" with **no licence grant**; the official supply route (`radarapi.imd.gov.in`,
  Radar Division, `radarlab@gmail.com`) requires an account, a data request and **payment**, and its terms
  are behind login. **No capture or harvesting job has been started, deliberately.** Resolving this needs a
  written enquiry to the Radar Division — a human action. Do not start harvesting before it is answered.

## Superseded external artefacts
- `Desktop/disastr/DATA_AUDIT_MUMBAI.md` — its central claim (BMC pipe data not public) is **wrong**; do not cite it.
- `Desktop/floodnet-sih2026` — Neo4j/Supabase/Redis/OSRM/Mapbox stack and the 3-node synthetic topology are superseded. Reusable ideas: in-memory server pattern, severity/passability helpers, dashboard layout.

## Decision log

| Date | # | Decision | Basis |
|---|---|---|---|
| 2026-09-08 | D-01 | Mumbai | Project direction |
| 2026-09-08 | D-02…D-13 | As above | Research round (`research/mumbai/`), lead re-verification of D-02/03/04/05 facts, and project direction on repo + engine (Sih-2026 canonical; hybrid engine) |
