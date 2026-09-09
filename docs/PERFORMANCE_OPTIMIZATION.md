# Performance optimization attempt (SIH26085, 2026-09-09)

**Status: investigated, one optimization attempted and validated, then reverted after validation caught a
real discrepancy. Solver code is unchanged from the last verified checkpoint.**

## 1. Profile (representative case: `heavy` scenario, 70% uniform blockage, full 180-min horizon)

| | Self time | Calls |
|---|---|---|
| `terrain/surface.py::_substep` | 88.3s (68%) | 3,905 |
| `drainage/hydraulics.py::step` | 25.5s (20%) | 2,160 |
| everything else (runoff, street aggregation, serialization, snapshotting) | <2s (under 2%) | — |

Baseline runtime: cold run 148.4s, subsequent fresh runs 114-129s.

## 1a. Re-measured 2026-09-09 (later same day, code unchanged -- confirmed via `git diff`)

Four more fresh-process runs of the identical scenario: **37.15s, 40.60s, 89.23s** (plus one earlier
114-148s range). Mass-balance error identical to 12 significant figures across every run
(`-3.771e-12`), confirming the *computation* is fully deterministic — the wall-clock **variance itself is
real and environmental** (machine load/thermal/OS scheduling on this dev machine), not a property of the
code changing. Reporting the full observed range honestly rather than the single most flattering number:
**runtime for this scenario has been observed between ~37s and ~148s on this machine, code unchanged
throughout.** No claim of a specific fixed runtime should be made without controlling for machine load.

## 2. What was investigated in `hydraulics.py::step()`

The drainage network has 48 topological levels for 1,134 edges; 26 of 48 levels (54%) touch ≤5 edges. Each
level iteration called `np.bincount(..., minlength=self.N)` (N=1,233 nodes) four times and recomputed HGL
over the full N-node array, regardless of how few nodes the level actually touched — real, measurable waste
for the many small levels. This is an *outer-loop* inefficiency, not a change to the underlying Manning/
capacity-limiting equations.

## 3. What was attempted

Rewrote the per-level block to compute HGL/free-volume only at the level's own `us`/`ds` node indices, and
replaced the four `np.bincount(..., minlength=N)` calls with `np.add.at`/`np.subtract.at` scatter updates
directly on the state array `V` (cost ∝ level size, not N). Same formulas, same evaluation point relative to
V's mutations, same per-level ordering (topological levels, still processed one at a time).

**Measured: 3.30x speedup (152.24s → 46.20s) for the identical scenario.**

## 4. Validation (why it was reverted)

Built a rigorous frame-by-frame comparison harness (old implementation vs new, same pilot/rainfall/blockage/
horizon) checking every frame's depth grid, node HGL, node surcharging, edge flow, edge utilization, street
depths, and node cause — not just the top-line summary metrics.

**Top-line summary metrics looked deceptively close:**

| metric | OLD | NEW |
|---|---|---|
| peak_depth_cm | 268.72318 | 268.72318 |
| peak_surcharging_nodes | 424 | 424 |
| peak_flooded_streets | 1197 | 1197 |
| total_surcharge_m3 | 124980.698 | 124980.613 |
| mass_balance_error_pct | -3.77e-12 | -3.75e-12 |

**But the detailed, frame-by-frame comparison found real discrepancies these summary numbers masked:**
- max |node_hgl| diff: **2.009 m** (not a rounding error — a genuinely different hydraulic grade line at
  some node)
- max |edge_util| diff: **1.000** (100% — a completely different utilization value on at least one edge)
- `node_cause` differed at 1-4 nodes in 20 of the 37 frames
- max node_surcharging boolean mismatch: 4 nodes in a single frame

This means the rewrite is **not** mathematically equivalent to the original in all cases, despite passing
every summary-statistic check. The exact mechanism was not fully isolated within this pass (candidate
suspects: an edge case in how `np.add.at`/`np.subtract.at` interact with edges inside the same
strongly-connected-component level, or an ordering assumption in the original that the rewrite silently
broke) — root-causing it properly needs dedicated debugging time, not a rushed fix.

**Action taken: reverted immediately.** `backend/floodnet/drainage/hydraulics.py` is byte-identical to the
pre-attempt version. No physics code differs from the last verified checkpoint.

## 5. Why this validation approach matters

This is the exact scenario the project's "no optimization that changes the result materially" rule exists
for: a 3.3x speedup that *looks* safe by every summary metric, but demonstrably is not once checked at the
frame/node/edge level. Shipping it on summary-metric evidence alone would have been a real, hidden
correctness regression.

## 6. `terrain/surface.py::_substep` (68% of runtime) — not attempted

`_substep` allocates ~15-20 new arrays per call (H, dHx, dHy, hx, hy, vx, vy, Vx, Vy, out, scale, hb, q, dh)
across 3,905 calls. A scratch-buffer-reuse pattern (pre-allocate once, use `out=` on every numpy op) is a
plausible, real optimization, but was not attempted this pass — after the hydraulics.py result, the priority
shifted to not shipping a second unvalidated change to frozen physics without a dedicated, unhurried pass.

## 7. Recommendation for a future pass

- Re-attempt the hydraulics.py optimization with a smaller, isolated repro (a tiny synthetic network with a
  known cycle/SCC) to pin down exactly where the scatter-based rewrite diverges, before re-attempting on the
  full pilot.
- The `_substep` scratch-buffer-reuse idea in `surface.py` remains untried and is lower-risk (no change to
  reduction/aggregation semantics, just allocation reuse) — a reasonable next target.
- Any future attempt MUST use frame-by-frame (not just summary-metric) validation, per §4-5 above.
