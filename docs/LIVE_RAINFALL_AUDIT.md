# Live rainfall / nowcast data access audit (SIH26085)

**Date:** 2026-09-09. **Scope:** determine whether an official India Meteorological Department (IMD) source
can honestly replace `ExternalNowcastProvider`'s inert stub with real, live rainfall input for the Mumbai
Hindmata/Dadar pilot. Every claim below is either a direct quote/citation from an IMD-operated page, or an
empirical result of an actual HTTP request made from this machine (never both assumed) — sources and dates
are recorded so this can be re-verified independently.

## 1. Sources investigated

| # | Source | URL | What it is |
|---|---|---|---|
| 1 | IMD API Management Platform | `https://api.imd.gov.in/` | Official IMD "unified gateway" — the only genuinely *documented* IMD API surface found |
| 2 | IMD API reference | `https://api.imd.gov.in/public/api_reference.html` | Lists 28 documented endpoints (city forecast, current weather, district/station nowcast, AWS/ARG, rainfall, warnings, radar, cyclone, marine, sun/moon) |
| 3 | Current Weather API | `.../api/v1/current_wx` | Station-level current observation incl. "Last 24 hrs Rainfall" (mm) |
| 4 | District-wise Rainfall API | `.../api/v1/districtrainfall` | Daily/weekly/cumulative/monthly actual-vs-normal rainfall per district |
| 5 | AWS/ARG Data API | `.../api/v1/aws_data` | Automatic Weather Station obs — **no rainfall field documented** |
| 6 | District-wise Nowcast API | `.../api/v1/districtnowcast` | 0–3h categorical hazard warning (Cat1–Cat19 bands, colour-coded), **not quantitative mm** |
| 7 | Station-wise Nowcast API | `.../api/v1/stationnowcast` | Same categorical scheme, per station |
| 8 | Mumbai radar page | `https://mausam.imd.gov.in/responsive/radar.php?id=Mumbai` | Public webpage showing composite reflectivity **images**, no documented data API |
| 9 | IMD radar API (gated) | `.../api/v1/radar` (listed in ref. doc) | Documented response format is **"Image"**, not a gridded QPE product |
| 10 | IMD district nowcast GIS viz | `mausam.imd.gov.in/mumbaiums/district_nowcast_mumums.php`, `.../responsive/districtWiseNowcastGIS.php` | Public visualisation portal pages, no documented API |
| 11 | IITM Mumbai MESONET | `https://mumbairain.tropmet.res.in/` | IITM/MoES + MCGM + IMD dense rain-gauge network, **139 stations, 15-min updates** — the highest-resolution real Mumbai rainfall network found |
| 12 | Open Government Data Platform | `data.gov.in` rainfall catalogue | IMD-sourced datasets, generally daily/normal statistics, not real-time |
| 13 | IMD's own PDF on API access | `mausam.imd.gov.in/Forecast/marquee_data/API_doc.pdf` | States the actual registration process (see §3) |
| 14 | API Setu (govt. API directory) | `directory.apisetu.gov.in/api-collection/mausam` | Listing page found; no usable additional detail beyond what's above |

## 2. Empirical verification (not assumed)

Real, unauthenticated HTTP GETs were made from this machine on 2026-09-09 against the documented endpoints:

```
GET https://api.imd.gov.in/api/v1/districtrainfall?id=164   -> HTTP 401  {"error":"API key missing"}
GET https://api.imd.gov.in/api/v1/districtnowcast?id=1      -> HTTP 401  {"error":"API key missing"}
GET https://api.imd.gov.in/api/v1/cityforecast              -> HTTP 401  {"error":"API key missing"}
GET https://api.imd.gov.in/api/v1/current_wx?id=43003&apikey=<fake>  -> HTTP 401 Unauthorized (confirmed again
        through this project's own IMDObservationProvider code, not just curl — see §7)
```

**Every documented api.imd.gov.in endpoint requires a key. There is no anonymous/public tier.** This alone
rules out an "A" classification (directly usable now, no credentials) for anything on that platform.

## 3. What obtaining credentials actually requires

IMD's own PDF (`API_doc.pdf`) states verbatim: *"If any organization is interested to use these APIs
following IMD's terms and condition then they can contact to the Nodal officer Dr. Sankar Nath, Sc-E, IMD,
New Delhi (email: sankar.nath@imd.gov.in, mobile +91-9821832587)."* The portal itself (`api.imd.gov.in`)
additionally states **"IP Whitelisting required"** for access. There is no self-service signup, no published
approval SLA, and no published fee schedule. This is a manual, organisation-level, individually-negotiated
process — realistically not completable within a hackathon's timeframe, and incompatible by default with a
dev machine's dynamic IP (a static, pre-registered IP would be needed).

## 4. Classification

**A = usable now, no credentials. B = usable after registration/credentials. C = publicly visible but not a
reliable programmatic source. D = unavailable/unsuitable.**

| Source | Class | Why |
|---|---|---|
| api.imd.gov.in (all 28 documented endpoints) | **B** | Documented, structured, real API — but every endpoint requires a key (empirically confirmed), the key requires a manual nodal-officer approval process with no published SLA, and the portal states IP whitelisting is required |
| Mumbai radar imagery (`mausam.imd.gov.in/responsive/radar.php`) | **C** | Public webpage, images only, not a documented data API; the *gated* API's own radar endpoint is also documented as returning an **Image**, not gridded rainfall — genuine radar QPE integration is out of reach either way without image-processing work far beyond this audit's scope |
| District-wise/Station-wise Nowcast (`districtnowcast`/`stationnowcast`) | **B, but not usable as intended** | Real, documented, gated API — but the nowcast is **categorical** (colour/severity bands, e.g. "Cat12: Heavy rain: > 15 mm/hr"), never a quantitative mm/h value. Even with a key, this cannot honestly become a rainfall intensity time series without inventing precision IMD never published |
| AWS/ARG Data (`aws_data`) | **D** for rainfall purposes | Documented fields are temperature/humidity/wind/pressure — **no precipitation field at all** |
| IITM Mumbai MESONET (`mumbairain.tropmet.res.in`) | **C** | Real, dense (139 stations, 15-min), genuinely the best-resolution Mumbai rain network found — but no documented API; the page states data is available on request via email to the curator, not programmatically. Reverse-engineering its dashboard's network calls would be scraping an undocumented endpoint, which this audit was explicitly told not to do |
| data.gov.in rainfall catalogue | **C** | Real IMD-sourced datasets exist, but the ones found are daily/normal statistical products, not a real-time or sub-daily feed suitable for nowcasting |
| **No source in this audit reached class A.** | | |

## 5. Critical physics question: what does FloodNet's engine actually require?

`floodnet/simulation/engine.py::run_simulation()` consumes exactly one rainfall input type:
`contracts.RainfallScenario(t_s, intensity_mm_h)` — a **piecewise-constant intensity time series**, one
value per `config.RAIN_DT_S` = 300 s (5-min) step, covering the full `config.HORIZON_S` = 10 800 s (3 h)
window (37 points). It needs a **series**, not a scalar, and needs it at **5-minute** native resolution. The
engine itself was not touched by this work (nor does it need to be — this is exactly the contract every
other provider, including the synthetic scenarios, already satisfies).

None of the classified sources provide that directly:
- `current_wx`'s "Last 24 hrs Rainfall" is a **single cumulative total**, current as of the station's last
  report — not a series.
- `districtrainfall` is **daily** (plus weekly/cumulative/monthly) — also not a sub-hourly series.
- `districtnowcast`/`stationnowcast` are **categorical**, not numeric.
- `aws_data` has no rainfall field.

**Normalisation layer implemented** (`floodnet/rainfall/provider.py::IMDObservationProvider._normalize`):
the real observed 24h total is divided by 24 to get a mean mm/h rate, then **held constant** across every
5-min step of the 3h window — a persistence assumption, the simplest and most conservative real nowcasting
baseline (literally the skill floor real nowcast systems are benchmarked against), not a radar extrapolation
and not represented as one. Because a real observation is being reshaped by a stated assumption, the
resulting `RainfallScenario` is tagged `Tag.ESTIMATED` (not `Tag.REAL`) — the same "real input + a stated
derivation rule → ESTIMATED" pattern already used elsewhere in this codebase (e.g. Manning's n). The full
numeric derivation (raw 24h total, station, observation time, resulting mm/h) is written into the
provenance `note` field on every run — nothing about the transformation is hidden.

**This is the smallest technically honest combination available**, matching the task's own suggested
pattern: *IMD observation + FloodNet hydraulic forecast* — explicitly **not** *IMD observation + IMD
nowcast*, because no quantitative IMD nowcast product exists to add.

## 6. SIH requirement alignment

- **SR-01 (rainfall nowcast input):** partially strengthened. A real, live, quantitative IMD observation can
  now genuinely drive a run (when credentials are configured) — but it is an **observed-rainfall-driven
  persistence forecast**, not a Doppler-radar-derived nowcast. This is stated explicitly in the UI-facing
  provenance, not implied otherwise.
- **SR-02 (0–3h horizon):** satisfied structurally — the engine still produces the full 3h forecast from
  whatever `RainfallScenario` it's given, live included. The *forcing* for that 3h window is a stated
  assumption (§5), not a genuine 3h nowcast product, because IMD does not publish one via this API.
- No other rainfall-related SR is affected.

## 7. What was actually built

`floodnet/rainfall/provider.py` gains **one** new class, `IMDObservationProvider` (plus a `ProviderUnavailable`
exception) — not a second "IMDNowcastProvider", because there is no genuine quantitative nowcast product to
wrap (§4); building one would mean inventing a mapping from categorical warning bands to fabricated mm/h
values, which this project's rules forbid.

- Reads `IMD_API_KEY` / `IMD_STATION_ID` from the environment (`.env`, git-ignored; see `.env.example`),
  loaded by a ~15-line dependency-free loader in `floodnet/config.py` (no new package — `httpx`, used for
  the actual request, was already a dependency, used the same way as the existing OSM/Overpass fetcher).
- `IMD_STATION_ID` defaults to `43003` (Mumbai-Santacruz), verified via IMD's own `city.imd.gov.in` linking
  convention (`city.imd.gov.in/citywx/...?id=43003` is IMD's own URL for "Mumbai-Santacruz").
- Not configured → `ProviderUnavailable` (not a fabricated value); `/api/simulate` with `scenario_id="live"`
  then returns **HTTP 503** with a clear message, never a silent fallback to scenario/replay data while
  still labelled live (empirically verified — see §8).
- Configured and the call fails (network error, unexpected schema, missing field) → same `ProviderUnavailable`
  outcome, same 503 — confirmed for real by actually calling the real IMD endpoint with an invalid key from
  this project's own code (§8), not just by curl.
- Configured and the call succeeds → real observation parsed using IMD's own documented field names,
  persistence-normalised (§5), tagged ESTIMATED, cached in-process for `CACHE_TTL_S=600s` (10 min) per
  IMD's own portal guidance — *"use client-side caching to optimise performance during peak weather
  events"* — so a demo repeatedly requesting "live" doesn't hammer the API.
- **One genuinely unverified detail, stated plainly rather than guessed silently as fact:** IMD's materials
  confirm a key is *required* but never document *how* it's transmitted (header vs query param). The
  implementation sends it three ways at once (`Authorization: Bearer`, a configurable custom header default
  `X-API-Key`, and an `apikey` query parameter) so whichever convention IMD actually uses is covered; this
  is the one thing to confirm against IMD's real onboarding documentation once a key is issued.

**`scenario_id="live"` wired into the existing `/api/simulate` contract** (no new endpoint): `floodnet/api/state.py`
special-cases it to bypass the deterministic `lru_cache` used for the static scenarios (a live run must
reflect *current* conditions, not be frozen forever at whatever it returned once) and instead relies on
`IMDObservationProvider`'s own short-TTL cache. `GET /api/status`'s `rainfall_providers` list now includes a
`live` entry with `available`/`reason`, computed without making a network call (so status polling stays
cheap) — `ProvenancePanel` in the existing React frontend already renders whatever this list contains
generically, so it will show the live entry's state automatically.

**Deliberately not done this pass, per the explicit "do not redesign the frontend" instruction:** the
`ScenarioPanel` scenario dropdown is populated from `GET /api/scenarios`, which only lists the pilot's
*static* scenarios (moderate/heavy/cloudburst/july2005) — "live" is not a static pilot scenario, so it does
not appear there. Selecting and running "live" therefore currently requires calling `POST /api/simulate
{"scenario_id":"live",...}` directly (curl/Postman/the API docs at `/docs`), not via the dashboard's
dropdown. Adding a "Live" option to that dropdown is a small, well-defined follow-up (the backend contract
is already correct and tested for it) intentionally left out of this pass's scope.

## 8. Verification performed

- **Unit tests, mocked** (`backend/tests/test_rainfall_provider.py`): `IMDObservationProvider` parsing,
  persistence-normalisation arithmetic, ESTIMATED tagging, correct 503-worthy failure on missing key /
  HTTP error / missing field, TTL caching and `clear_cache()`, key transmitted correctly (all three
  mechanisms). Response fixtures use IMD's own documented field names verbatim (`"Last 24 hrs Rainfall"`
  etc.), not invented ones.
- **API integration tests, mocked** (`backend/tests/test_api_contracts.py`): `POST /api/simulate
  {"scenario_id":"live"}` without a key → real HTTP 503 with `IMD_API_KEY` named in the message, no
  traceback; with a mocked successful provider → a full, real engine run on the real pilot (mass balance
  closes to <0.1%, 37 real frames, provenance tag ESTIMATED) proving FloodNet genuinely consumes live input
  end to end; `GET /api/status` correctly reports `live: {available: false, reason: "...IMD_API_KEY..."}`.
- **Real, unmocked verification against the actual IMD server** (this session, no key available): calling
  `IMDObservationProvider(api_key="demo-unregistered-key-not-real").get()` — this project's own code, not
  curl — produced a genuine `HTTP 401 Unauthorized` from `api.imd.gov.in` and correctly raised
  `ProviderUnavailable`, proving the request construction (URL, params, headers) actually reaches IMD's real
  server and the failure path is handled correctly, not merely assumed to work.
- **Opt-in live smoke test** (`backend/tests/test_imd_live_smoke.py`, `pytest.mark.live`, skipped unless
  `IMD_API_KEY` is set): **not executed against a real key in this session** — no credentials were available
  (see §3) — stated here plainly rather than faked. It will run automatically once real credentials are
  configured (`.env` or environment) and asserts a physically-plausible 24h total (0–500 mm) plus a full
  real FloodNet run.
- Full backend suite: **101 passed, 2 skipped** (the two opt-in live tests) — up from 90 passed before this
  pass; zero regressions.

## 9. Remaining limitations (stated, not hidden)

- No IMD source reached class A; live rainfall requires configuring a real, individually-approved API key
  this project does not have.
- Even with a key, the input is a **persistence forecast from a real observed 24h total**, not a genuine
  radar/NWP nowcast — IMD does not publish a quantitative nowcast product via this API. The UI/provenance
  must keep saying exactly this if a key is ever configured.
- The exact API-key transmission mechanism is unverified against real onboarding docs (§7).
- `current_wx`'s single station (Mumbai-Santacruz, ~10 km from the Hindmata/Dadar pilot, the same caveat
  already recorded for the July 2005 replay in `docs/DECISIONS.md`) is applied uniformly over the pilot grid
  — no spatial variation, same simplification already accepted for every other scenario in this project.

## 10. Configuration quick reference

| Variable | Required | Default | Where |
|---|---|---|---|
| `IMD_API_KEY` | Yes, to enable LIVE at all | unset (LIVE disabled, honestly, not faked) | `.env` at repo root (git-ignored) or a real environment variable |
| `IMD_STATION_ID` | No | `43003` (Mumbai-Santacruz) | same |
| `IMD_API_KEY_HEADER` | No | `X-API-Key` | same — only matters if IMD's real header-name convention turns out to differ (§7) |

Copy `.env.example` to `.env` and fill in `IMD_API_KEY` once a real key is obtained (see §3 for how — it is
not self-service). **No real credential is committed anywhere in this repository**; `.env` is listed in
`.gitignore`. No frontend or other backend code needs to change when a key is added — see §11.

### How to configure IMD live observations (operator steps)

1. **Obtain the credential.** Not self-service — per §3, contact IMD's nodal officer for `api.imd.gov.in`
   (Dr. Sankar Nath, `sankar.nath@imd.gov.in`) and complete IMD's own registration/terms-of-use process.
   This project has not obtained one; no URL, contact, or process beyond what §3 already cites from IMD's
   own materials is asserted here.
2. **Place it.** At the repo root: `cp .env.example .env`, then set `IMD_API_KEY=<the real key>` in `.env`.
   Never place it in any tracked file, command-line argument, or commit message.
3. **Environment variable name:** `IMD_API_KEY` (optionally `IMD_STATION_ID`, `IMD_API_KEY_HEADER` — see the
   table above). Loaded automatically at backend startup by `floodnet/config.py`'s `.env` reader; no other
   setup needed. Restart the backend process after changing `.env` (it's read once at import time).
4. **Verify configuration** (no live network call, so this is always safe/cheap to check):
   `curl http://localhost:8000/api/status` → look for
   `{"id":"live", "available": true, ...}` in `rainfall_providers` (it reads `{"available": false, "reason":
   "IMD_API_KEY not configured"}` until a key is set).
5. **Run the opt-in live smoke test** once configured:
   `cd backend && .venv/Scripts/python.exe -m pytest tests/test_imd_live_smoke.py -v -m live`
   (it is skipped automatically, with an explanatory reason, whenever `IMD_API_KEY` is not set — normal
   `pytest tests` never requires or attempts to reach a real IMD credential).

## 11. Dashboard integration (added after this audit — "LIVE OBSERVATION" UI)

"Live Observation" is now a selectable entry in the existing scenario dropdown (synthesised client-side from
`GET /api/status`'s `rainfall_providers` list, which already reported a `live` entry from the first pass of
this work) — no second data path, no bypass of `IMDObservationProvider`. Running it calls the same
`POST /api/simulate` used by every other scenario.

**Three distinct rainfall concepts are now labelled consistently everywhere** (header, scenario panel,
provenance): `SYNTHETIC SCENARIO`, `HISTORICAL REPLAY`, `LIVE OBSERVATION`. The persistence-derived 3h
continuation is always labelled **"3-HOUR PERSISTENCE ESTIMATE"**, never "IMD nowcast", "radar nowcast",
"official forecast" or "live forecast" — this exact string is emitted by the backend
(`RainfallSourceMeta.detail.forecast_extension_label`) and rendered verbatim by the frontend, not composed
from scratch in JS, so wording can't drift between the two layers.

**No-credentials behaviour (verified live against the real, unmodified running server, not just tests):** a
`POST /api/simulate {"scenario_id":"live"}` against this backend with no `IMD_API_KEY` configured returns a
real `HTTP 503` with detail `"live rainfall unavailable: IMD_API_KEY is not configured -- live IMD data is
disabled, not faked. ..."`, and `GET /api/status` reports `{"id":"live", "available": false, "reason":
"IMD_API_KEY not configured"}`. The dashboard shows "LIVE UNAVAILABLE / IMD API credentials are not
configured." and leaves whatever scenario/replay run was already on screen untouched -- it does not clear
the map, switch scenarios, or otherwise silently substitute another data source while still labelled live.

**Security fix made during this pass:** the original `IMDObservationProvider` sent the API key as a query
parameter (necessary, since IMD's docs never specified the transmission mechanism -- see §7) but on a failed
request, httpx's own exception text embeds the *full request URL, including the key*. That raw exception
text was originally being included in the message raised (and therefore in the HTTP 503 body). Fixed:
failure messages are now built from known-safe components only (station id, HTTP status code / exception
class name); the full original exception is still logged server-side (operator-only) for debugging.
Verified with a real (invalid-key) request against the actual `api.imd.gov.in` server that the key no longer
appears in the raised/returned message, plus a regression test
(`test_imd_provider_never_leaks_the_api_key_in_a_failure_message`).

**Structured provenance (Task 4):** a live run's `SimulationResult.provenance` gained one additive key,
`rainfall_source` (the existing `provenance.rainfall` key, and every other scenario's provenance shape, is
untouched) — `RainfallSourceMeta.detail` carries `source`, `station`, `station_id`, `retrieved_at`,
`observed_at`, `observed_rainfall_mm`, `persistence_intensity_mm_h`, `forecast_extension_label`, and
`forecast_extension_note` as plain fields, so the UI renders SOURCE/MODE/STATION/RETRIEVED/RAINFALL/FORECAST
EXTENSION directly rather than parsing them out of the prose provenance note.

**Not done, still correctly out of scope:** SR-02 is not claimed as newly/fully satisfied by the persistence
estimate (§6 stands unchanged) — the dashboard's own copy says "3-hour persistence estimate", never
"forecast" or "nowcast", exactly to avoid that overclaim.
