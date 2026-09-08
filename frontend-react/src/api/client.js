// FloodNet API client -- the ONLY place fetch() is called from. Every backend contract used by the UI is
// listed here so a schema change only needs updating in one place. Endpoints and response shapes were read
// directly from backend/floodnet/api/main.py and schemas.py before writing this file (SIH26085 rule: don't
// guess response schemas).
//
// Units returned by the backend: rainfall mm/h, depth cm (already converted from internal metres at the API
// boundary), volumes m3, time minutes (t_min), coordinates [lon, lat].

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
    res = await fetch(path, {
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

// ---------------------------------------------------------------- simulation
export const simulate = ({ scenarioId, blockage, horizonMin = 180 }) =>
  request('/api/simulate', {
    method: 'POST',
    body: { scenario_id: scenarioId, blockage: blockage ?? { mode: 'none' }, horizon_min: horizonMin },
  })

export const getRun = (runId) => request(`/api/simulate/${encodeURIComponent(runId)}`)

export const getFrame = (runId, tMin) =>
  request(`/api/simulation/${encodeURIComponent(runId)}/frame/${tMin}`)

export const getSeries = (runId) =>
  request(`/api/simulation/${encodeURIComponent(runId)}/series`)

export const explainSegment = (runId, segId, tMin) =>
  request(
    `/api/simulation/${encodeURIComponent(runId)}/explain/${encodeURIComponent(segId)}` +
      (tMin != null ? `?t_min=${tMin}` : ''),
  )

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
export const findRoute = ({ origin, dest, tMin = 0, vehicle = 'car', runId = null }) =>
  request('/api/route', {
    method: 'POST',
    body: { origin, dest, t_min: tMin, vehicle, run_id: runId },
  })
