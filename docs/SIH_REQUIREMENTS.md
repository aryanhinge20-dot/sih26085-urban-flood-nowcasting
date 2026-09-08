# SIH26085 — Requirements Decomposition

**Status:** DRAFT v0.1 — planning stage. No technology chosen.
**Purpose:** turn the official problem statement into testable engineering requirements, and keep a traceable line from each SIH sentence to a demonstrable artefact.
**Last updated:** 2026-09-08

---

## 1. Source of truth

The text below is the official SIH26085 problem statement as supplied to us. **It is the authority.** Any requirement in this repository that cannot be traced back to this text is *ours*, and must be labelled as such (see `docs/PRD.md` §0).

> Urban flooding in major Indian metros like Mumbai, Delhi, and Chennai has become an annual crisis. Traditional Numerical Weather Prediction (NWP) models fall short because knowing how much rain will fall does not automatically translate into knowing where the streets will flood.
>
> Urban flooding is a hyper-local phenomenon dictated by micro-topography, concrete imperviousness, and heavily strained, invisible drainage networks. Currently, municipal bodies lack real-time, street-level predictive systems. Consequently, cities are caught off guard by rapid water accumulation, leading to severe traffic gridlocks, economic disruption, and loss of life.
>
> The challenge is to design a high-resolution, real-time Urban Flood Nowcasting System (0–3 hour lead time) capable of predicting street-level inundation before it happens.
>
> Participants must move away from isolated weather models and instead build a coupled framework. This system must fuse real-time rainfall nowcasts with high-resolution Digital Elevation Models (DEM) and a graph-based mathematical model of the city's underground drainage network. By mapping how water flows, accumulates, and surcharges across concrete surfaces and drainage nodes, the solution should pinpoint exactly which streets or intersections will flood.
>
> Develop a pipeline that takes high-resolution rainfall nowcasts (from Doppler Weather Radars) and instantly routes that volume across a 2D surface terrain model. Represent the city's stormwater drain network as a directed graph (nodes as manholes/inlets, edges as pipes/canals). The model must calculate hydraulic capacity and predict where blockages or overcapacity will cause backflow onto the streets.
>
> A dynamic, web-based GIS dashboard showing real-time, street-by-street flooding projections (e.g., water depth estimations in centimetres) with a 0–3 hour forward-looking window.
>
> An API utility that can interface with navigation maps to suggest flood-safe alternative routes for emergency services, public transit, and commuters during heavy downpours.

### Conventions used below

- **SR-nn** — a requirement derived from the PS text. Each cites the phrase it comes from.
- **Derivation** — `EXPLICIT` (the PS states it in words) or `IMPLIED` (the PS cannot be satisfied without it). Nothing here is invented; anything we want that is not derivable lives in `docs/PRD.md` as **[PROPOSED]**.
- **Verify before implementation** — the open question that must be answered with evidence before writing code for this requirement. These are the hard gates.

---

## 2. Requirements

### SR-01 — Ingest a high-resolution rainfall nowcast

- **Derivation:** EXPLICIT — *"takes high-resolution rainfall nowcasts (from Doppler Weather Radars)"*; *"fuse real-time rainfall nowcasts"*.
- **Requirement:** The system shall ingest a spatially gridded rainfall nowcast covering the study area and the 0–3 hour forward window, and use it as the driver of the flood computation.
- **Why it exists:** The PS's opening argument is that NWP is insufficient because it is not hyper-local. A radar-derived nowcast is the input that makes hyper-local prediction possible at all. Without it there is nothing to route.
- **Required input:** Gridded rainfall intensity or accumulation with timestamps, a spatial reference, and a spatial resolution finer than the phenomenon being predicted.
- **Expected output:** A normalised, internally-consistent rainfall field per timestep over the study area, on the model's working grid.
- **Demonstration to a judge:** Show the raw incoming nowcast product, then the same field after ingestion/reprojection rendered as a map layer, with source name, resolution, timestamp, and the age of the data displayed on screen.
- **Verify before implementation:**
  1. Is Doppler Weather Radar data for a candidate Indian city obtainable by us, programmatically, within the hackathon window? Under what licence?
  2. Is a *nowcast* product available, or only observations we would have to extrapolate ourselves? These are different scopes of work.
  3. Native spatial and temporal resolution, and update latency.
  4. If radar is not obtainable: what is the honest fallback, and does it still satisfy "high-resolution"? Any fallback must be declared in the UI, not hidden.

---

### SR-02 — Produce a 0–3 hour forward-looking forecast

- **Derivation:** EXPLICIT — *"(0–3 hour lead time)"*; *"with a 0–3 hour forward-looking window"*.
- **Requirement:** The system shall produce flood predictions for a set of future timesteps spanning from now to +3 hours, and shall refresh them as new rainfall input arrives.
- **Why it exists:** The entire value proposition is *lead time* — predicting "before it happens". A nowcast that only describes the present is a monitoring system, not the system asked for.
- **Required input:** Rainfall nowcast covering the full window (SR-01); a model capable of time-stepping.
- **Expected output:** A time-indexed sequence of flood states from T+0 to T+3h, each with an explicit valid-time.
- **Demonstration to a judge:** Move a time slider from now to +3 h and show the flood footprint growing and shifting; point at a specific street and state the predicted onset time and depth for a future instant.
- **Verify before implementation:**
  1. Does the chosen rainfall product actually extend to +3 h, or only shorter? If shorter, the honest horizon is shorter and must be stated.
  2. Timestep length — must be short enough to resolve flood onset, long enough to run in time. Not yet chosen.
  3. Does the full pipeline complete quickly enough for a rolling refresh to be meaningful?

---

### SR-03 — Fuse a high-resolution Digital Elevation Model

- **Derivation:** EXPLICIT — *"fuse real-time rainfall nowcasts with high-resolution Digital Elevation Models (DEM)"*; *"micro-topography"*.
- **Requirement:** The system shall use a DEM of the study area to determine where water flows and accumulates, at a resolution capable of distinguishing between streets.
- **Why it exists:** The PS names micro-topography as a governing cause of hyper-local flooding. Terrain is what converts "rain fell here" into "water arrived there".
- **Required input:** DEM raster for the study area with a known vertical datum, resolution and accuracy.
- **Expected output:** A hydrologically conditioned terrain surface with derived flow directions, slopes and depressions.
- **Demonstration to a judge:** Show the DEM and derived flow paths/sinks over the study area, then show that predicted ponding coincides with the derived depressions rather than being painted arbitrarily.
- **Verify before implementation:**
  1. The best DEM resolution and vertical accuracy actually obtainable, free and legally, for each candidate city. **"High-resolution" is not quantified in the PS and we must not quietly define it downward.**
  2. Whether that resolution supports street-level discrimination. If it does not, the pilot area shrinks and the limitation is stated — we do not claim precision the data cannot support.
  3. Whether the DEM includes buildings/vegetation (surface model) or bare earth (terrain model) — this materially changes urban flow routing.

---

### SR-04 — Represent concrete imperviousness in runoff generation

- **Derivation:** EXPLICIT (as a governing factor) — *"dictated by micro-topography, concrete imperviousness, and … drainage networks"*; *"across concrete surfaces"*.
- **Requirement:** The system shall convert rainfall into surface runoff using a spatially varying representation of imperviousness.
- **Why it exists:** The PS identifies imperviousness as one of three drivers. Treating the city as uniformly absorbent or uniformly sealed would discard a factor the PS explicitly names.
- **Required input:** A land-cover or imperviousness layer for the study area; a documented rainfall→runoff method with sourced parameters.
- **Expected output:** Runoff depth or volume per model unit per timestep.
- **Demonstration to a judge:** Show the imperviousness layer, then show two runs with identical rainfall over a sealed area and a green area, and the difference in resulting runoff.
- **Verify before implementation:**
  1. What imperviousness/land-cover data exists for the pilot area, at what resolution and licence.
  2. Which runoff method we adopt, and whether every parameter can be cited to published literature. **No parameter goes into the model from memory.**
  3. Whether antecedent wetness can be represented with data we actually have; if not, it becomes a declared assumption.

---

### SR-05 — Route runoff across a 2D surface terrain model

- **Derivation:** EXPLICIT — *"instantly routes that volume across a 2D surface terrain model"*; *"mapping how water flows, accumulates"*.
- **Requirement:** The system shall route generated runoff over the terrain in two dimensions and over time, producing surface water depth that evolves through the forecast window.
- **Why it exists:** This is the mechanism that turns rainfall into location-specific water. It is the step the PS says NWP is missing.
- **Required input:** Runoff field (SR-04); conditioned terrain (SR-03); a timestep; exchange terms with the drainage network (SR-08).
- **Expected output:** Time-varying surface water depth across the study area.
- **Demonstration to a judge:** Animate surface depth accumulating over the 0–3 h window and show water travelling downslope and pooling in low points, with a volume-conservation figure displayed.
- **Verify before implementation:**
  1. Which routing method meets both "2D surface terrain model" and "instantly" (SR-13). This is a genuine tension and is unresolved — see `docs/DECISIONS.md` → *surface-routing approach*.
  2. Grid resolution and timestep at which the method remains stable.
  3. Measured runtime at the pilot area's size, before committing.

---

### SR-06 — Represent the stormwater network as a directed graph

- **Derivation:** EXPLICIT — *"Represent the city's stormwater drain network as a directed graph (nodes as manholes/inlets, edges as pipes/canals)"*; *"a graph-based mathematical model of the city's underground drainage network"*.
- **Requirement:** The system shall model the stormwater drainage system as a directed graph whose nodes are manholes/inlets/junctions/outfalls and whose edges are pipes/drains/canals, each carrying the attributes needed for hydraulic computation.
- **Why it exists:** The PS names this representation specifically. It is the distinguishing structure of this problem statement and a judge will look for it explicitly.
- **Required input:** Drainage network geometry and attributes — node locations, ground and invert elevations, edge shape/size/length/slope/roughness, and connectivity with direction.
- **Expected output:** A queryable directed graph with per-node and per-edge attributes, aligned spatially with the terrain and the road network.
- **Demonstration to a judge:** Render the graph on the map; click a node to show its attributes and its upstream/downstream edges; state the provenance of every attribute.
- **Verify before implementation:**
  1. **Does real stormwater network data exist and can we obtain it for any candidate city?** This is the highest-risk unknown in the project — the PS itself calls the network "invisible".
  2. If real data exists: which of the required attributes does it carry, and which would we have to assume?
  3. If it does not exist: is a synthetic network derived from roads and terrain acceptable? Our position: **yes, but only if labelled synthetic everywhere it appears and its derivation is published.** Presenting a synthesised network as a real municipal network would be fabrication.

---

### SR-07 — Calculate hydraulic capacity

- **Derivation:** EXPLICIT — *"The model must calculate hydraulic capacity"*.
- **Requirement:** The system shall compute, for each edge, the flow it is able to carry, and shall compute the flow actually being carried per timestep, using a stated and citable hydraulic formulation.
- **Why it exists:** Capacity is the threshold that separates "the drain copes" from "the drain overflows". Without it, surcharge (SR-08) cannot be predicted, only guessed.
- **Required input:** Edge geometry, slope, roughness (SR-06); inflow from the surface at each node (SR-05).
- **Expected output:** Per-edge capacity, per-edge flow, and utilisation (flow ÷ capacity) per timestep; per-node inflow and water level.
- **Demonstration to a judge:** Colour the network by utilisation as rainfall intensifies and show edges progressing from under-used to at-capacity; open one edge and show the capacity calculation's inputs and the formulation used.
- **Verify before implementation:**
  1. Which hydraulic formulation — a steady capacity approximation or an unsteady flow solution — is both defensible and fast enough (see `docs/DECISIONS.md` → *hydraulic engine*).
  2. Source for roughness and other coefficients. Must be a published table with a citation.
  3. Whether the attribute completeness found in SR-06 supports the chosen formulation at all.

---

### SR-08 — Predict blockage/overcapacity surcharge and backflow onto streets

- **Derivation:** EXPLICIT — *"predict where blockages or overcapacity will cause backflow onto the streets"*; *"how water … surcharges across concrete surfaces and drainage nodes"*.
- **Requirement:** The system shall detect, per node and per timestep, when the network can no longer accept water — because of overcapacity or because of blockage — shall quantify the volume that emerges at that node, and shall return that volume to the surface model where it re-routes and pools.
- **Why it exists:** This is the causal heart of the problem statement: the link between the invisible underground network and the visible flooded street. A system that does not do this has not solved SIH26085, whatever else it does.
- **Required input:** Node ground elevations, network water levels and capacities (SR-06, SR-07); a blockage representation; a coupling back into SR-05.
- **Expected output:** Per node, per timestep — surcharging yes/no, surcharge volume/rate, and the attributed cause (overcapacity vs. blockage).
- **Demonstration to a judge:** Run an identical rainfall scenario twice, once with a chosen drain unblocked and once blocked; show the surcharge appearing at that node and the street above it flooding in the second run. This single comparison demonstrates SR-06, SR-07 and SR-08 together and is the strongest evidence we can put in front of a judge.
- **Verify before implementation:**
  1. How blockage is represented and parameterised, and whether any real data on drain condition exists (if not, it is a scenario input, declared as such).
  2. That the coupling conserves volume — no water invented or lost at the exchange.
  3. Numerical stability of the surface↔network exchange at the chosen timestep.

---

### SR-09 — Build a genuinely coupled framework, not isolated models

- **Derivation:** EXPLICIT — *"Participants must move away from isolated weather models and instead build a coupled framework"*; *"must fuse …"*.
- **Requirement:** Rainfall, terrain/surface routing, and the drainage graph shall be coupled in a single computation with a two-way exchange between surface and network, not run as independent components whose outputs are merely displayed together.
- **Why it exists:** The PS makes this the central methodological demand. Three separate models on one map is precisely what it tells participants not to do.
- **Required input:** SR-01, SR-03, SR-04, SR-05, SR-06, SR-07, SR-08 as one pipeline.
- **Expected output:** A single flood state per timestep in which changing any one input demonstrably changes the whole result.
- **Demonstration to a judge:** Change one input at a time — rainfall intensity, a node's blockage, terrain in one block — and show that the street-level output changes in each case, proving the components are wired together rather than co-displayed.
- **Verify before implementation:**
  1. That the coupling direction and frequency (how often surface and network exchange water) is explicitly designed, not incidental.
  2. That volume conservation is testable across the whole coupled system.

---

### SR-10 — Pinpoint which streets and intersections will flood

- **Derivation:** EXPLICIT — *"pinpoint exactly which streets or intersections will flood"*; *"street-level inundation"*; *"street-by-street"*.
- **Requirement:** The system shall attribute predicted flooding to identified street segments and intersections of the road network, not merely to raster cells or to areas.
- **Why it exists:** The PS's stated failure of existing systems is that they do not tell a city *which street*. Named, addressable locations are what a control room and a routing engine can act on.
- **Required input:** Surface depth field (SR-05, SR-08); a road network with segments, junctions and names.
- **Expected output:** Per street segment and per intersection — predicted depth per timestep, with an identifier and a name.
- **Demonstration to a judge:** Show a ranked list of specific named streets and junctions with predicted depth and onset time; click one and see it highlighted on the map.
- **Verify before implementation:**
  1. Availability, completeness and licence of a road network for the pilot area, including names and junction topology.
  2. The rule for aggregating cell depths onto a segment (mean, maximum, or depth at the segment's lowest point) — each gives a different number and the choice must be stated, not left implicit.
  3. Whether "street-level" is best served at segment granularity — our working interpretation, recorded as an assumption in `docs/PRD.md` §28 (A13).

---

### SR-11 — Report water depth in centimetres

- **Derivation:** EXPLICIT — *"water depth estimations in centimetres"*.
- **Requirement:** Predicted inundation shall be expressed as a water depth in centimetres, in the dashboard and in the API.
- **Why it exists:** The PS gives this as the concrete form of the output. Depth in centimetres is also what makes the output actionable — it is what determines whether a vehicle can pass.
- **Required input:** Surface depth from SR-05/SR-08, aggregated per SR-10.
- **Expected output:** A numeric depth in cm per segment per timestep, alongside the qualitative map rendering.
- **Demonstration to a judge:** Hover or click any street and read a number in centimetres; show that the number changes across the time slider.
- **Verify before implementation:**
  1. Whether the DEM's vertical accuracy justifies the precision we display. Reporting centimetres from a DEM whose vertical error is much larger requires us to state the uncertainty alongside the number.
  2. Rounding/precision policy — no false precision.

---

### SR-12 — Dynamic, web-based GIS dashboard

- **Derivation:** EXPLICIT — *"A dynamic, web-based GIS dashboard showing real-time, street-by-street flooding projections … with a 0–3 hour forward-looking window"*.
- **Requirement:** The system shall provide a web-based map interface displaying street-level flood projections in centimetres, with a control for moving through the 0–3 hour window, updating as new model runs complete.
- **Why it exists:** It is a named deliverable, and it is the interface through which the primary user — the control room — consumes everything else.
- **Required input:** Street-level forecast (SR-10, SR-11) over the timeline (SR-02); a base map.
- **Expected output:** A running web application.
- **Demonstration to a judge:** Open it in a browser and drive the whole demo from it.
- **Verify before implementation:**
  1. Base map licensing for public demonstration.
  2. Payload size and rendering performance for the number of segments and timesteps in the pilot area.

---

### SR-13 — Real-time / "instant" operation

- **Derivation:** EXPLICIT — *"real-time Urban Flood Nowcasting System"*; *"instantly routes that volume"*; *"real-time, street-by-street flooding projections"*.
- **Requirement:** A full pipeline run producing the 0–3 hour forecast shall complete quickly enough that the forecast is still meaningfully ahead of the event, and the dashboard shall reflect the latest completed run.
- **Why it exists:** A 3-hour forecast that takes 3 hours to compute has zero lead time. Speed is not a nice-to-have here; it is what makes the output a nowcast.
- **Required input:** The complete pipeline; a defined pilot area extent.
- **Expected output:** A measured, published wall-clock runtime for a full run, plus a visible "last updated" and "data age" indicator in the UI.
- **Demonstration to a judge:** Trigger a run live and show it completing, with the elapsed time on screen.
- **Verify before implementation:**
  1. **The PS does not quantify "real-time".** We must set our own target, justify it against the 0–3 h horizon and the rainfall update cadence, and state it as our target rather than as an SIH requirement.
  2. Runtime must be measured on the actual pilot area before any performance claim is made anywhere.

---

### SR-14 — Flood-safe routing API interfacing with navigation maps

- **Derivation:** EXPLICIT — *"An API utility that can interface with navigation maps to suggest flood-safe alternative routes"*.
- **Requirement:** The system shall expose a documented API that, given an origin and destination, returns a route avoiding predicted flooding, in a form an external navigation system can consume.
- **Why it exists:** It is a named deliverable and the mechanism by which the forecast reaches people in the field.
- **Required input:** Road network with connectivity (SR-10); street-level flood forecast (SR-10, SR-11); a routing computation over a flood-weighted network.
- **Expected output:** A route geometry plus metadata, in a documented, machine-readable schema; and the reason any avoided segment was avoided.
- **Demonstration to a judge:** Call the API live (from the dashboard and from a raw HTTP client) for a route crossing a predicted flood point, and show the returned path diverting around it — alongside the same request with flooding disabled, which goes straight through.
- **Verify before implementation:**
  1. What "interface with navigation maps" requires in practice — a documented open API with standard geometry formats is our reading; live integration with a commercial provider is treated as a stretch, not as the requirement.
  2. Whether the road network's connectivity is good enough for routing (a network fine for display can still be unroutable).
  3. Whether the API's flood input is "flooded now" or "flooded when you get there". The PS does not say; time-aware routing is our proposal (PRD R18.5), not an SIH requirement.

---

### SR-15 — Serve emergency services, public transit, and commuters

- **Derivation:** EXPLICIT — *"for emergency services, public transit, and commuters during heavy downpours"*.
- **Requirement:** The routing capability shall be usable by all three named audiences.
- **Why it exists:** The PS names the beneficiaries. It also implies that one flood forecast must serve several very different decision-makers.
- **Required input:** SR-14, plus any per-audience parameters.
- **Expected output:** Routing responses appropriate to the caller.
- **Demonstration to a judge:** Show the same origin–destination pair queried for an emergency vehicle and for a commuter, and explain what differs (or, if nothing differs in the prototype, say so plainly rather than implying differentiation we did not build).
- **Verify before implementation:**
  1. Whether differentiated depth tolerance per vehicle class can be sourced from published guidance. If not, it is our assumption and must be labelled (PRD R18.6, A11).
  2. Whether transit-specific needs (fixed routes, depots) are in scope for 48 hours — likely stretch.

---

### SR-16 — Applicable to a major Indian metro context

- **Derivation:** EXPLICIT (as context) — *"major Indian metros like Mumbai, Delhi, and Chennai"*.
- **Requirement:** The system shall be demonstrated on a real Indian urban area, using that area's real geography.
- **Why it exists:** The PS is framed around Indian metro flooding. A demo on synthetic or foreign geography would not answer it.
- **Required input:** A chosen city and a bounded pilot area within it (see `docs/DECISIONS.md`).
- **Expected output:** All layers georeferenced to a real Indian location.
- **Demonstration to a judge:** Recognisable streets, named in the local road network, on a real base map.
- **Verify before implementation:**
  1. Which city has the best *combination* of available data (SR-01, SR-03, SR-04, SR-06, SR-10) — the choice should follow the data, not the reverse.
  2. The word "like" means Mumbai/Delhi/Chennai are examples, not a closed list. Choosing another Indian metro is permissible if the data supports it better — but the reasoning must be recorded.

---

## 3. Requirements traceability

**How to read:** each row runs SIH text → our requirement → the *kind* of technical component that will implement it → how it is validated and shown. **The component column deliberately names capabilities, not products.** No library, framework, engine or model has been chosen; see `docs/DECISIONS.md`.

| SIH req | SIH source phrase | Product requirement (`PRD.md`) | Planned technical component (**undecided — capability only**) | Validation / demo method |
|---|---|---|---|---|
| SR-01 | "high-resolution rainfall nowcasts (from Doppler Weather Radars)" | §8, R8.1–R8.3 | Rainfall ingestion + reprojection/resampling stage | Show raw vs. ingested rainfall layer with source, resolution, timestamp; V-runtime of ingest |
| SR-02 | "0–3 hour lead time", "forward-looking window" | §16, R16.1–R16.3 | Time-stepped forecast driver producing indexed frames | Time slider across the window; onset time quoted for a named street |
| SR-03 | "high-resolution Digital Elevation Models" | §9, R9.1–R9.2 | DEM ingestion + hydrological conditioning + flow-direction derivation | Overlay derived sinks/flow paths against predicted ponding (PRD V2) |
| SR-04 | "concrete imperviousness" | §10, R10.1–R10.2 | Land-cover→runoff transformation with spatial parameters | Paired run: sealed vs. permeable area under identical rainfall |
| SR-05 | "routes that volume across a 2D surface terrain model" | §11, R11.1–R11.4 | 2D surface routing solver (method undecided) | Animated depth evolution + volume-conservation check (PRD V1) |
| SR-06 | "directed graph (nodes as manholes/inlets, edges as pipes/canals)" | §12, R12.1–R12.4 | Drainage graph data model + loader + spatial alignment | Click a node/edge, show attributes and provenance flag |
| SR-07 | "must calculate hydraulic capacity" | §13, R13.1–R13.4 | Hydraulic capacity + flow-routing computation on the graph | Network coloured by utilisation as rainfall rises; open one edge's calculation |
| SR-08 | "blockages or overcapacity will cause backflow onto the streets" | §14, R14.1–R14.4 | Surcharge detection + surface return coupling + cause attribution | **A/B blocked vs. unblocked drain run** — the headline demo |
| SR-09 | "coupled framework", "must fuse" | §7, R11.3, R14.3 | Orchestrated pipeline with two-way surface↔network exchange | Perturb one input at a time; show the whole output responds |
| SR-10 | "pinpoint exactly which streets or intersections" | §15, R15.1 | Cell→street-segment aggregation against a road network | Ranked named-street list, click-to-locate on map |
| SR-11 | "water depth estimations in centimetres" | §15, R15.2 | Depth output in cm in both dashboard and API payloads | Read a cm value per street per timestep; state uncertainty alongside |
| SR-12 | "dynamic, web-based GIS dashboard" | §17, R17.1–R17.4 | Web map application + tile/feature delivery from the backend | Run the entire demo from the browser |
| SR-13 | "real-time", "instantly" | §11 R11.4, §16 R16.3 | Pipeline orchestration + measured performance budget | Live run with elapsed time shown (PRD V5); "last updated" indicator |
| SR-14 | "API … flood-safe alternative routes" | §18, R18.1–R18.3 | Flood-weighted routing service + documented HTTP API | Live API call with and without flood weighting, side by side |
| SR-15 | "emergency services, public transit, and commuters" | §3, §18 R18.4 | Caller-parameterised routing requests | Same O–D queried per audience; differences stated honestly |
| SR-16 | "major Indian metros like Mumbai, Delhi, Chennai" | §21, D1–D8 | Pilot-area definition and real georeferenced datasets | Recognisable, named local geography on a real base map |

### Coverage check

Every deliverable sentence in the PS maps to at least one SR: rainfall nowcast (SR-01), 0–3 h (SR-02), DEM (SR-03), imperviousness (SR-04), 2D routing (SR-05), directed graph (SR-06), hydraulic capacity (SR-07), backflow (SR-08), coupling (SR-09), street/intersection pinpointing (SR-10), centimetres (SR-11), dashboard (SR-12), real-time (SR-13), routing API (SR-14), three audiences (SR-15), Indian metro (SR-16).

**No SR in this document originates anywhere other than the PS text quoted in §1.** Everything else we intend to build is in `docs/PRD.md` under **[PROPOSED]** or **[STRETCH]**.

---

## 4. Ambiguities in the problem statement

Recorded so that we resolve them deliberately and can tell a judge how we interpreted the brief. **These are gaps in the PS, not in our plan** — but each one is a place where we must state our reading rather than assume agreement.

| # | Ambiguity | Why it matters | Our provisional reading (not yet fixed) |
|---|---|---|---|
| Q1 | **"High-resolution" is never quantified** — for either the rainfall nowcast or the DEM. | Determines whether "street-level" is achievable at all, and what we may claim. | Use the best resolution actually obtainable, publish it explicitly, and size the pilot area to match. Do not redefine "high-resolution" downward in silence. |
| Q2 | **"Real-time" / "instantly" is never quantified.** | Sets the performance bar and drives the physics-vs-speed trade-off (SR-05, SR-07). | Set our own runtime target, justify it against the 3-hour horizon and the rainfall refresh interval, and present it as our target. |
| Q3 | **Drainage network data availability is not addressed.** The PS calls the network "invisible" but requires a graph model of it. | This is the project's central data risk. It may be unobtainable. | If real data is unavailable, use a synthetic network derived from roads and terrain — labelled synthetic everywhere, methodology published. |
| Q4 | **The required fidelity of the hydraulic model is unspecified** — "calculate hydraulic capacity" spans everything from a capacity threshold to full unsteady flow. | Decides the engine and most of the implementation cost. | Choose the simplest formulation that reproduces surcharge behaviour credibly, and state its limits. Undecided. |
| Q5 | **"Street-level" granularity is undefined** — segment, intersection, block, or address. | Determines the output schema and the aggregation rule. | Street segments and intersections (PS says "streets or intersections"). Recorded as assumption A13. |
| Q6 | **"Interface with navigation maps" is undefined** — an open API, a data feed, or live integration with a commercial provider. | Determines the scope of SR-14 significantly. | A documented open API with standard geometry, demonstrably consumable. Commercial integration = stretch. |
| Q7 | **No accuracy or validation standard is specified.** | Without one, "it works" is unfalsifiable. | Impose our own protocol (PRD §23) and report results honestly, including where we could not validate. |
| Q8 | **Spatial scope is unstated** — whole city or a demonstrable area. | Drives every runtime and data decision. | Bounded pilot area for the prototype, with the scaling path described and runtime evidence given. |
| Q9 | **"Blockages" are named as a cause but no source of blockage data is implied.** | We cannot know which real drains are blocked. | Treat blockage as a scenario/what-if parameter, clearly declared — not as an observed condition. |
| Q10 | **The relationship between "nowcast" and "prediction" is left open** — do we generate the rainfall nowcast, or consume one? | Doubles or halves the scope of SR-01. | Consume a nowcast if one is available; generating one from radar sequences is a separate work package that we take on only if forced and if time allows. |
| Q11 | **"Mumbai, Delhi, and Chennai" — examples or a required list?** ("metros **like**") | Constrains city choice. | Read as examples. Any Indian metro is acceptable; choose by data availability and record the reasoning. |
| Q12 | **Multi-user needs are named but not differentiated** (SR-15). | Determines whether we must build three interfaces or one. | One forecast, one dashboard, one API with caller parameters. State plainly if the prototype does not differentiate. |

---

## 5. Implementation status (backend, updated 2026-09-09)

Section 3 above was written before implementation and deliberately left the technical component
undecided. All D-01..D-13 decisions in `docs/DECISIONS.md` are now DECIDED, and the pilot backend
(`backend/floodnet/`) is running against the real Mumbai Hindmata/Dadar network. Status key: **COMPLETE**
(implemented and verified against real/cited data), **PARTIAL** (implemented but with a stated, real gap),
**DEMONSTRATION ONLY** (works but not on live/verified data), **SCIENTIFIC LIMITATION** (implemented, but a
known modelling simplification is documented rather than hidden — see `docs/VALIDATION.md`).

| SR | Status | Evidence |
|---|---|---|
| SR-01 rainfall nowcast input | **PARTIAL** | `floodnet/rainfall/provider.py`: `ScenarioProvider` (SYNTHETIC) + `HistoricalReplayProvider` (REAL, 26 July 2005) + `IMDObservationProvider` (REAL live observation from api.imd.gov.in when `IMD_API_KEY` is configured — see `docs/LIVE_RAINFALL_AUDIT.md` for the full official-source audit). No IMD source, gated or not, publishes a quantitative sub-hourly nowcast product, so live input is an explicitly-labelled ESTIMATED persistence forecast from a real 24h observed total, never presented as radar-derived. `ExternalNowcastProvider` stays an inert stub for a future radar/pysteps adapter. |
| SR-02 0–3 h horizon | **COMPLETE** | `simulation/engine.py::run_simulation(horizon_s=..., frame_dt_s=300)`; API `horizon_min` 5–720, default 180; 37 frames at 5-min resolution. |
| SR-03 high-resolution DEM | **COMPLETE**, with a stated caveat | Real MCGM 20 cm contour-derived DTM, 10 m grid; agrees with 1,205 surveyed manhole ground levels to mean +0.012 m / SD 0.283 m pilot-wide; 0.65% of the grid (407 cells) is flagged (not altered) as inconsistent with the surveyed network — see `docs/validation/EXTREME_DEPTH.md`. |
| SR-04 imperviousness/runoff | **COMPLETE** | OSM-derived impervious fraction (ESTIMATED) driving the rational-method runoff coefficient in `terrain/runoff.py`. |
| SR-05 2D surface routing | **COMPLETE**, **SCIENTIFIC LIMITATION** noted | Storage-cell diffusive-wave scheme (`terrain/surface.py`, Bates & De Roo 2000 family) with an open (free-outfall) domain boundary; no lateral-momentum term — documented as the likely cause of the still-open `july2005` extreme-depth question in `docs/VALIDATION.md` §5/§9. |
| SR-06 directed drainage graph | **COMPLETE** | Real MCGM stormwater network (`data/mcgm.py`), real inverts/diameters/connectivity where published, ESTIMATED roughness (cited). |
| SR-07 hydraulic capacity | **COMPLETE**, cross-checked | Manning capacity-limited solver (`drainage/hydraulics.py`); cross-checked against a real PySWMM/DYNWAVE run on the same network (`floodnet/validation/swmm_compare.py`) — edge-flow ranking agrees (Spearman 0.74), node-level agreement is weak (Jaccard 0.10) for an explained, documented reason (capacity-limited vs. full Saint-Venant with backwater), not silently reconciled. |
| SR-08 blockage/overcapacity surcharge | **COMPLETE** | `drainage/scenarios.py::apply_blockage` + surcharge-to-surface coupling; verified every run via `scripts/demo_check.py` (blocked > normal on surcharge, surface water, flooded segments; blocked ≤ normal on outfall discharge). |
| SR-09 coupled framework | **COMPLETE** | One loop, `simulation/engine.py::run_simulation` — rainfall → runoff → surface → inlet capture → drainage → surcharge → surface → frame, every step exchanging real arrays; no hardcoded or frontend-generated flood values (checked: `frontend/*.js` contains no random/mock data generation). |
| SR-10 street/intersection attribution | **COMPLETE** | `streets/aggregate.py::make_street_fn` (grid depth → per-segment max, now cached per pilot); per-node `Frame.node_cause` ("overcapacity"/"blockage"/"downstream") already served over the API; a structured `GET /api/simulation/{run_id}/explain/{seg_id}` endpoint (this pass) adds depth/rainfall/nearest-drainage-node/dominant-cause in one response. |
| SR-11 depth in cm | **COMPLETE** | Metres internally, cm only at the API/UI boundary (`api/main.py::serialize_frame`, `streets_geojson`). |
| SR-12 dynamic GIS dashboard | **PARTIAL** | Functional Leaflet dashboard exists and is exercised by `scripts/demo_check.py`'s `frontend_loads`/`api_*` checks; React migration is explicitly out of scope for this backend-focused pass. |
| SR-13 real-time / instant | **PARTIAL** | A fresh full-pilot 3 h simulation takes on the order of a minute server-side (measured this pass, `heavy` scenario, real pilot grid) — not sub-second, but within a live-demo budget; identical repeat requests and all read-only endpoints (frame/series/route/status/explain) are sub-second via the caching added this pass. No claim of true real-time streaming ingestion is made. |
| SR-14 flood-safe routing API | **COMPLETE** | `POST /api/route`; regression tests prove the route changes because of predicted flooding (`tests/test_routing_router.py::test_flooded_middle_segment_forces_detour`, `::test_blocked_destination_unreachable`); routing graph construction now cached per pilot rather than rebuilt per call. |

SR-15/SR-16 are about audience differentiation and city applicability, not a backend component; unchanged
from `docs/DECISIONS.md` D-01 (Mumbai, locked).

## Related documents

- `docs/PRD.md` — what we are building, including everything that is **ours** rather than SIH's.
- `docs/DECISIONS.md` — all D-01..D-13 are DECIDED (see that file for evidence per decision).
