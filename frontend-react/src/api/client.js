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

// ---------------------------------------------------------------- run recovery (serverless hosting)
// A run lives in the memory of the backend instance that computed it. On Vercel a follow-up request can reach a
// different or freshly started instance, which answers 404 {code: "run_not_found"}. The client then re-runs the
// SAME request once (one re-run shared by all callers), maps the old run_id to the new one, and retries. The UI
// keeps its original run_id. Scenario runs come back identical; a live/forecast run is recomputed from the
// rainfall available at that moment.
const regenerators = new Map()   // run_id -> () => Promise<new run_id>
const aliases = new Map()        // original run_id -> replacement run_id
const inFlight = new Map()       // original run_id -> Promise<new run_id>

const isRunNotFound = (e) => e instanceof ApiError && e.status === 404 && e.detail?.detail?.code === 'run_not_found'

function remember(runId, regenerate) {
  if (runId) regenerators.set(runId, regenerate)
}

function regenerate(runId) {
  if (!inFlight.has(runId)) {
    const p = regenerators.get(runId)()
      .then((fresh) => { aliases.set(runId, fresh); return fresh })
      .finally(() => inFlight.delete(runId))
    inFlight.set(runId, p)
  }
  return inFlight.get(runId)
}

async function withRun(runId, call) {
  if (runId == null) return call(runId)
  try {
    return await call(aliases.get(runId) ?? runId)
  } catch (e) {
    if (!isRunNotFound(e) || !regenerators.has(runId)) throw e
    return call(await regenerate(runId))
  }
}

// (getHotspots above = MCGM's known flood spots; this is the run-derived hotspot summary)
export const getFloodIntelligence = (runId) =>
  withRun(runId, (id) => request(`/api/simulation/${encodeURIComponent(id)}/hotspots`))

export const getAlert = (runId) =>
  withRun(runId, (id) => request(`/api/simulation/${encodeURIComponent(id)}/alert`))

// ---------------------------------------------------------------- simulation
const postSimulate = ({ scenarioId, blockage, horizonMin = 180 }) =>
  request('/api/simulate', {
    method: 'POST',
    body: { scenario_id: scenarioId, blockage: blockage ?? { mode: 'none' }, horizon_min: horizonMin },
  })

export const simulate = async (args) => {
  const res = await postSimulate(args)
  remember(res?.run_id, async () => (await postSimulate(args)).run_id)
  return res
}

export const getRun = (runId) => withRun(runId, (id) => request(`/api/simulate/${encodeURIComponent(id)}`))

export const getFrame = (runId, tMin) =>
  withRun(runId, (id) => request(`/api/simulation/${encodeURIComponent(id)}/frame/${tMin}`))

export const getSeries = (runId) =>
  withRun(runId, (id) => request(`/api/simulation/${encodeURIComponent(id)}/series`))

export const explainSegment = (runId, segId, tMin) =>
  withRun(runId, (id) => request(
    `/api/simulation/${encodeURIComponent(id)}/explain/${encodeURIComponent(segId)}` +
      (tMin != null ? `?t_min=${tMin}` : ''),
  ))

const postCompare = ({ scenarioId, blockage, horizonMin = 180 }) =>
  request('/api/compare', {
    method: 'POST',
    body: { scenario_id: scenarioId, blockage, horizon_min: horizonMin },
  })

export const compare = async (args) => {
  const res = await postCompare(args)
  remember(res?.blocked?.run_id, async () => (await postCompare(args)).blocked.run_id)
  remember(res?.normal?.run_id, async () => (await postCompare(args)).normal.run_id)
  return res
}

const postReplay = ({ blockage, horizonMin = 180 } = {}) =>
  request('/api/storm/replay', {
    method: 'POST',
    body: { blockage: blockage ?? { mode: 'none' }, horizon_min: horizonMin },
  })

export const stormReplay = async (args = {}) => {
  const res = await postReplay(args)
  remember(res?.run_id, async () => (await postReplay(args)).run_id)
  return res
}

// ---------------------------------------------------------------- routing
export const findRoute = ({ origin, dest, tMin = 0, vehicle = 'car', runId = null }) =>
  withRun(runId, (id) => request('/api/route', {
    method: 'POST',
    body: { origin, dest, t_min: tMin, vehicle, run_id: id },
  }))

// Multiple candidate routes scored under three objectives (see backend/floodnet/routing/router.py
// safe_routes_multi's docstring): "safest" (flood-depth-penalised), "fastest" (DISTANCE only -- there is no
// travel-time/speed model anywhere in the graph, so this must stay labelled "by distance" wherever it is
// shown), and "balanced" (a blended objective between the two). Each candidate also carries `time_safety`
// (safe-through-T+X vs. unsafe-by-T+X) when a simulation run is active, computed from the same per-segment
// series GET /api/simulation/{run_id}/series already serves.
export const findRouteAlternatives = ({ origin, dest, tMin = 0, vehicle = 'car', runId = null, nCandidates = 3 }) =>
  withRun(runId, (id) => request('/api/route/alternatives', {
    method: 'POST',
    body: { origin, dest, t_min: tMin, vehicle, run_id: id, n_candidates: nCandidates },
  }))
