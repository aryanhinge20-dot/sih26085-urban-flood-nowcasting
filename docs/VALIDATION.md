# VALIDATION — SIH26085 Mumbai pilot (Hindmata / Dadar)

Generated 2026-09-09, commit range from `bf92843`. This document is the scientific sanity + validation
pass requested after the end-to-end vertical slice. It reports what was actually measured, on the real
Mumbai data described in `docs/STATUS.md`, `docs/DECISIONS.md`. **No accuracy score is claimed or implied
anywhere below.** Detail documents: `docs/validation/EXTREME_DEPTH.md`, `FLOODING_SPOTS.md`, `SWMM.md`,
and the machine-readable `*.json` files alongside them.

## 1. What is actually validated

Nothing in the statistical sense (no ground-truth depth/timing dataset exists for this pilot — see §4).
What *is* validated, with evidence:

- **Mass conservation** — every simulation run closes its water budget (rain → runoff → surface storage +
  network storage + outfall discharge + boundary outflow + infiltration) to numerical precision
  (`|error| < 1e-9 %` observed, well under the 0.1% test threshold), including under the newly added open
  boundary and under drainage blockage. This is a structural/implementation check, not a check against
  reality — but it is a hard requirement any physically coherent model must pass, and it does.
- **Behavioural monotonicity** — across four independent scenarios spanning 20 → 380 mm/h-equivalent
  storms, runoff volume, surface water stored, drainage surcharge, and the count of flooded (≥15 cm) street
  segments all increase monotonically with rainfall. Drainage utilisation reaches its physical ceiling
  (edge_util → 1.0) before surcharge appears, in every scenario. This is the causal chain the task asked to
  verify; it holds (`docs/validation/demo_check.json`).
- **Directional response to blockage** — a 70% capacity reduction on the real network produces strictly
  more surcharge (45,751 → 124,981 m³), more surcharging nodes (186 → 424), more flooded segments (1,104 →
  1,197), and less outfall discharge (164,624 → 132,748 m³), on the same storm. This is the headline demo
  claim and it holds on the real Mumbai network, not just a toy fixture.

## 2. What is a sanity check (not validation)

- **Extreme-depth investigation** (`EXTREME_DEPTH.md`) — a structural audit of the DEM and the model's
  domain boundary that found and fixed two real issues (see §3). This improved defensibility but is not a
  check against an observed flood.
- **Flooding-Spot spatial comparison** (`FLOODING_SPOTS.md`) — checks whether the model's simulated
  ponding *coincides in space* with MCGM's own chronic-waterlogging inventory. This is a plausibility check
  on spatial pattern, explicitly **not** a depth or timing validation (the inventory carries neither).
- **Chitale (2005) named-location check** — qualitative only; the source document names roads/areas, not
  coordinates, depths, or times.
- **SWMM cross-check** (`SWMM.md`) — compares our solver against EPA SWMM DYNWAVE on the *same* real
  network and *same* per-node inflow. This checks internal consistency between two models, not either
  model against reality.

## 3. What is not validated, and why

There is **no publicly available, georeferenced, dated flood-depth or flood-timing observation for the
Hindmata/Dadar pilot** (`research/mumbai/FLOOD_GROUND_TRUTH.md`). The two real data sources available —
MCGM's Flooding Spots (undated, ~2017 vintage, chronic inventory) and the Chitale Committee's narrative
account of 26 July 2005 (named locations only) — support spatial-plausibility and qualitative checks, not
a quantitative validation. This is a data availability limit, not a choice we made; it was explicitly
verified during the earlier research round (`research/mumbai/FLOOD_GROUND_TRUTH.md` §5).

## 4. Real observations / data used

| Data | Real / estimated | Detail |
|---|---|---|
| Drainage network geometry, connectivity, sizes, inverts, ground levels | **REAL** | MCGM ArcGIS REST, 1,233 nodes / 1,134 `Existing` conduits in the pilot; 0 nulls, 100% referential integrity |
| Terrain | **REAL, interpolated** | MCGM 20 cm contours (2,678 polylines) + manhole ground levels → 10 m DTM; agrees with 1,205 independent manhole surveys to mean +0.012 m / SD 0.283 m |
| Roads, buildings | **REAL** | OpenStreetMap (ODbL), 2,978 road segments, 13,320 building cells |
| Flooding hotspots | **REAL**, undated | MCGM Flooding Spots layer, 21 in-pilot (5 active) |
| 26 July 2005 rainfall | **REAL**, gauge ~10 km from pilot | Santacruz hourly series transcribed from the Chitale Committee report (380.8 mm / 3 h) |
| Manning n, inlet capacity, manhole storage area, impervious fractions | **ESTIMATED** | Cited rules/ranges (Chow 1959, HEC-22); see module docstrings |
| moderate / heavy / cloudburst storms | **SYNTHETIC** | Stress-test scenarios, not observations |
| Blockage scenarios | **SYNTHETIC** | Never presented as an observed drainage condition |

## 5. Modelled outputs (this pass)

Full 180-minute runs, real pilot, no blockage unless noted (`docs/validation/demo_check.json`):

| Scenario | Runoff in (m³) | Surface stored peak (m³) | Peak surcharge nodes | Segments ≥15cm (peak) | Max cell depth, all cells | Max cell depth, DEM-reliable cells only | Mass-balance error |
|---|---|---|---|---|---|---|---|
| moderate (20 mm/h × 2h) | 201,302 | 125,091 | 20 | 508 | 1.79 m | — | 1.2e-12 % |
| heavy (50 mm/h × 2h) | 503,256 | 297,966 | 186 | 1,104 | 2.69 m | **2.15 m** | −2.4e-12 % |
| cloudburst (120 mm/h pulse) | 377,888 | 221,361 | 218 | 1,027 | 2.62 m | — | −8.5e-13 % |
| july2005 (Santacruz replay, 380.8 mm/3h) | 1,916,399 | 1,351,689 | 371 | 1,917 | 8.92 m | **5.70 m** | 1.1e-12 % |
| heavy + 70% blockage | — | — | 424 | 1,197 | — | — | −3.8e-12 % |

The remaining gap between "all cells" and "DEM-reliable cells" (2.15 m / 5.70 m even after excluding the
407 flagged cells) is still severe. For `heavy` (a 100 mm two-hour storm on a low-lying, densely built,
partly network-undersized catchment) this is plausible. For `july2005` — a >200-year event that
historically produced >1 m depths at multiple named locations across Mumbai per the Chitale report — 5.70 m
is high even acknowledging the storm's severity, and should be treated as an **open question, not a
settled result**: the storage-cell surface scheme has no lateral momentum, so water pooling in a
topographically constrained pocket next to buildings can rise further than a full shallow-water solver
would predict, because it cannot spread as efficiently. This is recorded as a limitation (§9), not
resolved in this pass.

## 6. Agreement

- **Behavioural / mass-balance checks**: full agreement — every check in `demo_check.json` passes (16/16).
- **Flooding Spots, `heavy`**: 3 of 5 active spots DETECTED (≥15 cm), 0 marginal, 2 missed, against a base
  rate of 20% of cells ≥15 cm — i.e. detection is meaningfully above the base rate for this scenario.
- **Flooding Spots, `july2005`**: 5 of 5 active spots DETECTED, but the base rate is 60% of cells ≥15 cm at
  peak — **the report itself flags this as uninformative**: at that base rate, most locations would score
  DETECTED regardless of the model's skill.
- **Chitale named locations**: every matched term (hindmata, ambedkar, lakhamsi, king, tilak, senapati
  bapat, parel, matunga, dadar) scores DETECTED under `july2005`, again against a high base rate (68.7% of
  all pilot road segments ≥15 cm) — consistent with, but not strong independent confirmation of, the
  historical account that this was a citywide event.
- **SWMM edge ranking**: Spearman ρ = 0.74 on peak conduit flow between our solver and SWMM DYNWAVE (same
  inflow) — the two models broadly agree on which pipes carry the most flow.

## 7. Disagreement

- **Flooding Spots, `heavy`**: 2 of 5 active spots MISSED, both diagnosed (`FLOODING_SPOTS.md`) — one has a
  nearby drainage node that never surcharges in the model (the model believes local capacity is adequate at
  a moderate storm), one sits at/near a railway station where a 10 m DTM cannot resolve the true
  underpass/track-level geometry.
- **SWMM node-level agreement is weak**: Jaccard 0.10 on the set of surcharging nodes (60 shared of 583
  union), Spearman ρ = 0.40 on peak node depth, flooded-volume ratio 12.0× (our solver floods far more),
  outfall-volume ratio 0.56× (SWMM discharges more). This is expected and explained in `SWMM.md`: our
  solver is a capacity-limited storage scheme (spills the instant full-bore capacity is reached, no
  backwater, no reverse flow); SWMM DYNWAVE solves Saint-Venant and can carry a conduit above full-bore
  under surcharge head. **The two models should not be expected to agree quantitatively**, and they don't;
  what matters is that the disagreement is explained by a known, documented physical simplification, not
  an unexplained bug.
- **Extreme depth**: 407 grid cells (0.65% of the pilot) produce depths inconsistent with the surrounding
  surveyed drainage network; flagged, not corrected (§3, §9).

## 8. Major uncertainties

1. **DEM uncertainty** — the DTM is contour-derived (20 cm official MCGM contours), agrees with 1,205
   independent manhole surveys to SD 0.283 m pilot-wide, but 407 cells (0.65% of the grid) are flagged as
   inconsistent with the surveyed network by more than 3 m and are excluded from headline depth claims,
   never altered. Vertical datum is mTHD; the offset to MSL is unverified (immaterial within the pilot
   since terrain and network share the same datum, but it blocks any future tide-boundary work).
2. **Drainage-data assumptions** — real geometry/connectivity/sizes/inverts throughout; Manning's n (0.013),
   manhole storage area (1.5 m²), and inlet capacity (0.05 m³/s/node) are cited estimates, not measured or
   calibrated. 27 of 116 outfalls are a confluence of multiple real conduits (handled correctly in both
   the live solver and the SWMM export, see `SWMM.md`). Outfalls are treated as unrestricted (no tide/
   tailwater boundary condition), which is optimistic for any outfall subject to tidal backup.
3. **Rainfall assumptions** — three of four scenarios are explicitly synthetic stress tests. `july2005` is
   a real gauge series but from a station ~10 km from the pilot, applied uniformly across the 4.7 km² area
   (no spatial structure). No true 0–3h radar nowcast exists publicly for Mumbai (`research/mumbai/
   RAINFALL.md`); this remains a design choice recorded in `docs/DECISIONS.md`, not something this pass
   changes.
4. **Surface-routing scheme** — a simplified storage-cell/diffusive scheme (Bates & De Roo 2000 family),
   not a full shallow-water solver. No lateral momentum. This is very likely the dominant cause of the
   still-high `july2005` reliable-cell max depth noted in §5.
5. **Boundary condition** — a free-outfall open boundary was added this pass (§9) using the local terrain
   slope as a proxy friction slope; this is a modelling choice to remove a clip-window artefact, not a
   measured boundary condition, and its exact discharge rate is not independently checked against anything.

## 9. This pass's changes (Task 1/2 summary — full detail in `EXTREME_DEPTH.md`)

Two issues were found and fixed, **without modifying the DEM**:

1. **DEM-reliability flagging** — 7 depressions / 407 cells (0.65% of the grid) sit >3 m below every
   surveyed manhole ground level within 250 m; contour vertices confirm these low elevations are genuinely
   present in MCGM's source data, so they were not altered — only flagged
   (`floodnet/terrain/pits.py::dem_reliability_mask`, recorded in `terrain.json["pit_handling"]`,
   `data/processed/pilot/dem_reliability_mask.npz`).
2. **Open domain boundary** — the pilot is a window clipped out of Mumbai; the surface model's boundary was
   closed, causing water to pond artificially against the clip line where terrain genuinely slopes outward
   (83% of the low-elevation corridor sits within 200 m of the grid edge). A free-outfall boundary
   condition was added (`floodnet/terrain/surface.py`, `open_boundary=True`, now the default in the live
   API), with its cumulative outflow tracked as a new `MassBalance.boundary_out_m3` term so the water
   budget still closes exactly. Effect on `heavy`: max cell depth 2.82→2.69 m; excluding flagged cells,
   2.15 m either way.

Both changes are covered by `backend/tests/test_pits.py` (5 tests: DEM never mutated, boundary touches only
outward-sloping edge cells, mass balance still closes with the new term, a genuine large depression is
neither flagged nor drained away, depression reporting works) and the full suite (64/64 passing).

## 10. Demo safety (Task 6)

`backend/scripts/demo_check.py` ran all four scenarios plus a 70%-blockage comparison, end to end, against
the live API and frontend. **16/16 checks pass**: runoff/surface-water/surcharge/flooded-segments all
increase monotonically with rainfall; drainage utilisation and surcharge appear together; blockage produces
more surcharge, more surface water, less outfall discharge, more flooded segments; the flood-aware router
correctly responds to flood weights (on the probed heavy-storm case, so many segments become impassable
that origin and destination are correctly reported unreachable — a real, useful result, not a router
failure); `/api/meta`, `/api/simulate`, `/api/route` and the frontend all load. Full data:
`docs/validation/demo_check.json`.

## 11. Why this is a prototype, not an operational warning system

- No lateral-momentum surface solver; a simplified capacity-based (not Saint-Venant) drainage solver.
- No calibration against observed depths or timings anywhere (none exist publicly for this pilot).
- Key hydraulic parameters (roughness, inlet capacity, storage area) are cited estimates, not measured.
- No tide/tailwater boundary condition at outfalls, despite Mumbai's flooding being frequently
  tide-coincident.
- Rainfall is either synthetic or a single non-local gauge applied uniformly; no real 0–3h nowcast.
- A small but real fraction of the DEM (0.65%) is flagged as unreliable rather than resolved.
- The SWMM cross-check shows the two models materially disagree at node level, for physically understood
  but unreconciled reasons.

This is a scientifically defensible **prototype demonstrating the required coupled pipeline** — rainfall →
runoff → terrain → surface routing ⇄ real drainage graph → surcharge → street depth → GIS → flood-aware
routing — on real Mumbai data, with every simplification and every estimated parameter labelled. It is not,
and does not claim to be, validated for operational flood warning.
