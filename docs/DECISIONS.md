# DECISIONS — SIH26085 Urban Flood Nowcasting System

**Overall decision status: `UNDECIDED`**

No technology, dataset, city, model or framework has been selected. Nothing in this repository may assume otherwise.

**Last updated:** 2026-09-08

---

## 1. Rules for this document

1. **Nothing is decided until it is recorded here** with a date, the evidence behind it, and the alternatives that were rejected.
2. **No decision may be made before its prerequisites are verified.** Each entry below lists what must be known first. Deciding early, on assumption, is the failure mode this document exists to prevent.
3. **Decisions follow the data, not familiarity.** A technology is not chosen because we know it; it is chosen because the evidence in the prerequisites column supports it.
4. **Reversal is allowed and expected.** If evidence changes, supersede the entry — do not silently edit it.
5. Anything recorded here that later turns out to be wrong is corrected here first, then in `docs/PRD.md`.

**Decision record format** (to be used once decisions begin):

```
### D-nn <topic>
Status:     DECIDED | REJECTED | SUPERSEDED BY D-mm
Date:
Decision:
Evidence:      (what we verified, with links/paths — not recollection)
Alternatives rejected, and why:
Consequences:  (what this now forces or forecloses)
Reversal cost:
```

---

## 2. Open decisions

All entries below are **`UNDECIDED`**.

| # | Decision | Status |
|---|---|---|
| D-01 | Target city | `UNDECIDED` |
| D-02 | Target geographic area (pilot extent) | `UNDECIDED` |
| D-03 | Available drainage dataset | `UNDECIDED` |
| D-04 | Available DEM | `UNDECIDED` |
| D-05 | Rainfall source | `UNDECIDED` |
| D-06 | Historical flood ground truth | `UNDECIDED` |
| D-07 | Hydraulic engine | `UNDECIDED` |
| D-08 | ML / GNN model | `UNDECIDED` |
| D-09 | Surface-routing approach | `UNDECIDED` |
| D-10 | Database | `UNDECIDED` |
| D-11 | GIS framework | `UNDECIDED` |
| D-12 | Routing framework | `UNDECIDED` |
| D-13 | Deployment strategy | `UNDECIDED` |

---

### D-01 — Target city

- **Status:** `UNDECIDED`
- **The question:** which Indian metro the prototype is built for.
- **Must be known first:** for each candidate city — availability of rainfall nowcast data (D-05), DEM resolution (D-04), any drainage network data (D-03), road network completeness, land-cover data, and historical flood records (D-06). Licences for all of the above.
- **Constraint from the PS:** *"major Indian metros **like** Mumbai, Delhi, and Chennai"* — these are examples, not a closed list (see `SIH_REQUIREMENTS.md` Q11).
- **Depends on:** nothing. **Blocks:** D-02, D-03, D-04, D-05, D-06 and effectively all implementation.
- **Selection principle (agreed, not a decision):** choose the city with the best *combination* of obtainable data, not the most famous flooding case. The data decides.

---

### D-02 — Target geographic area (pilot extent)

- **Status:** `UNDECIDED`
- **The question:** the bounded area within the chosen city that the prototype covers.
- **Must be known first:** D-01; the DEM resolution actually available (D-04); the runtime of the chosen routing method at candidate extents (D-09); whether any drainage data covers the area (D-03); whether the area has recognisable, well-named streets for the demo.
- **Tension to resolve deliberately:** a larger area is more impressive; a smaller area allows finer resolution and faster runs. The PS demands street-level detail *and* real-time speed — the pilot extent is the main lever for satisfying both.
- **Depends on:** D-01, D-04, D-09. **Blocks:** data acquisition volume, runtime budget, demo script.

---

### D-03 — Available drainage dataset

- **Status:** `UNDECIDED`
- **The question:** what stormwater network data we will actually use — real, partially real, or synthetic.
- **Must be known first:** whether any municipal or open drainage dataset exists for the candidate cities; if so, its format, coverage, licence, and which attributes it carries (node ground/invert elevation, edge shape/size/length/slope/roughness, direction — see `SIH_REQUIREMENTS.md` SR-06).
- **Why this is the critical path:** SR-06, SR-07 and SR-08 — the distinguishing requirements of this problem statement — all depend on it. The PS itself calls the network "invisible", which suggests the data may not be publicly available.
- **Standing constraint on any outcome:** if the network is synthesised in whole or in part, it must be labelled synthetic in the data model, the API, the dashboard and the presentation, with its derivation published. Presenting a synthesised network as a real municipal network is out of the question.
- **Depends on:** D-01. **Blocks:** D-07, and the design of the entire network component.

---

### D-04 — Available DEM

- **Status:** `UNDECIDED`
- **The question:** which elevation dataset, at what resolution and vertical accuracy.
- **Must be known first:** what is obtainable free and legally for the candidate area; native resolution; vertical datum and accuracy; whether it is bare-earth terrain or a surface model including buildings; acquisition date; licence for public demonstration.
- **Why it matters beyond ingestion:** vertical accuracy bounds how credibly we can report depth in centimetres (SR-11), and resolution bounds whether "street-level" (SR-10) is achievable at all.
- **Depends on:** D-01. **Blocks:** D-02, D-09, and any claim about output precision.

---

### D-05 — Rainfall source

- **Status:** `UNDECIDED`
- **The question:** what drives the 0–3 hour forecast — a live Doppler radar nowcast product, radar observations we extrapolate ourselves, another rainfall source, or scenario input.
- **Must be known first:** whether Indian DWR data for the candidate city is accessible programmatically, at what latency, resolution, licence and cost; whether a ready nowcast product exists or must be generated (a materially larger scope — `SIH_REQUIREMENTS.md` Q10); what the fallback options are and whether they still satisfy "high-resolution".
- **Standing constraint:** whatever the source, the ingestion interface should be shaped so a real radar feed can replace a fallback without redesigning the pipeline. Any fallback must be labelled in the UI.
- **Depends on:** D-01. **Blocks:** SR-01, SR-02, the forecast timestep, and the refresh cadence.

---

### D-06 — Historical flood ground truth

- **Status:** `UNDECIDED`
- **The question:** whether any record of past waterlogging locations and past rainfall exists that we can validate against, and if so, which.
- **Must be known first:** whether municipal waterlogging point data, incident records, or a documented past event dataset is obtainable for the candidate area, with matching rainfall for the same event.
- **Consequence if the answer is "none":** external validation (PRD V3) is impossible, and we say so. We would then rest on conservation, behavioural and sensitivity checks (V1, V2, V4) and state clearly that the model is unvalidated against observations. **We will not manufacture a validation result.**
- **Depends on:** D-01. **Blocks:** the validation section of the report and any accuracy claim.

---

### D-07 — Hydraulic engine

- **Status:** `UNDECIDED`
- **The question:** how flow and capacity in the drainage graph are computed — the formulation and whether an existing engine or our own implementation is used.
- **Must be known first:** the attribute completeness of D-03 (a sophisticated engine cannot run on attributes we do not have); the runtime each option needs at the pilot extent (D-02); how each couples with the surface model (D-09); the licence and buildability of any external engine within the hackathon window.
- **Explicitly not yet evaluated:** the externally referenced repositories listed in §4. None has been inspected, cloned, or benchmarked.
- **Depends on:** D-02, D-03, D-09. **Blocks:** SR-07, SR-08.

---

### D-08 — ML / GNN model

- **Status:** `UNDECIDED` — and additionally **not yet justified**.
- **The question:** whether any machine-learning component is used at all, and if so, for what — rainfall nowcasting from radar sequences, a surrogate to accelerate the physical model, or something else.
- **Must be known first:** whether a physical baseline exists to compare against; whether training data exists in sufficient quantity for the specific task; whether the model can be *evaluated* honestly within the time budget.
- **Standing constraint:** no ML component ships that has not been trained on real data and evaluated with a reported metric. An untrained, unevaluated or purely illustrative model is worse than none, because it invites a claim we cannot support.
- **Position:** ML is a stretch (PRD S7), not a default. It must earn its place against a working physical baseline.
- **Depends on:** D-05, D-06, D-09. **Blocks:** nothing in the MVP.

---

### D-09 — Surface-routing approach

- **Status:** `UNDECIDED`
- **The question:** the method used to route runoff across the 2D terrain — the point we choose on the physical-fidelity vs. runtime trade-off.
- **Must be known first:** DEM resolution (D-04); pilot extent (D-02); the runtime target we set for "real-time" (`SIH_REQUIREMENTS.md` Q2); how the candidate method exchanges water with the drainage network (D-07); numerical stability at the intended timestep.
- **The tension, stated plainly:** the PS requires both a physically coupled 2D surface model and "instant" operation. Higher-fidelity hydrodynamics costs runtime; simplified routing costs physical realism. **We have not chosen, and we will not choose before measuring.**
- **Depends on:** D-02, D-04. **Blocks:** D-07, SR-05, SR-13, and the performance story.

---

### D-10 — Database

- **Status:** `UNDECIDED`
- **The question:** how raster, vector, graph and time-series forecast data are stored and served.
- **Must be known first:** the shape and volume of what we actually store (rasters per timestep, network graph, per-segment forecast series); read patterns of the dashboard and API; whether a database is needed at all for a 48-hour prototype, or whether files plus an in-process store suffice.
- **Standing constraint:** do not adopt infrastructure the prototype does not need. Complexity that does not serve a requirement in `SIH_REQUIREMENTS.md` is a cost, not a feature.
- **Depends on:** the output schema, which is not yet designed. **Blocks:** backend implementation.

---

### D-11 — GIS framework

- **Status:** `UNDECIDED`
- **Covers two separate things** that must not be conflated:
  1. **Geospatial processing** — DEM handling, reprojection, raster/vector operations in the pipeline.
  2. **Web map rendering** — how the dashboard displays layers in a browser.
- **Must be known first:** the formats our chosen data actually arrives in (D-03, D-04, D-05); the volume of features and timesteps to render; base map licensing for public demonstration; each option's ability to render time-varying layers smoothly.
- **Depends on:** D-04, D-05, D-02. **Blocks:** SR-12.

---

### D-12 — Routing framework

- **Status:** `UNDECIDED`
- **The question:** how flood-safe routes are computed over the road network with flood-derived costs.
- **Must be known first:** the road network source, its connectivity quality and licence (SR-10, SR-14); whether the routing must be time-aware (PRD R18.5 — our proposal, not an SIH requirement); required response time; whether flood cost is applied as a penalty or a hard exclusion; whether an existing routing engine can accept dynamic per-edge costs at the cadence we need.
- **Depends on:** D-01, D-02, the flood output schema. **Blocks:** SR-14, SR-15.

---

### D-13 — Deployment strategy

- **Status:** `UNDECIDED`
- **The question:** where and how the system runs for the demo — local machine, single VM, containers, or hosted — and whether the demo depends on network access at judging time.
- **Must be known first:** compute demands of the chosen routing and hydraulic methods (D-07, D-09); whether the demo requires a live data feed (D-05); the reliability of network access at the venue; how long a cold start takes.
- **Standing constraint:** the demo must not fail because of connectivity. A run that can be triggered without live internet should exist as a fallback, clearly labelled as replay or scenario mode rather than live.
- **Depends on:** D-05, D-07, D-09. **Blocks:** the demo plan.

---

## 3. Decisions deliberately NOT being made yet

To be explicit, so that no one treats silence as consent:

- The system architecture (services, boundaries, data flow) — **not designed.**
- Programming languages and runtimes — **not chosen.**
- Any library, package or dependency — **none selected, none installed.**
- API schema and endpoint design — **not designed.**
- The forecast timestep and spatial resolution — **not chosen.**
- Severity/depth-band thresholds — **not defined**, and must come from a citable source or be declared as our own working thresholds (PRD R15.4, A11).
- The runtime target that operationalises "real-time" — **not set** (`SIH_REQUIREMENTS.md` Q2).
- The demo script — **not written.**

---

## 4. External references — unaudited

The following repositories were identified as *possibly* relevant. **None has been cloned, inspected, benchmarked or licence-checked. Nothing in this project depends on any of them, and none may be used until audited.**

| Repository | Status |
|---|---|
| `github.com/sarthakbond/disastr` | **UNAUDITED** — relevance, licence, quality all unknown |
| `github.com/AriMarkowitz/UrbanFloodNet` | **UNAUDITED** |
| `github.com/zhu-xlab/UrbanFloodCastV1` | **UNAUDITED** |
| `github.com/USEPA/Stormwater-Management-Model` | **UNAUDITED** |
| `github.com/pyswmm/pyswmm` | **UNAUDITED** |
| `github.com/MarkusPic/swmm_api` | **UNAUDITED** |

**Audit checklist to apply to each, when that stage is authorised:** what it actually does; licence and whether it permits our use; maintenance status; whether it runs at all in our environment; installation and build cost within a 48-hour budget; whether it solves a requirement in `SIH_REQUIREMENTS.md` or merely looks adjacent; what it would force us to adopt elsewhere.

A **YouTube reference video** was also supplied. It is **UI/product inspiration only**. It has no authority over requirements, and no claim it makes about system capability may be repeated by us as fact.

---

## 5. Decision log

*Empty. No decisions have been made.*

---

## Related documents

- `docs/PRD.md` — what we are building.
- `docs/SIH_REQUIREMENTS.md` — the problem statement decomposed, with traceability and identified ambiguities.
