# STATUS — handoff for the next session (written 2026-09-08 ~19:30 IST, commit `01fb21f`)

## Runnable now
```powershell
cd backend
.venv\Scripts\python.exe -m uvicorn floodnet.api.main:app --port 8000     # data/processed/pilot already built -> data_mode REAL
```
Open http://localhost:8000 → pick scenario → Run / Compare → scrub 0–180 min → click twice → flood-safe route.
Tests: `.venv\Scripts\python.exe -m pytest tests -q` → 51 passed (≈20–85 s). Rebuild data: `python -m floodnet.data.build_pilot` (needs internet).

## Verified numbers (real pilot, heavy storm 50 mm/h × 2 h, 3 h horizon, 10 m grid, ~45 s per run)
| | NORMAL | BLOCKED 70 % |
|---|---|---|
| peak surcharging nodes | 190 | 430 |
| flooded segments (≥15 cm) at peak | 1,163 | 1,257 |
| total surcharge to street (m³) | 47,498 | 128,266 |
| outfall discharge (m³) | 168,424 | 135,867 |
| mass-balance error | ~1e-12 | ~1e-12 |

## Highest-priority next tasks (in order)
1. **Calibration sanity on the real pilot.** Max cell depth reaches ~2.8 m under a 100 mm storm — almost certainly a DTM pit (contour interpolation near rail cuttings / closed grid boundary). Inspect the argmax cell, add a conservative pit-fill or an open boundary at the grid edge, and re-check flooded-segment counts against the 5 active MCGM Flooding Spots + Chitale named roads (`FLOOD_GROUND_TRUTH.md`).
2. **Validation report** (`docs/VALIDATION.md`): Flooding-Spots overlap %, behavioural checks, sensitivity to n / inlet capacity / impervious, runtime table. Then pyswmm cross-check on the pilot subnetwork (D-07 hybrid; `swmm_api` authoring must be fixed — `Infiltration.InfiltrationHorton` does not exist in 0.4.74).
3. **Explainability panel** (P1): per-street cause chain from `node_cause` + upstream rainfall.
4. **Time-aware routing** (use the frame at estimated arrival), ambulance vs car demo.
5. Stretch: IMD radar GIF + pysteps extrapolation nowcast (P2); scale-up to box E (6,012 nodes).

## Known limitations to state on stage
Storage-cell diffusive surface scheme (not Saint-Venant); no reverse pipe flow (backflow = blocked downstream + upstream surcharge); closed grid boundary; no tide at outfalls; Manning n / inlet 0.05 m³/s / storage 1.5 m² / impervious fractions ESTIMATED; rainfall uniform over the pilot; Santacruz gauge ~10 km away; DTM from 20 cm contours (SD 0.28 m vs manholes); MCGM data vintage unknown, mTHD datum (consistent within pilot, offset to MSL unverified); severity bands are working thresholds, not cited guidance.
