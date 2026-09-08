import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api/client.js'

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

const DEFAULT_LAYERS = {
  streets: true,
  depth: true,
  hotspots: true,
  route: true,
  roads: true,
  drainage: false, // nodes + edges together, OFF by default per product spec
  terrain: false,
}

function emptyRoute() {
  return { origin: null, dest: null, vehicle: 'car', result: null, error: null, loading: false }
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

  const [scenarioId, setScenarioId] = useState(null)
  const [blockage, setBlockage] = useState({ mode: 'none' })

  const [run, setRun] = useState(null) // last simulate/getRun summary
  const [compareResult, setCompareResult] = useState(null)
  const [series, setSeries] = useState(null)
  const framesRef = useRef(new Map()) // t_min -> frame, cleared whenever run_id changes
  const [frame, setFrame] = useState(null)
  const [currentT, setCurrentT] = useState(0)
  const [playing, setPlaying] = useState(false)

  const [simulating, setSimulating] = useState(false)
  const [simStageIdx, setSimStageIdx] = useState(0)
  const [simError, setSimError] = useState(null)

  const [selectedSegId, setSelectedSegId] = useState(null)
  const [explain, setExplain] = useState(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState(null)

  const [route, setRoute] = useState(emptyRoute())
  const [layers, setLayers] = useState(DEFAULT_LAYERS)
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
    setRun(res)
    setCompareResult(null)
    setSeries(null)
    setSelectedSegId(null)
    setExplain(null)
    const firstT = res.frames_t_min?.[0] ?? 0
    setCurrentT(firstT)
  }, [])

  const runSimulation = useCallback(
    async (horizonMin = 180) => {
      if (!scenarioId) return
      setSimulating(true)
      setSimError(null)
      startStageCycle()
      try {
        const res = await api.simulate({ scenarioId, blockage, horizonMin })
        applyRun(res)
        api
          .getSeries(res.run_id)
          .then(setSeries)
          .catch((e) => notify(e.message, 'error'))
      } catch (e) {
        setSimError(e.message)
        notify(e.message)
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
      if (!spec || spec.mode === 'none') spec = { mode: 'fraction', fraction: 0.5 }
      setSimulating(true)
      setSimError(null)
      startStageCycle()
      try {
        const c = await api.compare({ scenarioId, blockage: spec, horizonMin })
        setCompareResult(c)
        framesRef.current = new Map()
        setRun({
          run_id: c.blocked.run_id,
          scenario_id: scenarioId,
          frames_t_min: c.frames_t_min,
          summary: c.blocked.summary,
          provenance: c.provenance,
          blockage: spec,
          __isCompareBlocked: true,
        })
        setSeries(null)
        setSelectedSegId(null)
        setExplain(null)
        setCurrentT(c.frames_t_min?.[0] ?? 0)
      } catch (e) {
        setSimError(e.message)
        notify(e.message)
      } finally {
        stopStageCycle()
        setSimulating(false)
      }
    },
    [scenarioId, blockage, startStageCycle, stopStageCycle, notify],
  )

  // ---------------------------------------------------------------- timeline / frames
  useEffect(() => {
    if (!run) return
    let cancelled = false
    const cached = framesRef.current.get(currentT)
    if (cached) {
      setFrame(cached)
      return
    }
    api
      .getFrame(run.run_id, currentT)
      .then((f) => {
        if (cancelled) return
        framesRef.current.set(currentT, f)
        setFrame(f)
      })
      .catch((e) => !cancelled && notify(e.message))
    return () => {
      cancelled = true
    }
  }, [run, currentT, notify])

  // background prefetch of the rest of the run's frames so scrubbing/playback is instant
  useEffect(() => {
    if (!run?.frames_t_min?.length) return
    let cancelled = false
    ;(async () => {
      for (const t of run.frames_t_min) {
        if (cancelled) return
        if (framesRef.current.has(t)) continue
        try {
          const f = await api.getFrame(run.run_id, t)
          if (cancelled) return
          framesRef.current.set(t, f)
        } catch {
          return
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [run])

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
        const data = await api.explainSegment(run.run_id, segId, currentT)
        setExplain(data)
      } catch (e) {
        setExplainError(e.message)
        setExplain(null)
      } finally {
        setExplainLoading(false)
      }
    },
    [run, currentT],
  )

  // re-explain automatically as the timeline moves, while a segment stays selected
  useEffect(() => {
    if (selectedSegId) selectSegment(selectedSegId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentT])

  // ---------------------------------------------------------------- routing
  const planRoute = useCallback(
    async ({ origin, dest, vehicle }) => {
      setRoute((r) => ({ ...r, origin, dest, vehicle, loading: true, error: null }))
      try {
        const result = await api.findRoute({ origin, dest, vehicle, tMin: currentT, runId: run?.run_id ?? null })
        setRoute({ origin, dest, vehicle, result, error: null, loading: false })
      } catch (e) {
        setRoute({ origin, dest, vehicle, result: null, error: e.message, loading: false })
      }
    },
    [currentT, run],
  )
  const clearRoute = useCallback(() => setRoute(emptyRoute()), [])

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
        planRoute({ origin, dest: lonlat, vehicle })
        return { ...r, dest: lonlat }
      })
    },
    [planRoute],
  )

  const toggleLayer = useCallback((key) => setLayers((l) => ({ ...l, [key]: !l[key] })), [])

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
      layers,
      toggleLayer,
      notice,
      notify,
    }),
    [
      meta, status, provenance, scenarios, currentScenario, scenarioId, blockage, bootLoading, bootError,
      roads, topology, hotspots, terrain, run, compareResult, series, frame, currentT, playing, simulating,
      simStageIdx, simError, runSimulation, runCompare, selectedSegId, selectSegment, explain, explainLoading,
      explainError, route, planRoute, clearRoute, setRouteVehicle, pickPoint, layers, toggleLayer, notice, notify,
    ],
  )

  return <FloodNetContext.Provider value={value}>{children}</FloodNetContext.Provider>
}

export function useFloodNet() {
  const ctx = useContext(FloodNetContext)
  if (!ctx) throw new Error('useFloodNet must be used inside <FloodNetProvider>')
  return ctx
}
