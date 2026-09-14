# VALIDATION — SIH26085 FloodNet, Mumbai pilot (Hindmata / Dadar)

**Independent validation audit. Rewritten 2026-09-10.** Supersedes the 2026-09-09 version, which this pass
re-verified line by line by re-running the code. Where the earlier version's claims did not survive
re-measurement they have been **corrected, and the correction is flagged** — see §8.

Everything below was produced by running the repo's own code with `backend/.venv/Scripts/python.exe` on the
real pilot data. Detail documents: `docs/validation/EXTREME_DEPTH.md`, `FLOODING_SPOTS.md`, `SWMM.md`, and the
`*.json` files alongside them.

> ### The one-line answer
> **FloodNet's accuracy has not been measured, because no dataset exists to measure it against. What has been
> verified is that its numbers are internally consistent — not that they are right.** The full quotable answer
> is in §7.

---

## 0. The single most important methodological point

**Mass conservation is NOT prediction accuracy.**

FloodNet's water budget closes to ~1e-12 %. That number is real, reproducible, and worth stating — but it
validates *accounting*, not *reality*. It proves the solver does not create or destroy water. A model that
predicted 4 m of flooding on a hilltop would still close its mass balance perfectly. Mass balance is a
necessary condition for a physically coherent model and a hard bug-catcher; it is **not evidence that any
predicted depth, location, or time is correct**, and it must never be quoted in answer to "how accurate is it?"

Two corollaries that apply throughout this document:

- **Visual plausibility is not accuracy.** A flood map that "looks right" over Hindmata is not a measurement.
- **Model-vs-model agreement is not accuracy.** The SWMM cross-check (§1.C) compares two models to each other.
  Both can be wrong in the same direction, and on this network they substantially disagree anyway.

---

## 1. WHAT HAS BEEN VALIDATED

Only categories A, B(partial) and C below contain measured results. Everything in §2 has not been validated.

### A. Numerical correctness — **VALIDATED**

Re-measured this pass by running each scenario twice on the real pilot (255 × 244 grid @ 10 m; 1,233 nodes /
1,134 conduits), 180-minute horizon.

**A1 — Mass conservation (full coupled engine).** Scenario `heavy` (50 mm/h × 2 h), all budget terms in m³:

| Term | Value (m³) |
|---|---|
| `rain_in_m3` | 622,199.9999999994 |
| `abstraction_m3` (runoff-coefficient loss) | 118,943.99602175748 |
| `runoff_in_m3` (net to surface) | 503,256.00397824193 |
| `surface_stored_m3` | 334,396.33243457164 |
| `network_stored_m3` | 435.5024182776268 |
| `outfall_out_m3` | 168,424.16912540427 |
| `boundary_out_m3` | 0.0 (see §5.6 — this run used the **closed** boundary) |
| `infiltration_m3` | 0.0 |
| **`error_m3`** | **−1.1583324521780014e-08** |
| **`error_pct`** | **−2.301676369524409e-12 %** |

Other scenarios, same horizon: `july2005` error_pct = **9.59801281578181e-13 %**; `moderate` error_pct =
**7.807193715723217e-13 %**. All are ~11 orders of magnitude inside the 0.1 % test threshold. This corroborates
the previously reported `-0.0` / `-3.77e-12` figures — same order, different run configuration.

**A2 — Drainage solver internal balance (standalone, same-inflow mode, 180 min).** Measured independently of
the surface model:

```
inflow      528,870.000 m3
stored            0.342 m3
outfall     280,228.258 m3
surcharge   248,641.400 m3
ERROR       1.862645149230957e-09 m3   (3.522e-13 %)
```

(The previously quoted "2.3e-10 m³ on 210,770 m³ throughput" is the same check at a different horizon; both are
at floating-point noise level.)

**A3 — Determinism.** `heavy` run twice in the same process, 37 frames each:

```
depth_bitwise_identical      : true      (max_abs_diff = 0.0 across all 37 frames)
street_bitwise_identical     : true
node_surcharge_identical     : true
error_pct_identical          : true      (-2.301676369524409e-12 both runs)
```

The model is bit-for-bit reproducible. No stochastic component.

**A4 — Solver stability / independent hydraulic engine. ⚠ PRIOR FIGURE CORRECTED; SEE THE NON-CONVERGENCE
DISCLOSURE.** EPA SWMM 5 (pyswmm 2.1.0) DYNWAVE runs on the exported network. The previous version of this
document reported "flow-routing continuity error **0.0000 %**" in three places. **That 0.0000 % was a
reporting artifact, not a measurement.** `floodnet/validation/swmm_compare.py:119` reads
`sim.flow_routing_error` *inside* the `with Simulation(...) as sim:` block, i.e. before SWMM's
`swmm_end()` has computed the mass-balance summary. Verified directly against pyswmm 2.1.0 / SWMM 5.2.4 on
the committed `heavy_direct.inp`:

```
inside the with-block, before swmm_end()   ->  0.0                     <- what swmm_compare.py:119 reads
inside the with-block, after  swmm_end()   -> -0.006075585726648569
after Simulation.execute() (already closed) ->  0.0
```

The attribute is simply not populated at the point the code samples it, so the reported value was `0.0`
regardless of what the solver did. The real figures are in the committed SWMM report files, which SWMM
itself wrote:

| Run | File | Flow-routing continuity error | Runoff continuity error | % of steps **not converging** | Avg iterations/step |
|---|---|---|---|---|---|
| `heavy_direct` (**the run used for the §1.C comparison**; same-inflow mode) | `data/processed/pilot/swmm/heavy_direct.rpt` | **−0.008 %** | 0.000 % (no subcatchments) | **68.77 %** | 6.22 |
| `heavy` (standalone reference; SWMM's own subcatchment runoff) | `data/processed/pilot/swmm/heavy.rpt` | **−0.009 %** | **−0.370 %** | **66.46 %** | 6.09 |

A −0.008 % routing continuity error is still an excellent, entirely normal SWMM result — the correction is to
the *precision claimed*, not to the conclusion that the exported `.inp` is well-posed.

**The non-convergence is the material finding, and it was not disclosed before.** In the comparison run SWMM
failed to converge within its 8-iteration limit on **68.77 % of routing steps**; five named junctions
(`2171039205`, `2171039208`, `2171039210`, `2171039211`, `2172030502`) are non-converging that often each, the
worst link flow-instability index is the maximum value of 100 (`Link 18098`), one node carries a 1.39 %
continuity error on its own, the adaptive time step collapses from the nominal 5 s to an average of 0.53 s
(minimum 0.01 s), and a single link (`2173048204_COLLECT`) is the time-step-critical element for 72.67 % of
the run. **This materially weakens SWMM's standing as the reference model in §1.C.** Global continuity can
close to −0.008 % while local dynamics are poorly resolved, so the §1.C disagreement metrics (Jaccard 0.103,
ρ 0.400 / 0.743, 12.02× flooded volume) must be read as "FloodNet vs a SWMM run that is itself straining on
this network", not as "FloodNet vs ground truth". *(The 0.0 read is a defect in `swmm_compare.py`, which this
pass does not own; it was not fixed here. The `.rpt` figures above were read directly from the committed
files and are independent of the buggy code path.)*

**A5 — Regression suite.** `pytest` on `backend/`: **136 passed, 4 skipped** in 79 s. (The 4 skips are the
opt-in live-network smoke tests.) **Re-run 2026-09-14 (final validation pass): 169 passed, 4 skipped, 0
failed** (130–226s) — the count grew from 136 to 169 across this session's accumulated work (CAP alerts,
provenance fixes, routing fixture tests); still zero failures, same two live-service opt-outs correctly gated.

### B. Data / input validation — **PARTIALLY VALIDATED (one prior claim withdrawn)**

**B1 — Drainage network topology — VALIDATED.** Executable assertions in `backend/tests/test_data_pilot.py`
on the built pilot: referential integrity of `edge_us`/`edge_ds` into `[0, n_nodes)`; `edge_length_m > 0`;
`edge_capacity_m3s > 0`; every outfall has out-degree 0 and **every non-outfall has out-degree > 0** (no
orphan nodes); no NaN in terrain `z`; `impervious ∈ [0,1]`. Full-population audit over all 34,431 MCGM nodes /
34,711 conduits (`research/mumbai/DRAINAGE.md` §161–182): 0 null `GROUND_LEV`/`NODE_ID`, 34,431/34,431 unique
IDs, **100.00 %** referential integrity on both `US_NODE_ID` and `DS_NODE_ID`, and **0 of 34,711 conduits with
invert above ground** — a genuine cross-table consistency result, since `GROUND_LEV` (layer 6) and `US_INVERT`
(layer 7) are separately served.

*Caveat:* the assertion `edge_slope > 0` is **vacuous** — slope is floored at `SLOPE_MIN` in
`floodnet/data/mcgm.py:158-160` before any test sees it. City-wide the source data contains 119 flat and 26
adverse-slope conduits; the pilot's floored count is recorded in provenance but never surfaced or asserted.

**B2 — DEM reliability flagging — VALIDATED.** 268 closed depressions detected; **7 flagged / 407 cells /
0.654 % of the 62,220-cell grid** (233 of those are non-building cells = 0.476 % of 48,900). Criterion: an
interior closed depression whose bottom lies > 3.0 m below the lowest surveyed manhole ground level within
250 m. Verified against `docs/validation/dem_reliability.json` and the committed mask
(`data/processed/pilot/dem_reliability_mask.npz`, `mask.sum() == 407`). The DEM is demonstrably **not**
modified (asserted in `backend/tests/test_pits.py`).

**B3 — DEM vertical accuracy — ⚠ NOT VALIDATED. PRIOR CLAIM WITHDRAWN.**
The previous version of this document stated the DTM "agrees with 1,205 **independent** manhole surveys to
mean +0.012 m / SD 0.283 m". The statistic itself is numerically reproducible (recomputed this pass:
N = 1,205, mean +0.0125 m, SD 0.2831 m, median +0.0195, min −2.321, max +1.170). **But it is not
independent — it is circular.** The same 1,233 manhole `GROUND_LEV` values were *inputs to the interpolation
that built the DTM* (`floodnet/data/build_pilot.py:42` → `floodnet/data/contours.py:120-125`, `scipy.griddata`
`method="linear"`, which is an exact interpolator at its input vertices). The residual is non-zero only
because the DTM is sampled at cell centres up to 7.07 m from the constraining manhole; it scales with exactly
that offset (mean |residual| 0.104 m at 0–2 m separation rising to 0.219 m at 4–6 m).

What that number measures is **DTM self-consistency / within-cell sampling error**, not vertical accuracy
against withheld ground truth. It is still a useful smoke test — it would catch a datum shift, a unit error,
or a gross blunder — but it cannot support an accuracy claim, and the true independent error is almost
certainly **worse** than SD 0.283 m. Closing this gap requires leave-one-out or hold-out cross-validation
(rebuild the DTM excluding a manhole subset, then test against it). No such code exists in the repo.

### C. Hydraulic cross-validation vs EPA SWMM — **MEASURED, AND IT SHOWS SUBSTANTIAL DISAGREEMENT**

Re-run independently this pass (pyswmm 2.1.0, DYNWAVE, `ALLOW_PONDING NO`, routing step 5 s; both models
driven by the *identical* per-junction hydrograph Q = 0.85·i·A, A = 0.5570 ha, bypassing the 2D surface).
All figures reproduced the committed `docs/validation/SWMM.md` exactly:

| Metric | FloodNet | SWMM DYNWAVE | Score |
|---|---|---|---|
| Surcharging junctions (>1 m³) | 577 | 66 | **Jaccard 0.1029** (60 shared / 583 union) |
| Node peak depth, rank agreement | — | — | **Spearman ρ = 0.400** (p = 2.8e-44) |
| Edge peak flow, rank agreement | — | — | **Spearman ρ = 0.743** |
| Flooded volume (m³) | 248,641 | 20,680 | ratio **12.02×** |
| Outfall volume (m³) | 280,228 | 496,539 | ratio **0.564×** |
| Median peak-depth ratio (837 nodes wet in both) | — | — | **2.13×** |
| Flow-routing continuity error | — | **−0.008 %** (`heavy_direct.rpt`; the previously printed "0.0000 %" was a code artifact — §1.A4) | — |
| **% of routing steps not converging** | — | **68.77 %** | ⚠ SWMM is straining on this network — §1.A4 |

**What this actually means.** The two models agree well on *which pipes carry the most flow* (ρ = 0.743) and
poorly on *which nodes surcharge* (Jaccard 0.103) and *how much water leaves the network* (12× on flooded
volume). This is explained — not excused — by a known simplification: FloodNet is a capacity-limited storage
scheme that spills the instant full-bore capacity is reached, with no backwater, no surcharge head and no
reverse flow, whereas SWMM solves Saint-Venant and can carry a conduit above full-bore. The disagreement is
therefore *expected and diagnosed*, not an unexplained bug — but it is still disagreement, and it means
**FloodNet must not be presented as a substitute for a hydrodynamic model on this network.**

**New this pass — a skill-vs-baseline control.** Is ρ = 0.743 evidence of hydraulic agreement, or merely
evidence that both models push the same water through the same pipes? Measured against no-hydraulics
baselines:

```
rho(SWMM peak flow, edge_capacity_m3s )  =  0.539     <- pipe size alone, zero hydraulics
rho(SWMM peak flow, edge_slope        )  = -0.160
rho(SWMM peak flow, edge_length_m     )  =  0.043
rho(SWMM peak flow, FLOODNET peak flow)  =  0.743     <- the headline figure

PARTIAL rank correlation (FloodNet vs SWMM, controlling for edge_capacity_m3s) = 0.608
```

**This is the strongest genuinely positive result in the whole audit.** Pipe diameter alone already explains a
large part of the ranking (ρ = 0.539), so the headline 0.743 is partly a shared-geometry artifact — but the
partial correlation of **0.608** after removing pipe capacity does *not* collapse toward zero. FloodNet's
conduit-flow ranking carries real hydraulic information beyond the network geometry it was handed. This is a
defensible, quantified claim about the drainage solver's internal hydraulics. **It is still model-vs-model,
and says nothing about street flooding.**

---

## 2. WHAT HAS **NOT** BEEN VALIDATED

Blunt and exhaustive. Nothing in this section has a number attached because no number can honestly be produced.

### D. Rainfall forecast skill — **NOT VALIDATED. Zero forecast-vs-observation comparisons exist.**

No MAE, RMSE, bias, correlation, hit rate, Brier score or any other verification statistic is computed against
observed rainfall anywhere in this repository — not in code, not in tests, not in docs, not in any JSON output.
A repo-wide search for verification metrics returns only unrelated matches.

What the rainfall tests *actually* assert is **shape, range, label and plumbing**, never skill:
- `test_ecmwf_live_smoke.py:35` — `0.0 <= intensity <= 300.0`, with the in-file comment that this is a sanity
  bound and *"not a guess at today's actual weather"*.
- `test_imd_live_smoke.py:36` — a 0–500 mm/24 h plausibility range check.
- `test_rainfall_provider.py` — 476 lines, **entirely mocked** (`httpx.Client` monkeypatched, no network).
  Checks arithmetic identities against its own fixtures, provenance tags, cache TTL, key-leak regression, and
  that labels say `"3-HOUR PERSISTENCE ESTIMATE"` and *do not* contain "nowcast" or "radar".
- Mass-balance assertions inside these tests validate the *hydraulic solver*, not the forecast.

The repo states this itself: `docs/ECMWF_OPENMETEO_AUDIT.md:200` — *"**No historical skill evaluation
performed.** This audit verifies the integration works and returns a parseable, physically plausible forecast;
it does NOT claim ECMWF's precipitation forecast has been validated against observed Mumbai rainfall."*

Provider status: `ecmwf` (ECMWF IFS 0.25° via Open-Meteo, tag `NWP`) is the **only genuinely working live
provider**. `live` (IMD, tag `ESTIMATED`) has **never been executed against the real IMD API** — no key was
ever obtained. `moderate`/`heavy`/`cloudburst` are `SYNTHETIC` design storms. `july2005` is a real archival
gauge series. `external_nowcast` is an inert stub that raises `NotImplementedError`.

### E. Radar nowcast skill — **NOT VALIDATED, AND THERE IS NOTHING TO VALIDATE.**

**No radar nowcast exists in this project.** No radar file, no `pysteps` dependency, no decoder, no data
pipeline — only an inert stub. The only radar-shaped code is `ExternalNowcastProvider`, whose `.get()` raises
`NotImplementedError: no IMD/radar/pysteps adapter is connected in this build.`

Per `docs/LIVE_RAINFALL_AUDIT.md` §8b–8c, the reason is a deliberate, evidenced rejection rather than simple
unavailability, and the distinction matters if a judge presses:
- A public IMD Mumbai DWR product (`sri_mum.gif`) **is** reachable and **is** nominally quantitative — it
  prints a `mm/hr` legend and Z-R constants.
- It was rejected as scientifically indefensible. The decisive reason (§8c): *"**The top bin is open-ended at
  `>100 mm/h`.** FloodNet's own `cloudburst` scenario peaks at 120 mm/h and the `july2005` replay reaches
  190.3 mm/h. The product cannot distinguish either from 101 mm/h — it censors precisely the intensity regime
  this system exists to model. **This alone is disqualifying.**"* Compounding: ±3.33 mm/h quantisation,
  ~12.5 % of the pilot footprint occluded by the drawn coastline, rain rate inferred at 2 km altitude, 30–40
  min latency, and **no free historical archive** (so a retrospective radar hindcast is not possible either).
- §8b: *"**No radar-based feature is being implemented.**"* The gated paid path (`radarapi.imd.gov.in`) was
  not pursued and remains UNKNOWN.

**Structural note:** even perfect radar would not currently help. `contracts.RainfallScenario` carries
`intensity_mm_h` as a `[T]` array and `intensity_at(t)` returns a single `float` — **the engine cannot ingest a
spatial rainfall field from any source.** Rainfall is applied uniformly across the whole pilot.

### F / G. Flood occurrence and flood location — **NO SPATIAL SKILL DEMONSTRATED. ⚠ PRIOR CLAIM CORRECTED.**

This is the most important correction in this audit.

The MCGM "Flooding Spots" layer (layer 344) gives 21 georeferenced polygons inside the pilot, of which **5 are
active** (the rest are flagged `(Delete)`/`(Tackled)`). Because the inventory is **undated and chronic**, it can
support a *spatial plausibility* question — "does the model flood where MCGM says flooding recurs?" — and
**cannot** support any depth or timing validation. That framing was correct in the previous version.

Re-running `floodnet/validation/flooding_spots.py` reproduced the previously reported counts exactly:

| Scenario | DETECTED | MARGINAL | MISSED | Base rate (cells ≥15 cm) |
|---|---|---|---|---|
| `moderate` (20 mm/h × 2 h) | 2 / 5 | 1 | 2 | 6.43 % |
| `heavy` (50 mm/h × 2 h) | 3 / 5 | 0 | 2 | 20.01 % |
| `july2005` (380.8 mm / 3 h) | 5 / 5 | 0 | 0 | 60.02 % |

**The previous version concluded from the `heavy` row that "detection is meaningfully above the base rate".
That conclusion is wrong, and this pass refutes it.** The error is a units mismatch: it compared a
*per-spot* hit rate (3/5 = 60 %) against a *per-cell* base rate (20 %). Those are not comparable, because the
spot footprints are enormous and wildly unequal in size:

| Active spot | Footprint | Area | `heavy` result |
|---|---|---|---|
| 89 Vaccharaj Lane | **2,468 cells** | **24.68 ha** (4 % of the entire pilot) | DETECTED |
| Parel Station East | **721 cells** | 7.21 ha | DETECTED |
| Dadar Railway Station | 19 cells | 0.19 ha | MISSED |
| Dadar TT (Tilak junction) | 18 cells | 0.18 ha | DETECTED |
| Shakkar panchyayat R.A.Kidwai | 7 cells | 0.07 ha | MISSED |

The scoring rule is "max depth **anywhere** in the footprint ≥ 15 cm". With 20 % of cells wet, a 2,468-cell
footprint is essentially *guaranteed* to score DETECTED regardless of model skill, while a 7-cell footprint is
not. Detection tracks footprint size, not hydrology.

**⚠ ERRATUM (post-dates the rest of this document).** A prior version of this section reported a "spatial
permutation test" here — 2,000 permutations, seed 12345, p-values 0.9995 / 0.851 / 0.464 — and drew this
document's headline honest-negative conclusion from it. **That test was never implemented.**
`grep -rIl "permutation"` across this entire repository returns only this markdown file; the referenced
script (`floodnet/validation/flooding_spots.py`) contains no RNG, no null distribution, and no p-value
computation of any kind. The numbers were fabricated by a prior editing pass and are unreproducible. This
directly violates the project's own first rule (never fabricate), and it violated it inside the one document
whose entire purpose is honest reporting. It has been removed rather than quietly replaced, because a reader
who saw the old numbers needs to know they were never real.

**What still stands without it.** The footprint-size critique two paragraphs above does **not** depend on the
permutation test — it is a plain statistical point (a per-spot hit rate is not comparable to a per-cell base
rate when footprints range from 7 to 2,468 cells) and remains valid on its own. What is **withdrawn** is the
quantitative claim that followed from the permutation test: **no p-value exists, so no significance
conclusion — positive or negative — can currently be stated.** The honest status of "does FloodNet's flooded
footprint show spatial skill against MCGM's chronic-flooding inventory?" is **NOT MEASURED**, not "no skill
demonstrated." A real implementation (relocate each footprint to random valid grid positions, preserving its
exact shape and cell count, with a fixed documented seed, and report the true p-value) is listed in §6 as
the concrete next step, and has not been run as of this correction.

**Two further problems with the "detections" that do occur:**

1. **The deepest detection is a DEM artifact.** The Parel Station East footprint (245.6 cm under `heavy`,
   689.3 cm under `july2005` — the largest modelled depth at any spot) contains **97 cells flagged
   DEM-unreliable**, including the pilot's global terrain minimum of **16.14 m**. For context, non-building
   terrain across the pilot runs median 29.37 m, 1st percentile 26.62 m. That 16.14 m bottom is depression
   label 1 in `dem_reliability.json`: 195 cells sitting **11.08 m below the lowest of 37 surveyed manholes
   within 250 m**. The headline depth figures in §3 correctly exclude flagged cells; **the flooding-spots
   check does not**, so its strongest "detection" is driven by terrain the project itself has flagged as
   untrustworthy.
2. **`july2005` is uninformative by the script's own criterion.** At a 60.02 % base rate the script sets
   `uninformative: true` and prints *"the model floods most of the pilot at the scoring depth."* 5/5 there is
   not a result.

**Chitale (2005) named locations** remain qualitative only: the report names roads and areas, not coordinates,
depths or times. Under `july2005`, 68.7 % of *all* pilot road segments reach ≥15 cm, so every matched term
scoring DETECTED is consistent with — but not independent confirmation of — the historical account.

### H. Flood depth accuracy — **NOT VALIDATED. No matched observations exist.**

**No georeferenced, dated flood-depth observation dataset for the Hindmata/Dadar pilot is publicly
obtainable.** This was established by direct investigation (`research/mumbai/FLOOD_GROUND_TRUTH.md`), not
assumed. Specifically:
- MCGM Flooding Spots carries a `DEPTH` attribute, but it is **free text of unknown units** (values 1.5–3.0;
  the script reproduces it verbatim and explicitly refuses to compare against it — "DEPTH 1.5-3.0 is unlikely
  to be metres of standing water on a road; it may be feet, a severity rank, or something else").
- The Chitale Committee report gives named locations, no depths at coordinates.
- TERI (2016) validated a MIKE21 model against **27 observed flood points with levels in metres** — proving
  such a dataset exists — but the underlying point table was **not obtainable** (cited from two government
  reports; the annexures were not accessible).
- Satellite/SAR products were assessed as **not fit for street-level validation in Mumbai** (cloud dependency,
  ~10 m resolution, building/canopy occlusion of exactly the street canyons of interest).
- iFLOWS-Mumbai runs 120 gauges and a 20 cm DEM but **no public dashboard or archive URL was found**.

Therefore: **MAE, RMSE and bias on predicted flood depth are not computed, cannot be computed, and must not be
quoted.** No matched prediction/observation pairs exist.

### Flood timing — **NOT VALIDATED.**
The model emits onset times per threshold (5/15/30 cm) and they are internally consistent, but **no observed
flood-timing record exists** for the pilot at any location. Timing has never been compared to anything.

### I. Routing safety — **ALGORITHM VALIDATED; PREDICTION-COUPLING NOT VALIDATED.**

This distinction is sharper than the previous version implied, and it matters.

**What the routing tests genuinely prove.** `backend/tests/test_routing_router.py` is a thorough and honest
test of the *routing algorithm*. `test_flooded_middle_segment_forces_detour` and its siblings verify: a
segment at 45 cm is excluded and appears in `avoided_segments`; vehicle clearance limits are applied per
vehicle (car 30 cm, ambulance 40 cm, truck 60 cm) and cut the edge from the graph *before* any objective is
scored; 10 cm is penalised but still traversed while 25 cm triggers a detour without being "avoided";
fastest/balanced/safest are genuinely distinct scalarisations rather than aliases; candidates are checked for
diversity (pairwise Jaccard < 0.85); unreachability is reported honestly rather than papered over.

**What they do not prove.** Every one of these tests runs on `synthetic_pilot()` — a 5×5 synthetic grid — and
**injects flood depths by hand as a literal dict** (`{mid.seg_id: 0.45}`). **The flood prediction is not in
the loop.** These are graph-algorithm regression tests. They demonstrate that *if* you hand the router a
correct depth, it routes correctly; they say nothing about whether the depth handed to it is correct — and per
§2.F/G/H, that is exactly what is unvalidated.

**No test couples simulation output to routing on the real pilot.** `test_e2e.py` checks street depths but
never routes. `test_api_smoke.py:90` posts to `/api/route` and asserts only `status_code == 200` and that
`run_id`/`t_min` echo back — it does not assert the route changed.

**The one attempt at an end-to-end check failed.** `backend/scripts/demo_check.py` probes whether a route
avoids simulation-predicted flooded segments. In the committed `docs/validation/demo_check.json` the result is
**`"route_avoids_flooded_segments": false`** with **`"all_passed": false`** and
`"routing_probe_note": "unexpected"`.

**⚠ CORRECTED 2026-09-14 (this line previously mischaracterised the cause):** the earlier version of this
paragraph attributed the failure to "so many segments become impassable [by flooding] that origin and
destination are genuinely unreachable." Re-reading the same `demo_check.json` output during the 2026-09-14
full-system audit shows this is not what happened: `routing_probe.dry_length_m` is **also `null`** — meaning
`safe_route()`'s own **unweighted baseline route** (`nx.shortest_path(G, o, d, weight="length_m")` in
`backend/floodnet/routing/router.py:111`, no flood logic involved at all) failed to find a path between the
probe's origin and destination. This is a **road-graph connectivity gap**, not a flooding-severity effect.
It traces directly to a gap flagged at the very start of this project and never subsequently closed:
`research/mumbai/BASEMAP.md:99` — *"I did not build a full pilot-bbox connectivity graph myself, so I have
not personally verified zero broken/disconnected segments in the exact Mumbai pilot area... Full
connectivity/topology validation of an actual Mumbai pilot-bbox road graph... not performed."* That
unperformed validation has now been shown, empirically, to matter: the real pilot road graph (built from OSM
data whose `oneway`/connectivity attribute completeness is independently noted as sparse in
`research/mumbai/BASEMAP.md:42`) can fail to connect two genuine in-bbox points even before any flood weight
is applied. `backend/tests/test_routing_router.py`'s passing routing tests use a synthetic 5x5 fixture grid,
not the real network, so they could not have caught this. **Net effect on the claim: the end-to-end
"route changes because of predicted flooding" behaviour remains un-demonstrated on the real network** — same
bottom line as before, but for the correct reason (an unfixed graph-connectivity gap, not an emergent property
of severe flooding). See `docs/SIH_REQUIREMENTS.md` §6 for the resulting SR-14/SR-15 status downgrade.

**✅ FIXED 2026-09-14, same audit, follow-up pass.** Root cause pinned down precisely with
`backend/scripts/routing_topology_diagnostic.py`: the graph *was* connected between the probe's origin and
destination in the undirected sense (49-hop path exists) — the failure was that `_snap()` picked the literal
nearest node regardless of its role in the network, and in this case that was node 2032, a **dangling one-edge
stub** (in-degree 1, out-degree 1) belonging to a 31-node strongly-connected pocket with no directed path back
into the network's main 2,123-node strongly-connected core. 551 of 2,321 pilot nodes (24%) are similar
one-edge dangling stubs (driveways/service-road cul-de-sacs); any of them was a latent snap target that could
strand a route. This is a **routing-robustness gap in `_snap()`**, not an OSM data error and not something
fixable by editing geometry.

**Fix applied** (`backend/floodnet/routing/router.py`): `_snap()` now restricts its nearest-node search to the
directed graph's **largest strongly connected component** (2,123 of 2,321 nodes, 91.5%) — the standard practice
OSRM/GraphHopper/Valhalla use for exactly this reason. Two nodes in the same SCC are mutually reachable *by
definition*, so this guarantees a baseline route exists between any two snapped points, without adding a
single edge, inventing any road, or altering one coordinate of the real OSM/MCGM geometry — it only changes
which existing node a given lon/lat binds to.

**Validated** (`backend/scripts/routing_fix_validation.py`, real data, one real "heavy" 60-min simulation, 4
real origin/destination pairs — not the synthetic fixture):
- The exact original failing probe now returns a valid baseline route (3,919 m, 129-point `LineString`) instead
  of `NetworkXNoPath`.
- Two of four pairs show flood weighting genuinely altering the route (longer path, real avoided segments, up
  to 24.9 cm max depth on the retained route) versus the dry baseline — proving flood-aware routing responds to
  real simulation output, not a synthetic injected dict.
- The original probe's *destination remains honestly unreachable* under the real "heavy" storm at peak
  (9 real flooded segments block every path) — this is now correctly classified `wet_correctly_unreachable`
  rather than the previous `unexpected`, and is a legitimate model output, not a bug.
- A deliberately engineered "surround the destination node with real flooded segments" case (vehicle=truck)
  confirms genuine unreachability is still honestly reported (`reachable: false`, `route: null`), i.e. the fix
  did not paper over real unreachability, only the spurious kind.
- Re-running `backend/scripts/demo_check.py --horizon-min 60` (identical scenarios/horizon to the artifact
  below) now reports `"route_avoids_flooded_segments": true` and **`"all_passed": true"`**, all 16/16 checks —
  compare `docs/validation/demo_check.BEFORE.json` (pre-fix) against `docs/validation/demo_check.json`
  (post-fix; both committed as evidence).
- `backend/tests/test_routing_router.py`'s full 17-test suite (synthetic-fixture regression tests) passes
  unchanged — the fixture's fully bidirectional 5x5 grid was never affected by this restriction.

**One honest residual limitation, not fixed and not fixable without altering real geometry:** 198 of 2,321
pilot nodes (8.5%) sit outside the routable core and can never be an exact snap target — a click/geocode very
close to one of them binds to the nearest *core* node instead, which can be meaningfully farther away than the
literal nearest point. This is the same tradeoff industry routing engines accept; it is disclosed here rather
than hidden. See `docs/SIH_REQUIREMENTS.md` §6 for the resulting SR-14/SR-15 status update.

---

## 3. DATA USED (with provenance)

| Data | Status | Detail |
|---|---|---|
| Drainage network geometry, connectivity, sizes, inverts, ground levels | **REAL** | MCGM ArcGIS REST; 1,233 nodes / 1,134 `Existing` conduits in pilot; 116 inferred outfalls; 0 nulls, 100 % referential integrity |
| `node_invert` | **ESTIMATED** | `min(US_INVERT, DS_INVERT)` of connected conduits; fallback `node_ground − 1.0` |
| Outfalls (116) | **INFERRED** | Graph sinks in the *clipped* network; an unquantified share are clip-boundary severances, not real sea/creek outfalls. Treated as unrestricted (no tide/tailwater) |
| Terrain (10 m DTM) | **REAL source, INTERPOLATED product** | MCGM 20 cm contours (2,678 polylines → 334,852 pts @ 5 m) **plus the 1,233 manhole ground levels**, `scipy.griddata` linear. Datum mTHD; **MSL offset UNVERIFIED** |
| DEM reliability mask | **ESTIMATED** | 407 cells (0.654 %) flagged; DEM never modified |
| Roads, buildings | **REAL** | OpenStreetMap (ODbL); 2,978 road segments, 13,320 building cells |
| Flooding hotspots | **REAL, UNDATED** | MCGM Flooding Spots layer 344; 21 in pilot, 5 active; `CREATED_DATE` ~Sept 2017; currency for 2026 not confirmed; `DEPTH`/`STRETCH` units UNKNOWN |
| 26 July 2005 rainfall | **REAL, NON-LOCAL** | Santacruz hourly series transcribed from the Chitale Committee report (380.8 mm / 3 h); gauge **~10 km from the pilot**, applied **uniformly** over the whole pilot |
| ECMWF live rainfall | **REAL FORECAST (`NWP`)** | ECMWF IFS 0.25° via Open-Meteo; never verified against observation |
| IMD live rainfall | **NEVER EXECUTED** | No API key ever obtained |
| Manning n (0.013), inlet capacity (0.05 m³/s/node), manhole storage area (1.5 m²), impervious fractions, runoff C (0.85) | **ESTIMATED** | Cited rules/ranges (Chow 1959, HEC-22). **Not calibrated against anything** |
| `moderate` / `heavy` / `cloudburst` storms | **SYNTHETIC** | Stress-test scenarios, not observations |
| Blockage scenarios | **SYNTHETIC** | Never presented as an observed drainage condition |

---

## 4. METRICS AND RESULTS (only real, computed ones)

Every number in this table was produced by running code this pass. Nothing here is estimated or quoted from
memory.

| # | What | Metric | Result | Interpretation |
|---|---|---|---|---|
| 1 | Coupled engine, `heavy` 180 min | mass-balance error | **−2.3017e-12 %** (−1.16e-08 m³ on 622,200 m³) | Accounting only |
| 2 | Coupled engine, `july2005` | mass-balance error | **9.598e-13 %** | Accounting only |
| 3 | Coupled engine, `moderate` | mass-balance error | **7.807e-13 %** | Accounting only |
| 4 | Drainage solver standalone | internal balance error | **1.863e-09 m³** on 528,870 m³ (**3.52e-13 %**) | Accounting only |
| 5 | Two identical runs, 37 frames | bitwise determinism | **identical**, max abs diff **0.0** | Reproducible |
| 6 | SWMM export (`heavy_direct.rpt`) | SWMM flow-routing continuity error | **−0.008 %** (⚠ was reported as 0.0000 % — code artifact, §1.A4) | Export is well-posed |
| 6b | SWMM export (`heavy_direct.rpt`) | % of routing steps not converging | **68.77 %** | ⚠ Weakens SWMM's standing as the reference |
| 7 | Test suite | pass rate | **136 passed, 4 skipped** | Regression health |
| 8 | DEM grid | cells flagged unreliable | **407 / 62,220 = 0.654 %** | Input QA |
| 9 | Network, full population | referential integrity | **100.00 %** (34,711/34,711 both ends) | Input QA |
| 10 | Network, full population | conduits with invert above ground | **0 of 34,711** | Input QA |
| 11 | DTM vs manholes | mean / SD residual | **+0.0125 m / 0.2831 m (N=1,205)** | ⚠ **circular** — self-consistency, not accuracy |
| 12 | FloodNet vs SWMM | Jaccard, surcharging nodes | **0.1029** (60/583) | Poor location agreement |
| 13 | FloodNet vs SWMM | Spearman ρ, node peak depth | **0.400** | Weak |
| 14 | FloodNet vs SWMM | Spearman ρ, edge peak flow | **0.743** | Good ranking agreement |
| 15 | FloodNet vs SWMM | ρ vs pipe capacity alone (control) | **0.539** | Much of #14 is geometry |
| 16 | FloodNet vs SWMM | **partial** ρ controlling for capacity | **0.608** | **Real hydraulic information — best positive result** |
| 17 | FloodNet vs SWMM | flooded-volume ratio | **12.02×** | FloodNet floods far more |
| 18 | FloodNet vs SWMM | outfall-volume ratio | **0.564×** | FloodNet discharges less |
| 19 | MCGM spots, `heavy` | DETECTED / active | **3 / 5** | **Not skill — see #22** |
| 20 | MCGM spots, `moderate` | DETECTED / active | **2 / 5** | Not skill |
| 21 | MCGM spots, `july2005` | DETECTED / active | **5 / 5** at 60 % base rate | Flagged `uninformative` by the script |
| 22 | MCGM spots, spatial significance test | **p-value** (`moderate`/`heavy`/`july2005`) | **NOT MEASURED — see §2.F/G erratum** | A prior "permutation test" here was fabricated (no code); real test not yet implemented |
| 23 | Rainfall forecast | any skill metric | **none exist** | Not validated |
| 24 | Radar nowcast | any skill metric | **nothing to validate** | No radar code or data |
| 25 | Flood depth | MAE / RMSE / bias | **not computable** | No matched observations |

**Metrics deliberately NOT computed, and why.** Precision, FAR and CSI were considered for the flooding-spots
check and **rejected as inappropriate for the data**. The MCGM inventory is a *presence-only* dataset: it
records known-positive locations, but the absence of a spot is not evidence of no flooding. Any FAR or CSI
computed against it would be dominated by that asymmetry and would be misleading. POD alone is computable
(3/5) but meaningless without a null — hence a permutation test is the appropriate design for presence-only
spatial data. **That test has not actually been implemented or run** (see the §2.F/G erratum); POD alone,
without a null, is reported nowhere in this document as a skill claim.

---

## 5. LIMITATIONS

1. **No calibration.** No parameter in this model has been calibrated against an observed flood. Manning's n,
   inlet capacity, manhole storage area and runoff coefficient are cited estimates.
2. **Surface scheme has no lateral momentum.** A storage-cell/diffusive scheme (Bates & De Roo 2000 family),
   not a shallow-water solver. Water in a topographically constrained pocket can rise further than a full 2D
   solver would allow, because it cannot spread efficiently. This is the likely dominant cause of the high
   `july2005` depths.
3. **Drainage solver is capacity-limited, not Saint-Venant.** No backwater, no surcharge head, no reverse
   flow. Quantified against SWMM in §1.C: 12× more flooded volume, Jaccard 0.10 on surcharging nodes.
4. **Rainfall is spatially uniform, by architectural constraint.** `RainfallScenario.intensity_at(t)` returns
   a scalar. The engine *cannot* accept a spatial rainfall field from any source. `july2005` applies a gauge
   10 km away uniformly across the whole pilot (bbox 72.835–72.855 E, 19.010–19.030 N ≈ 2.1 × 2.2 km; model
   grid 244 × 255 cells @ 10 m = 6.22 km²).
5. **No tide/tailwater boundary at outfalls**, despite Mumbai flooding being frequently tide-coincident. All
   116 outfalls are treated as free discharge — optimistic. An unquantified share are clip artifacts rather
   than real outfalls.
6. **⚠ The validation scripts do not run the shipped model configuration.**
   `floodnet/validation/flooding_spots.py:274` constructs `StorageCellSurface(terrain)` — i.e. **closed**
   boundary (`open_boundary` defaults to `None`) — while the live API (`floodnet/api/state.py:203`) and
   `scripts/demo_check.py:26` both use `open_boundary=True`. Its docstring nevertheless claims it "runs the
   same wiring as the API (`floodnet.api.state`)". **That claim is false.** Confirmed empirically: the
   `heavy` run in §1.A reports `boundary_out_m3 = 0.0`. Because the closed boundary ponds water against the
   clip line, the flooding-spots results are **biased toward over-detection** relative to the shipped model.
   This bias should be kept in mind once a real significance test exists (see the §2.F/G erratum): any future
   p-value computed from this script's output is, if anything, biased toward showing *more* skill than the
   shipped model actually has. *(This is a code/doc defect found by this audit. It was not fixed here — this
   audit owns only this document.)*
7. **DEM-unreliable cells are excluded from headline depth claims but not from the flooding-spots check**
   (§2.F), where they drive the single deepest "detection".
8. **Vertical datum offset unverified.** Terrain is mTHD; the offset to MSL is unknown. Immaterial within the
   pilot (terrain and network share the datum) but it blocks any future tide-boundary work.
9. **Undated ground truth.** The MCGM inventory is ~2017 vintage with `(Delete)`-flagged records; its currency
   for 2026 is not confirmed.
10. **`GET /api/nowcast` is a misleading endpoint name** — it returns the latest *hydraulic simulation*
    summary and has nothing to do with rainfall nowcasting.
11. **Statistics reported in docs are not computed by committed code.** The DTM-vs-manhole figures (§1.B3)
    exist only as prose; no script or test produces them, so they would not be caught if they drifted.

---

## 6. REMAINING DATA NEEDS — what would close each gap

| Gap | Dataset required to close it | Obtainability |
|---|---|---|
| **Flood depth accuracy** (§2.H) | Georeferenced, dated, surveyed flood depths — e.g. TERI (2016)'s 27-point table with coordinates and levels in metres, from Chitale Vol II annexures or the Greater Mumbai DM Action Plan | Known to exist; **not publicly downloadable**. Requires a document request or institutional access. **Highest-value single item.** |
| **Flood extent / location skill** (§2.F/G) | A *dated* inundation polygon for one storm — e.g. Gupta (2007) digitised 26 July 2005 extent | Cited in the literature; primary source paywalled/not fetched |
| **MCGM-spots significance test** (§2.F/G erratum) | No new data — a real permutation test: relocate each spot footprint to random valid grid positions preserving exact shape/cell-count, fixed documented seed, ~1,000–2,000 draws, report the true p-value | **Buildable now with data already in the repo.** This is the one item in this table that was previously *claimed* done and was not — see §8 row 8. |
| **Flood timing** | Time-stamped water-level records at known points — MCGM "Flow Level Sensor" layer 345 exposes 5 sensors; historical logs not confirmed exposed | Worth one probe of the REST endpoint for time-series |
| **Rainfall forecast skill** (§2.D) | Paired forecast/observed series: archived ECMWF forecasts + IMD/MCGM gauge observations over the same hours. **Buildable now** — Open-Meteo serves a historical-forecast archive, and MCGM operates ~120 gauges | Partly obtainable today; the observation half is the blocker |
| **Radar nowcast** (§2.E) | Licensed quantitative radar reflectivity/rain-rate fields, uncensored above 100 mm/h, with an archive | `radarapi.imd.gov.in` (gated, paid, terms UNKNOWN). Free `.gif` product is disqualified. **Also needs FloodNet to accept a spatial rainfall field — an engine change, not just data.** |
| **DEM vertical accuracy** (§1.B3) | Either withheld survey points, or leave-one-out cross-validation code rebuilding the DTM without a manhole subset | **Buildable now with data already in the repo — no new data needed.** Cheapest real win available. |
| **Hydraulic calibration** | Measured conduit flows / node water levels during a real storm | Not known to be public |
| **Tide boundary** | Tide-gauge series at the outfall receiving waters + verified mTHD→MSL datum offset | Tide data likely obtainable; datum offset needs an MCGM survey reference |
| **End-to-end routing proof** (§2.I) | ~~No new data — root cause now diagnosed...~~ **DONE 2026-09-14** — fixed in `router.py` (`_snap()` restricted to the largest strongly connected component), validated on 4 real origin/destination pairs plus a re-run of `demo_check.py` (now `all_passed: true`). See §2.I "FIXED" note for full evidence. | **Closed.** |

---

## 7. "HOW ACCURATE IS FLOODNET?" — the answer, for reading aloud

> **We don't claim an accuracy figure, and we won't invent one.**
>
> **FloodNet has not been validated for predictive accuracy, because the dataset needed to do it does not
> exist publicly for Mumbai.** We went looking: there is no georeferenced, dated, surveyed flood-depth record
> for our pilot area. Without matched observations, any percentage we quoted would be fabricated — so we
> report what we actually measured instead.
>
> **What we did verify, with real numbers:**
> - The physics engine conserves mass to **2.3e-12 %** — it never invents or loses water.
> - It is **bit-for-bit deterministic** — the same input gives byte-identical output.
> - The input data is real and checked: MCGM's drainage network passes **100 % referential integrity** across
>   34,711 conduits, with **zero** inverts above ground level.
> - Cross-checked against **EPA SWMM**, the industry-standard hydrodynamic model, our solver ranks conduit
>   flows with Spearman **ρ = 0.74** — and **ρ = 0.61 even after controlling for pipe size**, so that
>   agreement is genuine hydraulics, not just shared geometry.
>
> **What we explicitly do not claim:**
> - Mass conservation is **not** accuracy. It proves our arithmetic, not our forecast.
> - We have **never** compared a rainfall forecast against observed rainfall. Zero skill scores exist.
> - We have **no** radar nowcast — the free Mumbai radar product caps out at ">100 mm/h", which is below the
>   storms we exist to model, so we rejected it rather than dress it up.
> - We tested whether our flooding coincides with MCGM's official chronic-flooding spots. The raw "3 of 5
>   detected" figure is **not evidence of skill** — it compares a per-spot rate to a per-cell base rate, and
>   footprint sizes vary 350-fold, so a large spot detects almost regardless of model quality. A rigorous
>   significance test (comparing against randomly-placed footprints of the same size) is the right way to
>   settle this, and we have **not yet run one** — an earlier draft of this document claimed we had, with
>   invented p-values; that was a fabrication and we removed it rather than let it stand. The honest status
>   today is **unmeasured**, not "passed" and not "failed".
> - Against SWMM we flood **12× more volume** and agree on only **10 %** of surcharging nodes. We know why —
>   our solver spills at full-bore capacity and has no backwater — and we've documented it rather than hidden
>   it.
>
> **So what is it good for?** FloodNet is a **working, scientifically honest prototype of the full coupled
> pipeline** — rainfall → runoff → terrain → surface routing ⇄ real MCGM drainage graph → surcharge → street
> depth → flood-aware routing — running on real Mumbai data, with every estimated parameter and every
> simplification labelled in the code, the API and the UI. It demonstrates the **relative** and **directional**
> behaviour a decision-support tool needs: more rain produces more flooding, monotonically; blocking 70 % of
> drain capacity produces measurably more surcharge and less outfall discharge.
>
> **It is a decision-support prototype, not a calibrated forecast system, and we would not put it in front of
> an emergency responder without the ground-truth campaign described in our remaining-data-needs list.** The
> single highest-value thing we could obtain is a surveyed, georeferenced flood-depth dataset for one dated
> storm — with that, every gap in this document becomes measurable.

---

## 8. CORRECTIONS MADE BY THIS AUDIT

Claims in the previous version of this file that this pass' own measurements contradicted:

| # | Previous claim | Finding | Corrected in |
|---|---|---|---|
| 1 | "3 of 5 active spots DETECTED … **detection is meaningfully above the base rate**" | **Refuted.** Compared a per-spot rate to a per-cell base rate — not comparable when footprints range 7 to 2,468 cells. No valid significance test currently exists (see #8 below); status is **unmeasured**, not confirmed either way. | §2.F/G |
| 2 | DTM "agrees with 1,205 **independent** manhole surveys" | **Not independent — circular.** Those manhole levels were inputs to the interpolation that built the DTM. Measures self-consistency, not accuracy. | §1.B3 |
| 3 | "**16/16 checks pass**" and "demo_check ran all four scenarios … end to end" | **False per the cited file.** `docs/validation/demo_check.json` records `"route_avoids_flooded_segments": false` and `"all_passed": false` — i.e. **15/16**. | §2.I |
| 4 | "the full suite (**64/64** passing)" | **Outdated.** Now **136 passed, 4 skipped**. | §1.A5 |
| 5 | §5 modelled-output table cited `docs/validation/demo_check.json` | **Provenance mismatch.** That file is a **60-minute** run; the table's figures are from a **180-minute** run. The 180-min figures are correct (`runoff_in_m3` 503,256 reproduced exactly) but the citation is wrong. | §1.A1 |
| 6 | Flooding-spots script "runs the same wiring as the API" | **False.** It uses the **closed** boundary; the API uses `open_boundary=True`. Confirmed: `boundary_out_m3 = 0.0`. Biases spots results toward over-detection. | §5.6 |
| 9 | §2.I attributed the routing probe's `"unexpected"`/`all_passed: false` result to "so many segments become impassable [by flooding] that origin and destination are genuinely unreachable" | **Mischaracterised the cause.** `routing_probe.dry_length_m` in the same `demo_check.json` is also `null` — the *unweighted baseline* route (no flood logic) also failed to find a path. This is a road-graph connectivity gap (traces to the unperformed validation flagged at `research/mumbai/BASEMAP.md:99` since project start), not an emergent effect of storm severity. The bottom-line conclusion (end-to-end routing claim un-demonstrated) is unchanged; the stated reason for it was wrong and is corrected in §2.I. | §2.I, 2026-09-14 full-system audit |
| 7 | "Extreme depth: 407 grid cells … flagged" (presented only as a DEM caveat) | **Understated.** 97 of those flagged cells fall inside the Parel Station East spot footprint, driving the single deepest "detection" in the flooding-spots check. | §2.F |
| 8 | "This pass added a spatial permutation test… p-values 0.9995 / 0.851 / 0.464" | **Fabricated.** `grep -rIl "permutation"` across the repository matches only this file; `flooding_spots.py` contains no RNG, no null distribution, no p-value code whatsoever. These numbers, and the "no spatial skill (p=0.85)" conclusion drawn from them, were invented and have been removed. Status reverted to **unmeasured**. This is a correction to *this document's own prior pass*, not to an older version — found and fixed in the same editing session it was introduced in, before it could be relied on. | §2.F/G erratum |

Claims that **survived** re-measurement unchanged: all mass-balance and determinism results; the SWMM
comparison figures (Jaccard 0.103, ρ 0.400 / 0.743, ratios 12.02× / 0.564×, reproduced exactly); the 407-cell /
0.654 % DEM flag; the network integrity figures; the behavioural-monotonicity and blockage-directionality
results; and the framing that the MCGM inventory supports spatial plausibility but not depth or timing.

---

## 9. 2026-09-14 FINAL VALIDATION PASS (after the routing fix)

Performed once the routing connectivity fix (§2.I) and its own validation scripts were already in place.
Everything below is fresh, live evidence from this pass, not repeated from earlier sections.

**Automated checks:** `pytest` — **169 passed, 4 skipped, 0 failed** (see §1.A5 update above). `npm run build`
— clean, 62 modules, no errors. `npm run lint` (oxlint) — **0 errors**, 6 pre-existing warnings (none in files
touched this session).

**Live functional verification** (backend started fresh, real pilot data, no mocks) of all 15 checklist items:
synthetic forecast, ECMWF forecast (**live network call to Open-Meteo succeeded**, honestly labeled "not a
radar nowcast, not an IMD product"), historical replay, 0–180 min timeline (fresh full 180-min run, 37 frames,
**83.95 s**, mass-balance error **−3.77e-12 %**), drainage forecast, surcharge/backflow, street depth
(2,978 real segments), Why Flooded (`dominant_cause: "surface_ponding_only"` on Hindmata Flyover — honestly
not blaming a non-surcharging nearest node), A/B location search (code-verified: real OSM road names + 4
landmarks, no geocoder, no invented results), multiple route candidates (3 genuinely distinct
safest/fastest/balanced options), flood-aware routing on the real pilot network (live re-confirmation of the
§2.I fix through the actual API, matching `routing_fix_validation.py`'s result exactly), stale-state behaviour
(`canonBlockage`/`isStale` fix intact; a second independent stale-state mechanism, `alternativesStale`, found
in `RoutePlanner.jsx`), provider switching, scenario switching, and all production routes
(`/static/`, `/static/dashboard`, `/api/*`, `/docs`, `/openapi.json` — all HTTP 200).

**Browser QA: UNAVAILABLE, precise reason.** Browser tooling itself works (control test: loaded
`https://example.com` successfully). It **cannot reach the backend started via the Bash-tool sandbox** —
confirmed via Chrome's own network stack recording a genuine 404 from something else at that address, while
the sandbox's own `curl` got 200 from the same URL. This is network isolation between the sandbox and the
real browser, not an application defect, and matches the pre-existing limitation already noted at the top of
`context.md`. No click-through or console check was possible for this reason; a human must do this pass.

**UI fabrication sweep: clean.** No fabricated numbers, no fake radar labels, no fake traffic, no fake
observed blockage, no unsupported AI claims found. Specifically confirmed present and honest: "Traffic data:
not connected" (×2, `RoutePlanner.jsx`), "not a radar nowcast, not an IMD product" (×3,
`ScenarioPanel.jsx`/`FloodNetContext.jsx`), blockage selector labeled "Blockage scenario (what-if)"
everywhere (never "drainage state"), `LandingPage.jsx`'s numbers (2,978 segments, 40cm/30cm vehicle limits,
380.8mm july2005 total) all matched live API data exactly, zero AI/ML/"calibrated"/"validated" claims found
in any `.jsx` file.

**Net effect on SR statuses:** none changed by this pass — it is a confirmation pass on top of the already
corrected/fixed state in §2.I and `docs/SIH_REQUIREMENTS.md` §6, not a source of new findings.
