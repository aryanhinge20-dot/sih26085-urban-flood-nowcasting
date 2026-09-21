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
- *(Superseded in part by D-20 / D-21, 2026-09-18/21 — an experimental, clearly-labelled decoder now exists; the reasoning below is kept as the record of why it is only experimental.)*
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
- **✅ RESOLVED 2026-09-14 — the engine half of this gap is now closed.** `RainfallScenario` accepts an
  optional `intensity_field_mm_h` `[T, ny, nx]` plus `field_grid`; `intensity_field_at()` returns a per-cell
  field; `runoff_fn` accepts a scalar *or* a field; `engine.run_simulation` branches on
  `scenario.is_spatial`. Uniform scenarios keep the byte-identical original code path (verified: `intensity_at`
  equivalent on 1,509 samples; a constant field reproduces the scalar runoff total exactly; mass-balance
  error reproduces to the last digit). New module `floodnet/rainfall/gridded.py` does reprojection/resampling
  onto the model grid — the engine deliberately **refuses** a mismatched grid rather than silently regridding.
  24 new tests (`tests/test_spatial_rainfall.py`). **What remains blocked is DATA, not architecture** — see
  D-16. This is the honest inversion of the original finding: the engine is no longer the limiting factor.

### D-16 — Gridded rainfall source: GPM IMERG selected; it is NOT radar and does NOT resolve the pilot
- **Decided 2026-09-14**, after verifying eight candidate paths against their official sources.
- **Selected: NASA/JAXA GPM IMERG Early Run V07 (`GPM_3IMERGHHE.07`, GES DISC).** It is the only candidate
  that is simultaneously real, **verifiably CC0-licensed**, genuinely gridded `[time, lat, lon]` in mm/hr,
  covers Mumbai, and is programmatically downloadable with nothing but a free Earthdata Login. Implemented as
  `IMERGSatelliteProvider`; raises `ProviderUnavailable` (never a fabricated value) without `EARTHDATA_TOKEN`.
- **It is NOT ground radar and NOT a radar nowcast, and must never be labelled as either.** IMERG's pixels
  come from passive-microwave + geostationary-infrared sensors; a spaceborne radar (GPM DPR) enters only
  *indirectly*, as the radar half of the CORRA product used to intercalibrate those sensors. The only honest
  description is "satellite passive-microwave/infrared precipitation, intercalibrated against a
  spaceborne-radar reference".
- **It provides ZERO spatial variation across this pilot, and that is stated rather than hidden.** IMERG's
  0.1° cell is ~11.1 × 10.5 km (~117 km²) at 19°N. The pilot box (72.835–72.855 E, 19.010–19.030 N) is
  ~2.4 × 2.55 km (~6 km²) and falls **entirely inside one IMERG cell** (72.8–72.9 E / 19.0–19.1 N) without
  even straddling a boundary. Adopting IMERG is an upgrade in *provenance and temporal realism*, **not** in
  spatial detail. `gridded.describe_effective_resolution()` computes this automatically and writes
  "CANNOT resolve structure inside the pilot" into the scenario's provenance note; that note must not be
  edited out downstream.
- **Verification status of the network path:** product, resolution, cadence, licence, host and auth scheme
  were verified against NASA's own pages. The request path (GES DISC directory layout + IMERG granule
  filename pattern) follows documented convention but has **NOT been executed against the live service** — no
  Earthdata credential existed in this environment. Same honest status as `IMDObservationProvider`.
- **Rejected, with reasons:** IMD DSP radar supply (portal unreachable — TLS cert failure; cost/format/approval
  unverified; manual + paid, not achievable in a hackathon window); MOSDAC GSMaP (0.1°, same resolution
  limit, approval-gated signup, licence text unverifiable); INSAT-3D QPE (geostationary IR, not radar, specs
  unpublished); IMD 0.25° gridded (28 km, *daily* — useless for a 0–3 h nowcast); RainViewer/OpenWeather
  (colour map tiles, not mm/h arrays — the same quantisation problem that disqualified the IMD GIF);
  Open-Meteo higher-resolution models (no radar and no nowcast product for India; ~11–13 km native, and
  fanning out point queries would manufacture *fake* spatial variation from a coarse field — explicitly not
  done); IIT-Bombay's 4TU DWR dataset (real Indian radar, but **Chennai**, 269 KB, and **CC BY-NC-ND**, whose
  No-Derivatives term forbids building on it).
- **PATH G (validate the nowcasting algorithm on foreign radar) not taken.** `pysteps-data` offers real
  1 km / 5 min ground radar (MeteoSwiss verified), free and scripted — but licences for most subsets are
  unstated in the repo and the RMI subset is explicitly non-commercial. Deferred rather than adopted on an
  unverified licence, consistent with the same discipline applied to the IMD imagery in D-14.

### D-17 — Manhole plan area: adopt IS 4111 depth bands in place of a blanket assumption
- **Decided and implemented 2026-09-14.** The model used a single invented `STORAGE_AREA_M2 = 1.5` for all
  1,233 nodes ("typical chamber size; not in MCGM data"). **IS 4111 (Part 1) – 1986** (Code of practice for
  ancillary structures in sewerage system: Manholes) specifies chamber size *by depth*, quoted verbatim from
  law.resource.org: cl. 3.3.2 "For depths less than 0·90 m, 900 × 800 mm" and "For depths from 0·90 m and up
  to 2·5 m, 1 200 × 900 mm"; cl. 3.3.3 "For depths of 2·5 m and above … 1 400 × 900 mm".
- Applied via `mcgm.storage_area_from_depth()`, banding on each node's own depth (`node_ground − node_invert`,
  both REAL MCGM values) → 0.72 / 1.08 / 1.26 m². Distribution on the pilot: 24 / 980 / 229 nodes. Total
  chamber plan area falls **1,849.5 → 1,364.2 m² (−26.2 %)**.
- **Tag stays ESTIMATED, deliberately.** The dimensions are real and citable, but "MCGM's chambers conform to
  IS 4111" is an assumption about this network, not a measurement of it. IS 4111 cl. 3.3.4 equally permits
  *circular* chambers (0.64/1.13/1.77/2.54 m²); the rectangular series was chosen only because it is the one
  that covers the shallowest band without extrapolation. Both facts are in the provenance note.
- **This is a physics change and it moved the results** (validation gate, `heavy` + 70 % blockage, 180 min):
  peak depth 268.72 → **292.27 cm**, peak surcharging nodes 424 → **459**, total surcharge 124,981 →
  **133,020 m³**, mass-balance error −3.77e-12 → **−3.15e-12 %** (still conserving). Direction is physically
  coherent: less chamber storage → less buffering → more surcharge. **Figures published before 2026-09-14
  were computed with the old 1.5 m² and are superseded.**

### D-18 — Estimated parameters that could NOT be upgraded, and why
Recorded so these are never re-litigated from memory, and never "upgraded" with a number that does not
actually describe the quantity:
- **Manning's n (0.013 blanket).** No authoritative Indian value could be verified. IRC:SP:50-2013 was
  fetched in full and contains **no n-by-material table**; CPHEEO's manuals were unreachable
  (cpheeo.gov.in refused connection, mohua.gov.in 403, the 2019 manual exceeds fetch limits). A widely-quoted
  "0.014 concrete / 0.018 trapezoidal" attribution to CPHEEO 2019 could not be confirmed from a primary
  source, and a third-party compilation site self-describes as non-authoritative. **Kept at 0.013, ESTIMATED.
  The 62 British-era brick arch conduits were deliberately NOT switched to 0.015** — that change needs a
  source, and none was verified.
- **Inlet capture capacity (0.05 m³/s per node).** IS 7740-1985 (fetched) gives gully *geometry* only —
  spacing 18–36 m, 150/250 mm outlet — and **no discharge figure**. IRC:SP:50-2013 §3.2.4 (fetched) gives
  spacing ≤30 m and ≥600 mm gutter width, no capacity. FHWA HEC-22 provides a *method*, not an Indian value.
  **No Indian standard states a per-inlet capture rate. Kept at 0.05, ESTIMATED.**
- **DEM.** Every free alternative verified (Copernicus GLO-30, JAXA AW3D30, SRTM/NASADEM, CartoDEM) is 30 m
  and a *surface* model including buildings. The existing 20 cm-contour-derived 10 m DTM is **better**, and is
  kept. No public Mumbai LiDAR was found.
- **Tidal/tailwater boundary.** PSMSL station 43 (Apollo Bandar, 1878–2024) publishes **monthly means only** —
  unusable as a hydraulic boundary. INCOIS tide endpoints 404/DNS-failed. BMC's 2026 high-tide calendar gives
  peaks (4.89 m on 16 July; 4.5 m concern threshold), which would support a tide-*coincidence scenario* but
  not a continuous series. **Still MISSING; scenario boundary remains a proposal, not implemented.**
- **Runoff coefficient — a real source exists but was NOT applied.** IRC:SP:50-2013 §6.4.1, describing
  **Mumbai's own practice**, states verbatim: *"The runoff coefficient adopted in fully developed area is 1.0.
  In less developed areas the coefficient is worked out which may range between 0.58 to 1.0."* This is
  strictly better provenance than the current generic ASCE/Chow C_imp=0.95 / C_perv=0.35. **Not adopted in
  this pass**: C=1.0 is a *design* coefficient for drain sizing (deliberately conservative, zero losses), and
  adopting it would change every published flood figure a second time. Recorded here as an available,
  evidenced upgrade requiring the full validation gate and an explicit owner decision — not silently applied.
- **Imperviousness raster — a real source exists but was NOT applied.** **ESA WorldCover 10 m v200 (2021)**,
  CC BY 4.0, *"provided free of charge, without restriction of use"*, downloadable with no registration
  (`aws s3 sync s3://esa-worldcover/v200/2021/map --no-sign-request`), matches the model's 10 m grid exactly
  and would replace the current OSM-geometry rule with its flat 0.6 default. Not applied in this pass because
  it is a new data-ingestion path plus a full pilot rebuild and revalidation. **Highest-value remaining real-data
  upgrade.**

### D-19 — RADAR INTEGRATION BLOCKED BY DATA ACCESS (final exhaustive search, 2026-09-14)

**Status: BLOCKED. Not by architecture — by data access and licensing.** A final search targeting *only*
genuinely radar-derived rainfall for Mumbai (explicitly excluding satellite QPE, NWP, gauges and colour
tiles) checked nine avenues. **No genuinely radar-derived, Mumbai-covering, legally-usable,
programmatically-obtainable rainfall dataset with the temporal continuity a 0–3 h nowcast requires
exists.** Nothing was implemented as a substitute, deliberately.

**New, actionable facts about the IMD route (this is the closest path to viable):**
- Mumbai is served by **two** IMD radars: a **Colaba S-band** and a **Veravali C-band**.
- `dsp.imdpune.gov.in` (fetched) routes radar via *"[For RADAR Data, Click Here](https://radarapi.imd.gov.in)"*,
  contact **radarlab@gmail.com**, **+91 (11) 2434-4281**.
- **Registration is open to individuals** — not MoU-gated as previously assumed. The registration form lists
  category *"S - Students (Students (up to post-graduation level)…)"* and *"I - Research and Educational
  Institutes"*, and states: *"Registration will be complete after Email Verification, one-time submission of
  Identity Card and/or Certificate of Undertaking."*
- **Radar is chargeable.** IMD's free-data page lists only All-India monthly/seasonal temperature, All-India
  monthly/seasonal rainfall, and cyclonic-system frequency. The cost-estimate page's data types are
  *"Surface Rainfall Autographic Upper Air (PB) Upper Air (RS) Upper Air (RW) Agromet Radiation"* — **no
  radar row**; radar is diverted to the email contact above.
- **The specific technical blocker is a broken TLS certificate chain on `radarapi.imd.gov.in`** (error:
  *"unable to verify the first certificate"*), not a 404. The radar product catalogue (volume scan / CAPPI /
  MAX-Z / rain rate), formats and prices therefore remain **UNVERIFIED**.

**Two candidates that are genuinely radar but were still rejected, with reasons:**
- **CEDA INCOMPASS v2** (`catalogue.ceda.ac.uk/uuid/b28633ddc0f44d77a6aa81ad7bd66285`, DOI
  10.5285/b28633ddc0f44d77a6aa81ad7bd66285). Genuinely **IMD DWR-derived and Mumbai is explicitly one of its
  sites**, licensed **OGL v3** (open), downloadable with a free CEDA account. **Rejected because it is a
  convective-cell OBJECT TABLE, not a field**: its variables are *"datetime …, CTH [m], size [km], latitude
  [N], longitude [E], cell 2 km mean reflectivity [dBZ]"*, BADC-CSV, 14 May–30 Sep 2016 only. Reconstructing
  a `[T, ny, nx]` rainfall field from cell centroids and a single mean reflectivity per cell would require
  **inventing the intra-cell spatial structure** — that is fabrication, and it is why this was not used
  despite being the only open-licensed genuine Mumbai radar product found.
- **GPM DPR (2ADPR)** — genuinely a spaceborne **precipitation radar** (Ku 245 km swath / Ka 125 km), truly
  quantitative (`precipRateESurface2`, mm/hr), 5 km, openly licensed under EOSDIS guidance, scriptable from
  GES DISC with a free Earthdata Login. **Rejected for this requirement on two independent grounds:**
  (a) **revisit** — the GPM Core Observatory is non-sun-synchronous and crosses a fixed point only of order
  ~10 times a *month*, i.e. gaps of days; it cannot drive a continuous 0–3 h nowcast under any scheme;
  (b) **resolution** — at 5 km, the 2.4 × 2.55 km pilot is *smaller than a single DPR footprint*, so it would
  again contribute no intra-pilot spatial variation, and most overpasses miss the pilot entirely.
  **Deliberately not implemented:** a second credential-gated, untestable downloader that can satisfy neither
  the nowcast horizon nor the spatial requirement is complexity without a requirement to justify it
  (CLAUDE.md rule 7). Recorded here so the option is visible and can be overruled, not lost.

**Also checked and excluded:** MOSDAC TERLS DWR (real 1 km volumetric C-band radar, but **Thumba, Kerala** —
wrong city); IITM Pune / NARL Gadanki (radars at Solapur and Gadanki, no public data portal found);
data.gov.in (**HTTP 403 to automated fetch ×3 — UNVERIFIED**; no radar dataset surfaced by search, and IMD's
own page indicates data.gov.in mirrors its *free* set, which excludes radar; the only Indian-radar items on
open repositories are station-coordinate metadata, not measurements); WMO radar-data exchange (a standards
and coordination activity — *"developing a data model and standardized format for international exchange"* —
with no downloadable archive and no India holdings); TRMM PR 2A25 (genuine radar but mission **ended 2015**,
same sparse-revisit problem).

**Consequence for the product:** the completed spatial-rainfall architecture (D-15 resolved, D-16) is
preserved as a **ready integration boundary**. `IMDRadarNowcastProvider` remains the honest, inert place a
real feed attaches; its docstring's former "the engine could not ingest it anyway" blocker is now struck
through, because that is no longer true. **The remaining blockers are entirely data access and licensing.**

**The single human action that would unblock this:** register at
`https://dsp.imdpune.gov.in/home_registration_form.php` under category **"S - Students"** or **"I - Research
and Educational Institutes"** (email verification + Identity Card / Certificate of Undertaking), then email
**radarlab@gmail.com** requesting archived **Mumbai DWR (Colaba S-band and/or Veravali C-band)** volume scans
or CAPPI/MAX-Z for a named monsoon period, stating format and intended academic use, and asking for a cost
estimate. This is a human action requiring an identity document and payment; it cannot be automated, and
**no harvesting of IMD imagery has been started as a workaround** — consistent with D-14.

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

### D-20 — Experimental radar-IMAGE-derived rainfall from the public Mumbai-Veravali SRI product (2026-09-18)
- **Decision (project direction, 2026-09-18):** build `IMDVeravaliSRIImageProvider`, which decodes IMD's public SRI GIF into a `[T, ny, nx]` field labelled `RADAR_IMAGE_DERIVED_ESTIMATE`. This partially supersedes D-19's "do not harvest" — the Radar Division enquiry is still unanswered.
- **Basis:** api.imd.gov.in has no radar API (IMD confirmed); the image carries its own legend, tick-marked axes and timestamp, which make a legend-bin decode and tick-fitted georeference checkable (evidence: `docs/RADAR_SRI_IMAGE.md`).
- **Limits kept explicit:** not IMD QPE, not validated, legend-bin precision only, two bins excluded, one frame so no extrapolation (3-hour persistence), native resolution unknown, reuse terms unconfirmed (image not committed; low-frequency cached fetch).
- **SR-01 remains PARTIAL:** a genuine numerical IMD radar product is still the goal (DSP request).

### D-21 — Experimental radar-image nowcast + source-aware horizon (2026-09-21)
- **Decision:** add a gated Lagrangian-persistence nowcast (single-vector cross-correlation on the DECODED rain
  field, rigid advection, ≤ 30 min) and record which source drives each forecast period
  (radar 0 → nowcast 5–30 → ECMWF or persistence 30–180). Evidence, method, refusals: `docs/RADAR_NOWCAST_STATUS.md`.
- **Basis:** the public animation GIF carries one timestamp for 19 frames (found to be 19 identical stale copies),
  so FloodNet keeps its own timestamped frame history instead. Dense optical flow was rejected as over-precise
  for legend-bin input.
- **Honest status:** logic-tested on a generated stand-in; not yet run on two consecutive real scans; no skill
  claimed; never called an IMD nowcast. SR-01 remains PARTIAL.

### D-22 — Tide boundary: [UNDECIDED], not implemented (2026-09-21)
- No synthetic tide. Sources audited (INCOIS view-only; Survey of India PDFs need written permission; MCGM list
  not machine-readable; no Mumbai station in UHSLC/IOC; PSMSL monthly only; FES2022/TPXO need registration and
  harbour validation). Summary in `docs/TECHNOLOGY_EXPLAINER.md`. Revisit after written permission / FES2022
  registration; the drainage solver's outfall boundary would also need a stated design first.

## Superseded external artefacts
- `Desktop/disastr/DATA_AUDIT_MUMBAI.md` — its central claim (BMC pipe data not public) is **wrong**; do not cite it.
- `Desktop/floodnet-sih2026` — Neo4j/Supabase/Redis/OSRM/Mapbox stack and the 3-node synthetic topology are superseded. Reusable ideas: in-memory server pattern, severity/passability helpers, dashboard layout.

## Decision log

| Date | # | Decision | Basis |
|---|---|---|---|
| 2026-09-08 | D-01 | Mumbai | Project direction |
| 2026-09-08 | D-02…D-13 | As above | Research round (`research/mumbai/`), lead re-verification of D-02/03/04/05 facts, and project direction on repo + engine (Sih-2026 canonical; hybrid engine) |
