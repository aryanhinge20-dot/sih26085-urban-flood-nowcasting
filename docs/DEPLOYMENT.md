# Deployment (2026-09-21)

```
Browser ──► Vercel — React/Vite static frontend (SPA fallback; VITE_API_BASE_URL → backend)
   └──────► AWS Lightsail / EC2 — STATIC public IPv4 → reverse proxy (HTTPS) → Docker → FastAPI
                                   simulation engine · IMD · radar image · ECMWF · routing · TTS proxy
```
One FastAPI app (`floodnet.api.main:app`), one container, one instance.

**Why the backend is not a Vercel function:** runs live in process memory (`api/state.py`), so serverless
invocations would 404 each other's `run_id`; IMD keys are bound to ONE public IP (verified: `403 IP address … not
authorized`) and functions have no fixed egress IP; a cold 180-min run measured 115 s; Python deps are ~315 MB.

## 1. Backend — AWS Lightsail or EC2
1. Instance: Ubuntu LTS, ≥ 2 vCPU / 4 GB. **Attach a static IP** (Lightsail static IP / EC2 Elastic IP) *before*
   generating the IMD key. Open 80/443 only; keep 8000 closed to the internet.
2. Install Docker. Copy the repo (or the built image). Create `/opt/floodnet/.env` from `.env.example`
   (`chmod 600`); it is never baked into the image (`.dockerignore`) and never committed (`.gitignore`).
3. Build and run:
   ```
   docker build -t floodnet-api .
   docker run -d --name floodnet --restart unless-stopped -p 127.0.0.1:8000:8000 \
     --env-file /opt/floodnet/.env \
     -e IMD_API_TOKEN_FILE=/run/floodnet/imd_token -v /opt/floodnet/secrets:/run/floodnet \
     -v floodnet-cache:/app/data/interim floodnet-api
   ```
   The container runs as an unprivileged user, honours `$PORT`, and has a `HEALTHCHECK` on `/health`.
4. Reverse proxy + TLS (expected, not bundled): Caddy or nginx + certbot on the host, terminating HTTPS for
   `api.<your-domain>` and proxying to `127.0.0.1:8000`. Set proxy read timeout ≥ 300 s (a forecast is one long
   request). Browsers block an `https://` Vercel page from calling an `http://` API, so HTTPS is required.
5. CORS: `FLOODNET_CORS_ORIGINS=https://<your-app>.vercel.app` (comma-separated for more). Unset = `*`.

## 2. Frontend — Vercel
`vercel.json` (repo root) builds `frontend-react/` with `VITE_BASE=/` and rewrites everything except `/assets/*` and
`/api/*` to `/index.html`; `.vercelignore` keeps `.env`, `backend/`, `data/`, `docs/` out of the upload.
Project → Environment Variables: **`VITE_API_BASE_URL=https://api.<your-domain>`** (no trailing slash; public, not a
secret). Without it the site calls `/api/*` on Vercel and gets the SPA page back. 3D terrain needs nothing extra.
No `VITE_*` variable may ever hold a credential.

## 3. Server environment variables (names only — see `.env.example`)
| Variable | Purpose |
|---|---|
| `IMD_API_KEY` | IMD subscription key, bound to the server's static IP |
| `IMD_API_TOKEN` / `IMD_API_TOKEN_FILE` | IMD bearer token (expires ~hourly) — value, or a file holding it |
| `IMD_TOKEN_TTL_MIN` | assumed token lifetime for the "expiring soon" estimate (default 60) |
| `IMD_STATION_ID` | default 43003 (Mumbai-Santacruz) |
| `FLOODNET_ADMIN_TOKEN` | enables the protected token-rotation endpoint; unset = endpoint does not exist |
| `FLOODNET_CORS_ORIGINS` | allowed frontend origins |
| `GOOGLE_TTS_API_KEY`, `FLOODNET_TTS_RATE`, `FLOODNET_TTS_VOICE_*` | optional neural voice |
| `FLOODNET_RADAR_NOWCAST` | `1` enables the experimental advection nowcast (default off) |

All optional: a missing credential disables only its own source, and the UI says so.

## 4. IMD token rotation — no restart, no frontend rebuild
IMD issues the bearer token only after a password + CAPTCHA login; **there is no documented refresh endpoint and
FloodNet does not automate the login.** The token lasts roughly an hour. When it lapses, FloodNet does not stop:
`auto` runs fall over to radar-derived → ECMWF → cached → demo, labelled as such, and `GET /api/data-status` shows
`imd_auth.state = expired`.

To rotate: log in at https://api.imd.gov.in/public/login.php, copy the token, then **either**
- overwrite the token file (picked up on the next request):
  `printf '%s' '<token>' | sudo tee /opt/floodnet/secrets/imd_token >/dev/null` — or
- call the protected endpoint (exists only when `FLOODNET_ADMIN_TOKEN` is set; use HTTPS only):
  `curl -X POST https://api.<domain>/api/admin/imd-token -H "X-Admin-Token: $FLOODNET_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"token":"<token>"}'`
- local development: edit `IMD_API_TOKEN` in the root `.env`; it is re-read on the next request.

The token is never echoed, logged or returned; the response and `/api/data-status` report only the state.
Before a demo: rotate the token a few minutes ahead and check `imd_auth.state = valid`.

## 5. Health
`GET /health` (liveness, no dependencies) · `GET /api/health` · `GET /api/data-status` (backend, engine, IMD token
state, last IMD / radar / ECMWF attempt, cache age, source used by the last `auto` run; makes no upstream call).

## 6. Deployment checklist
| # | Item | How to check |
|---|---|---|
| 1 | Frontend deployed | Vercel build green; `/` and `/dashboard` load and survive refresh |
| 2 | Backend deployed | `docker ps` healthy; `curl https://api.<domain>/health` → `{"ok":true}` |
| 3 | Static IP | Elastic/static IP attached; `curl ifconfig.me` on the host matches it |
| 4 | Domain | `api.<domain>` A-record → the static IP |
| 5 | TLS | valid certificate; HTTP redirects to HTTPS; proxy timeout ≥ 300 s |
| 6 | CORS | `FLOODNET_CORS_ORIGINS` = the Vercel URL; browser console shows no CORS error |
| 7 | Env vars | server `.env` complete (`chmod 600`); Vercel has only `VITE_API_BASE_URL` |
| 8 | IMD whitelist | IMD key generated for the static IP; `/api/data-status` → `imd_live.ok = true` after an `auto` run |
| 9 | IMD token | rotation path tested once (§4); `imd_auth.state = valid` |
| 10 | Radar | run "IMD Mumbai-Veravali DWR": either a run, or the honest stale-frame message |
| 11 | Fallback | let the token lapse → an `auto` run still completes, labelled FORECAST / CACHED / DEMO |
| 12 | Health checks | `/health`, `/api/data-status`; Docker `HEALTHCHECK` = healthy |
| 13 | Smoke test | landing → control centre → Demo scenario → timeline → Alerts / Why / Route / Sources → 3D → briefing |

## 7. Verified vs not
| Check | Result |
|---|---|
| Vercel-style build (`VITE_BASE=/`, API origin set); no secrets / localhost in the bundle | PASS |
| `.env` excluded from git, Vercel upload and Docker context; required pilot data tracked | PASS |
| `docker build`, container start, `/health`, `/api/data-status`, a demo run inside the container | see `FINAL_STATUS.md` |
| `vercel build`, AWS instance, domain, TLS, IMD key for the production IP, deployed smoke test | **NOT DONE** — needs your accounts |
