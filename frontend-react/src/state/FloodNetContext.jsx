import { refreshDataStatus } from '../lib/useDataStatus.js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api/client.js'
import { decodeRun, buildFrame, buildSeries, explainSegment as explainFromRun, frameIndex, frameDepths, wetSeries } from '../lib/runBundle.js'

const FloodNetContext = createContext(null)

// The engine's real coupling loop (backend/floodnet/simulation/engine.py) executes these stages, in this
// order, once per sub-step, for the whole run before /api/simulate returns anything. There is no
// incremental-progress signal from the backend (a single synchronous POST), so we cannot show a real
// percentage -- per the product spec we show WHICH real stage is running, cycling through them on a timer,
// never a fabricated completion percentage.
export const SIMULATE_STAGES = [
  'Loading rainfall input',
  'Routing surface runoff',
  'Solving drainage network',
  'Calculating surcharge',
  'Mapping street risk',
]

// Reserved scenario id for a LIVE OBSERVATION run (floodnet/rainfall/provider.py::LIVE_ID) -- routed through
// the exact same POST /api/simulate contract as every other scenario, never a second data path.
export const LIVE_ID = 'live'

// Reserved scenario id for an ECMWF NWP forecast run (floodnet/rainfall/provider.py::ECMWF_ID) -- a
// rainfall FORECAST source (Open-Meteo, ECMWF IFS model); introduced while IMD API access was pending.
// Routed through the exact same POST /api/simulate contract as every other scenario. Must never be
// conflated with LIVE_ID in the UI: this is an NWP FORECAST, not an IMD observation, not a radar nowcast.
export const ECMWF_ID = 'ecmwf'

// Reserved scenario id for the EXPERIMENTAL field decoded from IMD's public Mumbai-Veravali DWR SRI image
// (floodnet/rainfall/provider.py::IMD_SRI_ID). A radar-DERIVED ESTIMATE, never official IMD QPE or a nowcast.
export const RADAR_SRI_ID = 'imd_sri'

// A failed live attempt is either "not configured" (no IMD API key on the server) or "configured but the
// request itself failed" (network/parse error). For the former the 503 detail always contains the phrase
// "live IMD data is disabled" (floodnet/rainfall/provider.py), the one signal the frontend needs. Credential
// variable names are deliberately never written into the browser bundle. Never leaks
// anything from `e.message` beyond this classification -- the backend already sanitises it (no key/secrets
// ever reach this string; see floodnet/rainfall/provider.py's key-leak fix).
function classifyLiveFailure(e) {
  if (e?.status === 503 && /live IMD data is disabled/.test(e.message || '')) {
    return { status: 'unavailable', message: 'IMD API credentials are not configured.' }
  }
  return { status: 'error', message: 'IMD request failed.' }
}

// ECMWF needs no credentials, so a failure is always "the request/parse itself failed" (Open-Meteo
// unreachable, timed out, or returned an insufficient/malformed forecast) -- api/main.py's 503 detail always
// names "Open-Meteo" for this provider (see ECMWFForecastProvider), which is the one signal the frontend
// needs to distinguish this from an unrelated failure. Never a silent fallback to synthetic rainfall.
function classifyEcmwfFailure(e) {
  if (e?.status === 503 && /Open-Meteo/.test(e.message || '')) {
    return { status: 'error', message: e.message }
  }
  return { status: 'error', message: 'ECMWF forecast request failed.' }
}

const DEFAULT_LAYERS = {
  streets: true,
  depth: true,
  hotspots: true,
  route: true,
  roads: true,
  drainage: false, // nodes + edges together, OFF by default per product spec
  terrain: false,
}

// Order-insensitive equality check for BlockageSpec objects (backend/floodnet/api/schemas.py::BlockageSpec).
// The backend echoes `run.blockage` back with keys in whatever order pydantic/FastAPI happens to serialise
// them in -- NOT necessarily the order the frontend sent them in (confirmed empirically against the live
// API: frontend sends {"mode":"fraction","fraction":0.7}, backend echoes {"fraction":0.7,"mode":"fraction"}).
// A raw JSON.stringify(a) !== JSON.stringify(b) comparison is key-order sensitive and therefore produces
// false "stale" positives for every non-'none' blockage. Canonicalize by pulling the known BlockageSpec
// fields out in a fixed order (defaulting absent/undefined fields the same way on both sides) before
// stringifying, so two specs that represent the same blockage always compare equal regardless of key order.
function canonBlockage(b) {
  return JSON.stringify({
    mode: b?.mode ?? 'none',
    fraction: b?.fraction ?? null,
    edge_ids: b?.edge_ids ?? null,
    share: b?.share ?? null,
    lonlat: b?.lonlat ?? null,
    radius_m: b?.radius_m ?? null,
    seed: b?.seed ?? null,
  })
}

function emptyRoute() {
  return { origin: null, dest: null, vehicle: 'car', result: null, error: null, loading: false }
}

// POST /api/route/alternatives is an additive sibling of /api/route -- separate state so the existing
// single-route flow (`route` above) is completely unaffected by whether alternatives were ever requested.
function emptyAlternatives() {
  return { result: null, error: null, loading: false, selected: null }
}

export function FloodNetProvider({ children }) {
  const [meta, setMeta] = useState(null)
  const [status, setStatus] = useState(null)
  const [provenance, setProvenance] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [bootError, setBootError] = useState(null)
  const [bootLoading, setBootLoading] = useState(true)

  const [roads, setRoads] = useState(null)
  const [topology, setTopology] = useState(null)
  const [hotspots, setHotspots] = useState(null)
  const [terrain, setTerrain] = useState(null)

  const [scenarioId, setScenarioIdState] = useState(null)
  const [blockage, setBlockageState] = useState({ mode: 'none' })

  const [run, setRun] = useState(null) // last simulate/getRun summary
  const [compareResult, setCompareResult] = useState(null)
  const [series, setSeries] = useState(null)
  const framesRef = useRef(new Map()) // t_min -> frame, cleared whenever run_id changes
  const [frame, setFrame] = useState(null)
  const [currentT, setCurrentT] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Invalidate any active run when simulation inputs (scenario, blockage) change
  const setScenarioId = useCallback((newId) => {
    setScenarioIdState(newId)
    setRun(null)
    setFrame(null)
    setSeries(null)
    setCompareResult(null)
    framesRef.current = new Map()
    setSelectedSegId(null)
    setExplain(null)
    setCurrentT(0)
    setPlaying(false)
    setRoute(emptyRoute())
    setAlternatives(emptyAlternatives())
  }, [])

  const setBlockage = useCallback((newBlockage) => {
    setBlockageState(newBlockage)
    setRun(null)
    setFrame(null)
    setSeries(null)
    setCompareResult(null)
    framesRef.current = new Map()
    setSelectedSegId(null)
    setExplain(null)
    setCurrentT(0)
    setPlaying(false)
    setRoute(emptyRoute())
    setAlternatives(emptyAlternatives())
  }, [])

  const isStale = useMemo(() => {
    if (!run) return false
    if (run.scenario_id !== scenarioId) return true
    if (canonBlockage(run.blockage) !== canonBlockage(blockage)) return true
    return false
  }, [run, scenarioId, blockage])

  const [simulating, setSimulating] = useState(false)
  const [simStageIdx, setSimStageIdx] = useState(0)
  const [simError, setSimError] = useState(null)

  // Tracks the outcome of the most recent LIVE OBSERVATION attempt specifically, independent of `run`/
  // `simError` (a failed live attempt must never touch whatever scenario/replay run is currently on
  // screen). status: null (never attempted this session) | 'success' | 'unavailable' (no credentials) |
  // 'error' (credentials configured but the request/parse failed).
  const [liveAttempt, setLiveAttempt] = useState({ status: null, message: null, timestamp: null })

  // Same idea as `liveAttempt`, tracked separately so a failed ECMWF attempt never touches (or is confused
  // with) live IMD status, and vice versa. status: null (never attempted) | 'success' | 'error'.
  const [ecmwfAttempt, setEcmwfAttempt] = useState({ status: null, message: null, timestamp: null })

  const [selectedSegId, setSelectedSegId] = useState(null)
  const [explain, setExplain] = useState(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState(null)

  const [route, setRoute] = useState(emptyRoute())
  const [alternatives, setAlternatives] = useState(emptyAlternatives())

  // Unlike the single-route flow (see the auto-replan effect below, keyed off `route.result.t_min !==
  // currentT`), alternatives are never auto-recomputed on scrub -- evaluated and rejected as too costly by
  // the routing agent that built this feature. Consumers (map/panel) still need a signal that the currently
  // displayed candidates were computed for a DIFFERENT timestep than the rest of the dashboard, so they can
  // dim/dash stale candidates and surface a "stale, click Compare to refresh" affordance. Computed the same
  // way the single-route staleness check works; this file does not act on it itself.
  const alternativesStale = useMemo(
    () => Boolean(alternatives?.result && alternatives.result.t_min !== currentT),
    [alternatives, currentT],
  )

  const [layers, setLayers] = useState(DEFAULT_LAYERS)
  const [terrainOpacity, setTerrainOpacity] = useState(0.40)
  const [depthOpacity, setDepthOpacity] = useState(0.50)
  const [notice, setNotice] = useState(null) // transient banner {kind:'error'|'info', text}

  const notify = useCallback((text, kind = 'error') => {
    setNotice({ text, kind, at: Date.now() })
  }, [])

  // ---------------------------------------------------------------- boot: load everything independent
  useEffect(() => {
    let cancelled = false
    async function boot() {
      setBootLoading(true)
      const results = await Promise.allSettled([
        api.getMeta().then((m) => !cancelled && setMeta(m)),
        api.getStatus().then((s) => !cancelled && setStatus(s)),
        api.getProvenance().then((p) => !cancelled && setProvenance(p)),
        api.getScenarios().then((s) => {
          if (cancelled) return
          setScenarios(s)
          if (s.length && !scenarioIdRef.current) setScenarioId(s.find((x) => x.id === 'heavy')?.id ?? s[0].id)
        }),
        api.getRoads().then((r) => !cancelled && setRoads(r)),
        api.getTopology().then((t) => !cancelled && setTopology(t)),
        api.getHotspots().then((h) => !cancelled && setHotspots(h)),
        api.getTerrain().then((t) => !cancelled && setTerrain(t)),
      ])
      if (cancelled) return
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length) setBootError(failed.map((r) => r.reason?.message || String(r.reason)).join(' | '))
      setBootLoading(false)
    }
    boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scenarioIdRef = useRef(null)
  scenarioIdRef.current = scenarioId

  const currentScenario = useMemo(
    () => scenarios.find((s) => s.id === scenarioId) || null,
    [scenarios, scenarioId],
  )

  // ---------------------------------------------------------------- simulate
  const stageTimerRef = useRef(null)
  const startStageCycle = useCallback(() => {
    setSimStageIdx(0)
    clearInterval(stageTimerRef.current)
    stageTimerRef.current = setInterval(() => {
      setSimStageIdx((i) => (i + 1) % SIMULATE_STAGES.length)
    }, 1400)
  }, [])
  const stopStageCycle = useCallback(() => {
    clearInterval(stageTimerRef.current)
  }, [])

  const applyRun = useCallback((res) => {
    framesRef.current = new Map()
    setFrame(null)                  // never show the previous run's frame under the new run
    setRun(res)
    setCompareResult(null)
    setSeries(null)
    setSelectedSegId(null)
    setExplain(null)
    // A fresh run (even with "the same" scenario/blockage inputs -- e.g. a new live ECMWF pull) invalidates
    // any route/alternatives computed against the previous run_id; the single-route auto-replan effect keys
    // off `route.result.t_min !== currentT`, which would NOT catch this since currentT resets to the same
    // starting value both times. Clear both to their empty states, same as setScenarioId/setBlockage do.
    setRoute(emptyRoute())
    setAlternatives(emptyAlternatives())
    const firstT = res.frames_t_min?.[0] ?? 0
    setCurrentT(firstT)
  }, [])

  const runSimulation = useCallback(
    async (horizonMin = 180) => {
      if (!scenarioId) return
      const isLive = scenarioId === LIVE_ID
      const isEcmwf = scenarioId === ECMWF_ID
      setSimulating(true)
      setSimError(null)
      startStageCycle()
      try {
        // The response is the COMPLETE run (backend/floodnet/api/bundle.py); it is decoded before the run is
        // shown, so "Complete" always means the map, timeline and panels have their data. No follow-up
        // request needs the server that computed it.
        const res = await decodeRun(await api.simulate({ scenarioId, blockage, horizonMin }))
        applyRun(res)
        setSeries(buildSeries(res))
        refreshDataStatus()
        if (isLive) {
          setLiveAttempt({
            status: 'success',
            message: 'IMD observation received',
            timestamp: res.provenance?.rainfall_source?.timestamp ?? null,
          })
        }
        if (isEcmwf) {
          setEcmwfAttempt({
            status: 'success',
            message: 'ECMWF forecast received',
            timestamp: res.provenance?.rainfall_source?.timestamp ?? null,
          })
        }
      } catch (e) {
        setSimError(e.message)
        notify(e.message)
        refreshDataStatus()          // a failed IMD attempt must update the IMD badge at once
        // A failed LIVE/ECMWF attempt must never disturb whatever scenario/replay run is already on screen
        // -- applyRun() above was simply never called, so `run`/`frame`/the map all stay exactly as they were.
        if (isLive) setLiveAttempt(classifyLiveFailure(e))
        if (isEcmwf) setEcmwfAttempt(classifyEcmwfFailure(e))
      } finally {
        stopStageCycle()
        setSimulating(false)
      }
    },
    [scenarioId, blockage, applyRun, startStageCycle, stopStageCycle, notify],
  )

  const runCompare = useCallback(
    async (horizonMin = 180) => {
      if (!scenarioId) return
      let spec = blockage
      if (!spec || spec.mode === 'none') {
        spec = { mode: 'fraction', fraction: 0.5 }
        // Keep the `blockage` state variable in sync with what's actually being compared -- otherwise
        // run.blockage (set to `spec` below) no longer matches `blockage`, and isStale would correctly-but-
        // unhelpfully flag the resulting compare run as stale, hiding the "Viewing BLOCKED run" indicator.
        setBlockage(spec)
      }
      setSimulating(true)
      setSimError(null)
      startStageCycle()
      try {
        const c = await api.compare({ scenarioId, blockage: spec, horizonMin })
        const { complete, ...blockedSide } = c.blocked
        const blockedRun = await decodeRun(complete)             // the blocked run, complete (as for a forecast)
        setCompareResult({ ...c, blocked: blockedSide })
        framesRef.current = new Map()
        setFrame(null)
        setRun({ ...blockedRun, provenance: c.provenance, blockage: spec, __isCompareBlocked: true })
        setSeries(buildSeries(blockedRun))
        setSelectedSegId(null)
        setExplain(null)
        // Same reasoning as applyRun(): a new compare run invalidates any route/alternatives computed
        // against the previous run_id, and the auto-replan effect won't catch it since currentT resets to
        // the same starting value every time.
        setRoute(emptyRoute())
        setAlternatives(emptyAlternatives())
        setCurrentT(c.frames_t_min?.[0] ?? 0)
      } catch (e) {
        setSimError(e.message)
        notify(e.message)
      } finally {
        stopStageCycle()
        setSimulating(false)
      }
    },
    [scenarioId, blockage, setBlockage, startStageCycle, stopStageCycle, notify],
  )

  // ---------------------------------------------------------------- timeline / frames
  // Frames are rebuilt from the run on screen (lib/runBundle.js), never fetched: the run is already complete in
  // the browser. Street lines need the road geometry, so a frame is (re)built as soon as the roads are loaded.
  useEffect(() => {
    if (!run?.bundle) return
    const cached = framesRef.current.get(currentT)
    if (cached) {
      setFrame(cached)
      return
    }
    const f = buildFrame(run, frameIndex(run, currentT), roads)
    if (roads) framesRef.current.set(currentT, f)
    setFrame(f)
  }, [run, currentT, roads])

  const playTimerRef = useRef(null)
  useEffect(() => {
    clearInterval(playTimerRef.current)
    if (!playing || !run?.frames_t_min?.length) return
    playTimerRef.current = setInterval(() => {
      setCurrentT((t) => {
        const ts = run.frames_t_min
        const i = ts.indexOf(t)
        const next = ts[(i + 1) % ts.length]
        if (next < t) setPlaying(false) // reached the end -> stop rather than loop silently
        return next
      })
    }, 550)
    return () => clearInterval(playTimerRef.current)
  }, [playing, run])

  // ---------------------------------------------------------------- explain
  const selectSegment = useCallback(
    async (segId) => {
      setSelectedSegId(segId)
      if (!segId || !run) return
      setExplainLoading(true)
      setExplainError(null)
      try {
        setExplain(explainFromRun(run, segId, currentT, roads))
      } catch (e) {
        setExplainError(e.message)
        setExplain(null)
      } finally {
        setExplainLoading(false)
      }
    },
    [run, currentT, roads],
  )

  // re-explain automatically as the timeline moves, while a segment stays selected
  useEffect(() => {
    if (selectedSegId) selectSegment(selectedSegId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentT])

  // ---------------------------------------------------------------- routing
  const planRoute = useCallback(
    async ({ origin, dest, vehicle, tMin = currentT }) => {
      setRoute((r) => ({ ...r, origin, dest, vehicle, loading: true, error: null }))
      try {
        const result = await api.findRoute({
          origin, dest, vehicle, tMin, runId: run?.run_id ?? null, dataMode: run?.data_mode ?? null,
          streetDepthM: run?.bundle ? frameDepths(run, frameIndex(run, tMin)) : null,
        })
        setRoute({ origin, dest, vehicle, result, error: null, loading: false })
      } catch (e) {
        setRoute({ origin, dest, vehicle, result: null, error: e.message, loading: false })
      }
    },
    [currentT, run],
  )
  const clearRoute = useCallback(() => {
    setRoute(emptyRoute())
    setAlternatives(emptyAlternatives())
  }, [])

  // Automatically re-evaluate route when timeline moves, if an active route was already evaluated
  useEffect(() => {
    if (route.origin && route.dest && run && !route.loading) {
      if (route.result && route.result.t_min !== currentT) {
        planRoute({ origin: route.origin, dest: route.dest, vehicle: route.vehicle, tMin: currentT })
      }
    }
  }, [currentT, run, route.origin, route.dest, route.vehicle, route.result, route.loading, planRoute])

  // ---------------------------------------------------------------- route alternatives (safest/fastest/balanced)
  // Additive: a completely separate request/response cycle from planRoute() above, so the existing single-route
  // panel/map behaviour is unaffected whether or not alternatives are ever requested.
  const planRouteAlternatives = useCallback(
    async ({ origin, dest, vehicle, tMin = currentT, nCandidates = 3 }) => {
      setAlternatives((a) => ({ ...a, loading: true, error: null }))
      try {
        const series = run?.bundle ? wetSeries(run) : null
        const result = await api.findRouteAlternatives({
          origin, dest, vehicle, tMin, runId: run?.run_id ?? null, nCandidates, dataMode: run?.data_mode ?? null,
          streetDepthM: run?.bundle ? frameDepths(run, frameIndex(run, tMin)) : null,
          seriesTMin: series?.t_min ?? null, streetsCm: series?.streets ?? null,
        })
        const rec = result?.recommended || {}
        const defaultSelected = rec.balanced ?? rec.safest ?? rec.fastest ?? (result?.candidates?.length ? 0 : null)
        setAlternatives({ result, error: null, loading: false, selected: defaultSelected })
      } catch (e) {
        setAlternatives({ result: null, error: e.message, loading: false, selected: null })
      }
    },
    [currentT, run],
  )

  const selectAlternative = useCallback((index) => {
    setAlternatives((a) => ({ ...a, selected: index }))
  }, [])

  /** RoutePlanner's vehicle selector writes here directly (no local component state) so a map click
   * (Context.pickPoint, below) always uses whatever vehicle is currently selected in the panel, rather than
   * whatever vehicle the last *submitted* route used. */
  const setRouteVehicle = useCallback((vehicle) => setRoute((r) => ({ ...r, vehicle })), [])

  /** Click-to-pick on the map (MapView calls this): first click sets origin, second sets destination and
   * immediately plans the route; a third click starts a new pick over. Mirrors the legacy dashboard's
   * "click map twice" UX, now routed through Context so MapView and RoutePlanner never talk to each other
   * directly. */
  const pickPoint = useCallback(
    (lonlat) => {
      setRoute((r) => {
        if (!r.origin || r.dest) return { ...emptyRoute(), origin: lonlat, vehicle: r.vehicle }
        const vehicle = r.vehicle
        const origin = r.origin
        planRoute({ origin, dest: lonlat, vehicle, tMin: currentT })
        return { ...r, dest: lonlat }
      })
    },
    [planRoute, currentT],
  )

  // 2D map | 3D terrain. Pure view state: switching never touches the run, the timeline, the selected source
  // or the selected street. `mapView` is the Leaflet centre (so 3D opens where the operator was looking) and
  // `terrainFocus` lets a tour point the 3D camera at a real place.
  const [mapMode, setMapMode] = useState('2d')
  const [mapView, setMapView] = useState(null)
  const [terrainFocus, setTerrainFocus] = useState(null)

  const toggleLayer = useCallback((key) => setLayers((l) => ({ ...l, [key]: !l[key] })), [])
  // For the tours: switch layers ON without needing to know their current state, and put a saved
  // snapshot back afterwards -- so an explainer never leaves the operator's layer choices changed.
  const ensureLayers = useCallback((keys) => setLayers((l) => (
    keys.every((k) => l[k]) ? l : { ...l, ...Object.fromEntries(keys.map((k) => [k, true])) }
  )), [])
  const restoreLayers = useCallback((snapshot) => { if (snapshot) setLayers(snapshot) }, [])

  // ---------------------------------------------------------------- guided tour / briefing support
  // Two small additions, both ADDITIVE -- nothing above depends on them, and removing them restores the
  // previous behaviour exactly.
  //
  // 1. `activeRightTab` was local state inside App.jsx's RightPanel. It is lifted here (and only here) so a
  //    guided briefing can open the Alerts / Why-flooded / Route tab as part of a narrated step, instead of
  //    the briefing reaching into the DOM to click a tab button. RightPanel still owns all of its rendering;
  //    it just reads/writes the selected tab through context now.
  const [activeRightTab, setActiveRightTab] = useState('overview')

  // 2. A one-way command bus to the map. MapView keeps its Leaflet instance and layer indexes in internal
  //    refs (correctly -- they are imperative objects, not React state), so there is no way to fly the map or
  //    highlight a segment from outside without either exporting those refs or hacking the DOM. Instead,
  //    callers push a small declarative command here and MapView executes it against its own refs. `nonce`
  //    makes repeated identical commands (e.g. flying to the same place twice in one briefing) still fire.
  //    Commands are fire-and-forget: MapView ignores any it does not recognise, and a command issued while
  //    the map is unmounted is simply dropped.
  const [mapCommand, setMapCommand] = useState(null)
  const mapCommandNonceRef = useRef(0)
  const issueMapCommand = useCallback((cmd) => {
    if (!cmd?.type) return
    mapCommandNonceRef.current += 1
    setMapCommand({ ...cmd, nonce: mapCommandNonceRef.current })
  }, [])

  const value = useMemo(
    () => ({
      meta,
      status,
      provenance,
      scenarios,
      currentScenario,
      scenarioId,
      setScenarioId,
      blockage,
      setBlockage,
      isStale,
      bootLoading,
      bootError,
      roads,
      topology,
      hotspots,
      terrain,
      run,
      compareResult,
      series,
      frame,
      currentT,
      setCurrentT,
      playing,
      setPlaying,
      simulating,
      simStage: SIMULATE_STAGES[simStageIdx],
      simStageIdx,
      simError,
      liveAttempt,
      ecmwfAttempt,
      runSimulation,
      runCompare,
      selectedSegId,
      selectSegment,
      explain,
      explainLoading,
      explainError,
      route,
      planRoute,
      clearRoute,
      setRouteVehicle,
      pickPoint,
      alternatives,
      alternativesStale,
      planRouteAlternatives,
      selectAlternative,
      layers,
      toggleLayer,
      ensureLayers,
      restoreLayers,
      mapMode,
      setMapMode,
      mapView,
      setMapView,
      terrainFocus,
      setTerrainFocus,
      terrainOpacity,
      setTerrainOpacity,
      depthOpacity,
      setDepthOpacity,
      notice,
      notify,
      activeRightTab,
      setActiveRightTab,
      mapCommand,
      issueMapCommand,
    }),
    [
      meta, status, provenance, scenarios, currentScenario, scenarioId, setScenarioId, blockage, setBlockage, isStale, bootLoading, bootError,
      roads, topology, hotspots, terrain, run, compareResult, series, frame, currentT, playing, simulating,
      simStageIdx, simError, liveAttempt, ecmwfAttempt, runSimulation, runCompare, selectedSegId, selectSegment, explain, explainLoading,
      explainError, route, planRoute, clearRoute, setRouteVehicle, pickPoint, alternatives, alternativesStale, planRouteAlternatives, selectAlternative,
      layers, toggleLayer, ensureLayers, restoreLayers, mapMode, mapView, terrainFocus, terrainOpacity, depthOpacity, notice, notify,
      activeRightTab, mapCommand, issueMapCommand,
    ],
  )

  return <FloodNetContext.Provider value={value}>{children}</FloodNetContext.Provider>
}

export function useFloodNet() {
  const ctx = useContext(FloodNetContext)
  if (!ctx) throw new Error('useFloodNet must be used inside <FloodNetProvider>')
  return ctx
}
