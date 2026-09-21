// FloodNet API client -- the ONLY place fetch() is called from. Every backend contract used by the UI is
// listed here so a schema change only needs updating in one place. Endpoints and response shapes were read
// directly from backend/floodnet/api/main.py and schemas.py before writing this file (SIH26085 rule: don't
// guess response schemas).
//
// Units returned by the backend: rainfall mm/h, depth cm (already converted from internal metres at the API
// boundary), volumes m3, time minutes (t_min), coordinates [lon, lat].

// Production API origin, e.g. https://floodnet-api.example.com (no trailing slash). Empty/unset means the API
// is served from the SAME origin as the page (local FastAPI at /static, or the Vite dev proxy). This is the
// only deployment setting the frontend has; it is a public URL, never a secret.
export const API_BASE_URL = String(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '')
export const apiUrl = (path) => `${API_BASE_URL}${path}`

export class ApiError extends Error {
  constructor(message, { status = null, detail = null, path = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.path = path
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(`Backend unreachable (${path})`, { path })
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    // non-JSON body (e.g. empty 204) -- leave data null
  }
  if (res.status === 504) {
    // the hosting platform stopped the request at its time limit (Vercel: FUNCTION_INVOCATION_TIMEOUT)
    throw new ApiError('The server did not finish within its time limit (300 s on the current hosting plan). '
      + 'Try a shorter forecast horizon.', { status: 504, detail: data, path })
  }
  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || res.statusText
    throw new ApiError(
      typeof detail === 'string' ? detail : JSON.stringify(detail),
      { status: res.status, detail: data, path },
    )
  }
  return data
}

// ---------------------------------------------------------------- pilot / meta
export const getMeta = () => request('/api/meta')
export const getStatus = () => request('/api/status')
export const getProvenance = () => request('/api/provenance')
export const getScenarios = () => request('/api/scenarios')
export const getRoads = () => request('/api/roads')
export const getTopology = () => request('/api/topology')
export const getHotspots = () => request('/api/hotspots')
export const getTerrain = () => request('/api/terrain')
// The simulator's own DEM, lossless (raw float32) -- the single source for the 3D terrain view.
export const getDem = () => request('/api/terrain/dem')
export const getDataStatus = () => request('/api/data-status')

// ---------------------------------------------------------------- simulation
// Each of these returns the COMPLETE run (backend/floodnet/api/bundle.py; decoded by lib/runBundle.js). There
// is deliberately no "fetch a run by id" call: on serverless hosting the next request may reach a different
// server instance, which does not hold the run.
export const simulate = ({ scenarioId, blockage, horizonMin = 180 }) =>
  request('/api/simulate', {
    method: 'POST',
    body: { scenario_id: scenarioId, blockage: blockage ?? { mode: 'none' }, horizon_min: horizonMin },
  })

export const compare = ({ scenarioId, blockage, horizonMin = 180 }) =>
  request('/api/compare', {
    method: 'POST',
    body: { scenario_id: scenarioId, blockage, horizon_min: horizonMin },
  })

export const stormReplay = ({ blockage, horizonMin = 180 } = {}) =>
  request('/api/storm/replay', {
    method: 'POST',
    body: { blockage: blockage ?? { mode: 'none' }, horizon_min: horizonMin },
  })

// ---------------------------------------------------------------- routing
// The route is computed on the depths of the frame on screen, sent WITH the request (only wet segments; a missing
// segment is dry), so routing never depends on the server holding the run.
const routeBody = ({ origin, dest, tMin, vehicle, runId, streetDepthM, seriesTMin, streetsCm, dataMode }) => ({
  origin, dest, t_min: tMin, vehicle, run_id: runId,
  street_depth_m: streetDepthM ?? null, series_t_min: seriesTMin ?? null, streets_cm: streetsCm ?? null, data_mode: dataMode ?? null,
})

export const findRoute = ({ origin, dest, tMin = 0, vehicle = 'car', runId = null, streetDepthM = null, dataMode = null }) =>
  request('/api/route', { method: 'POST', body: routeBody({ origin, dest, tMin, vehicle, runId, streetDepthM, dataMode }) })

// Multiple candidate routes scored under three objectives (see backend/floodnet/routing/router.py
// safe_routes_multi's docstring): "safest" (flood-depth-penalised), "fastest" (DISTANCE only -- there is no
// travel-time/speed model anywhere in the graph, so this must stay labelled "by distance" wherever it is
// shown), and "balanced" (a blended objective between the two). Each candidate also carries `time_safety`
// (safe-through-T+X vs. unsafe-by-T+X) when the run's per-segment series is sent with the request.
export const findRouteAlternatives = ({
  origin, dest, tMin = 0, vehicle = 'car', runId = null, nCandidates = 3, streetDepthM = null, seriesTMin = null,
  streetsCm = null, dataMode = null,
}) =>
  request('/api/route/alternatives', {
    method: 'POST',
    body: { ...routeBody({ origin, dest, tMin, vehicle, runId, streetDepthM, seriesTMin, streetsCm, dataMode }), n_candidates: nCandidates },
  })
