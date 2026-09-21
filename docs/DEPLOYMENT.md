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

### 4a. Token source abstraction (`floodnet/rainfall/imd_token_sources.py`)
The core never knows where the token lives; it asks one `TokenSource` on every IMD request. Choose it with
`IMD_TOKEN_PROVIDER`:

| Provider | Use | Settings |
|---|---|---|
| `env` (default) | local development | `IMD_API_TOKEN` (editing the root `.env` is picked up live); `IMD_API_TOKEN_FILE` wins when set |
| `file` | Docker / Kubernetes secret mount | `IMD_API_TOKEN_FILE` |
| `aws-secretsmanager` | AWS production | `IMD_TOKEN_SECRET_ID` (+ `IMD_TOKEN_SECRET_KEY` if the secret is JSON), `IMD_TOKEN_CACHE_S` |
| `aws-ssm` | AWS production | `IMD_TOKEN_SSM_PARAMETER` (SecureString), `IMD_TOKEN_CACHE_S` |

A token set through `POST /api/admin/imd-token` always takes precedence until the process restarts.

**AWS Secrets Manager / SSM (optional; not needed to run FloodNet):**
1. `pip install -e "./backend[radar,aws]"` in the image (adds boto3).
2. Store the token:
   `aws ssm put-parameter --name /floodnet/imd_token --type SecureString --value '<token>' --overwrite`
   or `aws secretsmanager put-secret-value --secret-id floodnet/imd --secret-string '<token>'`.
3. Give the instance role read access to just that one secret: `ssm:GetParameter` (plus `kms:Decrypt` for the key),
   or `secretsmanager:GetSecretValue`. Credentials come from the instance role, never from `.env`.
4. Run with `IMD_TOKEN_PROVIDER=aws-ssm IMD_TOKEN_SSM_PARAMETER=/floodnet/imd_token` (or the Secrets Manager pair).
5. To rotate, run the same `put-parameter` / `put-secret-value` command. FloodNet uses the new value within
   `IMD_TOKEN_CACHE_S` seconds (default 60). There is no restart, no image rebuild and no Vercel rebuild.

If AWS is unreachable, the source returns no token. The token state becomes `UNAVAILABLE` and `auto` falls back
(§4b). Nothing crashes.

### 4b. What happens when the token expires
| Situation | IMD token state | What IMD live does | What an `auto` run does |
|---|---|---|---|
| valid | `VALID` | answers | uses IMD LIVE |
| token `exp` within 10 min | `EXPIRING_SOON` | renews first if the secret source holds a newer token, else keeps using the current one | uses IMD LIVE |
| IMD says 401 (expired / invalid token) | `EXPIRED`; `imd_refresh_status` refreshing → renewed / failed | renews (re-reads the secret source, single-flight), retries the request **once** | IMD LIVE if renewal worked; falls back only if it failed |
| IMD says 403 (key / IP not authorised) | `UNAVAILABLE` until the key changes | stops sending requests | falls back; a new token will not fix a 403 |
| no token, or a malformed one | `UNAVAILABLE` | nothing is sent | falls back |
| token whose own `exp` has passed | `EXPIRED` | renewal first; nothing is sent unless a newer token was found | falls back if none |
| opaque token older than `IMD_TOKEN_TTL_MIN` | `EXPIRED` (estimate) | still tried; IMD's reply decides | normal |
| timeout / 5xx / bad payload | unchanged | that request fails | falls back for that run |

Fallback order: **IMD LIVE → IMD DWR RADAR-DERIVED → ECMWF NWP → CACHED** (the last good field, at most 6 h old,
shown with its age and original source) **→ DEMO** (the deterministic cloudburst scenario). The badge, the Sources
tab and `/api/data-status` (`imd_auth_status`, `imd_refresh_status`, `imd_token_expires_at`, `active_rainfall_source`,
`active_source_timestamp`, `fallback_active`) all show the source actually in use. A fallback is never labelled
IMD LIVE. Choosing "IMD live observation" explicitly still fails with a clear message rather than substituting another
source. Only "Best available source" falls back.

Renewal never logs in to IMD: the portal issues tokens only after a password + CAPTCHA login and documents no
refresh endpoint. Someone still has to put a new token into the secret source. Evidence, and what to ask IMD for:
`docs/IMD_TOKEN_RENEWAL.md`.

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
