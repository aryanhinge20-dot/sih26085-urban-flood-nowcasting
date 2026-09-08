import { useEffect, useMemo, useState } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmt } from '../../lib/format.js'
import styles from './RoutePlanner.module.css'

// Matches the backend's VEHICLE_LIMIT_CM keys (see lib/severity.js's passable() default map / config.py).
const VEHICLES = [
  { value: 'car', label: 'Car' },
  { value: 'ambulance', label: 'Ambulance' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'truck', label: 'Truck' },
  { value: 'pedestrian', label: 'Pedestrian' },
]

function parseLonLat(text) {
  const parts = String(text ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
  return parts.length === 2 && parts.every(Number.isFinite) ? parts : null
}

function fmtLonLat(lonlat) {
  return lonlat ? `${lonlat[0].toFixed(5)},${lonlat[1].toFixed(5)}` : ''
}

export default function RoutePlanner() {
  const { route, planRoute, clearRoute, setRouteVehicle, roads } = useFloodNet()

  const [originText, setOriginText] = useState('')
  const [destText, setDestText] = useState('')
  const vehicle = route.vehicle || 'car'
  const [formError, setFormError] = useState(null)

  // Map-click picking (MapView -> Context.pickPoint) is the primary flow; mirror whatever it sets into the
  // manual text inputs so both entry paths always show the same current origin/destination.
  useEffect(() => {
    setOriginText(fmtLonLat(route.origin))
    setDestText(fmtLonLat(route.dest))
  }, [route.origin, route.dest])

  // seg_id -> name, for showing readable avoided-street names (avoided_segments from /api/route is just a
  // list of id strings) -- built from the roads FeatureCollection already loaded into Context.
  const segNameById = useMemo(() => {
    const m = new Map()
    for (const f of roads?.features || []) {
      if (f.properties?.seg_id != null) m.set(String(f.properties.seg_id), f.properties.name)
    }
    return m
  }, [roads])

  const handleFind = () => {
    const origin = parseLonLat(originText)
    const dest = parseLonLat(destText)
    if (!origin || !dest) {
      setFormError('Enter both origin and destination as "lon,lat" (or click the map twice), then try again.')
      return
    }
    setFormError(null)
    planRoute({ origin, dest, vehicle })
  }

  const handleClear = () => {
    setFormError(null)
    clearRoute()
  }

  const result = route.result
  const unreachable = Boolean(result && result.reachable === false)
  const reachableResult = Boolean(result && result.reachable !== false)

  const avoided = result?.avoided_segments || []
  const avoidedNames = avoided.map((id) => segNameById.get(String(id)) || id)
  const detourM = result?.length_m != null && result?.baseline_length_m != null ? result.length_m - result.baseline_length_m : null

  return (
    <section className={styles.section}>
      <div className="panel-heading">Flood-safe routing</div>

      <div className={styles.field}>
        <label className="field-label" htmlFor="rp-vehicle">
          Vehicle
        </label>
        <select id="rp-vehicle" value={vehicle} onChange={(e) => setRouteVehicle(e.target.value)}>
          {VEHICLES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className="field-label" htmlFor="rp-origin">
          Origin (lon,lat)
        </label>
        <input
          id="rp-origin"
          type="text"
          placeholder="e.g. 72.8447,19.0176"
          value={originText}
          onChange={(e) => setOriginText(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className="field-label" htmlFor="rp-dest">
          Destination (lon,lat)
        </label>
        <input
          id="rp-dest"
          type="text"
          placeholder="e.g. 72.8461,19.0202"
          value={destText}
          onChange={(e) => setDestText(e.target.value)}
        />
      </div>
      <div className={styles.hint}>Click the map twice (origin, then destination) or type coordinates above.</div>

      <div className={styles.buttons}>
        <button className="btn btn-primary btn-block" onClick={handleFind} disabled={route.loading}>
          {route.loading ? 'Routing…' : 'Find route'}
        </button>
        <button className="btn" onClick={handleClear}>
          Clear
        </button>
      </div>

      {formError && <div className={styles.errBox}>{formError}</div>}
      {route.error && <div className={styles.errBox}>{route.error}</div>}

      {!result && !route.loading && !route.error && (route.origin || route.dest) && (
        <div className={styles.pickStatus}>
          {route.origin && !route.dest ? 'Origin set — pick a destination to route.' : 'Ready to route.'}
        </div>
      )}

      {unreachable && (
        <div className={styles.alert} role="alert">
          <span className={styles.alertIcon} aria-hidden="true">
            ⚠
          </span>
          <div className={styles.alertText}>
            <div className={styles.alertTitle}>NO SAFE ROUTE AT {Math.round(result.t_min ?? 0)} MIN</div>
            <div className={styles.alertBody}>
              ALL AVAILABLE PATHS EXCEED {(result.vehicle || vehicle || '').toUpperCase()} DEPTH LIMIT
              {result.vehicle_limit_cm != null ? ` (${Math.round(result.vehicle_limit_cm)} CM)` : ''}
            </div>
          </div>
        </div>
      )}

      {reachableResult && (
        <div className={styles.resultBox}>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Safe route distance</span>
            <span className={styles.resultValue}>{fmt(result.length_m, 0)} m</span>
          </div>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Baseline (unrestricted) distance</span>
            <span className={styles.resultValue}>
              {fmt(result.baseline_length_m, 0)} m
              {detourM != null ? ` (+${fmt(detourM, 0)} m detour)` : ''}
            </span>
          </div>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Max depth on route</span>
            <span className={styles.resultValue}>
              {result.max_depth_on_route_cm != null ? `${fmt(result.max_depth_on_route_cm, 0)} cm` : 'not available'}
            </span>
          </div>
          <div className={styles.resultRow}>
            <span className={styles.resultLabel}>Segments avoided</span>
            <span className={styles.resultValue}>
              {avoided.length}
              {avoided.length > 0 && (
                <span className={styles.avoidedList}>
                  {': '}
                  {avoidedNames.slice(0, 4).join(', ')}
                  {avoidedNames.length > 4 ? ` +${avoidedNames.length - 4} more` : ''}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
