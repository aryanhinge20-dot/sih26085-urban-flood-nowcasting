import { useFloodNet, LIVE_ID, ECMWF_ID } from '../../state/FloodNetContext.jsx'
import LocationSelector from '../LocationSelector/LocationSelector.jsx'
import styles from './Header.module.css'

function deriveDataSourceText({ run, isStale, scenarioId, currentScenario }) {
  if (run && !isStale) {
    const runSourceType = run?.provenance?.rainfall_source?.source_type
    if (runSourceType === 'live_observation') return 'IMD live observation'
    if (runSourceType === 'ecmwf_forecast')   return 'ECMWF NWP forecast'
    if (run.scenario_id === 'july2005')       return 'July 2005 replay'
    if (run.scenario_id === 'cloudburst')     return 'Cloudburst scenario'
    return run.scenario_name ? `${run.scenario_name} (Run)` : 'Synthetic scenario'
  }

  // When no simulation has been run yet for this scenario, or inputs changed:
  if (scenarioId === LIVE_ID)               return 'IMD live observation (unrun)'
  if (scenarioId === ECMWF_ID)              return 'ECMWF NWP forecast (unrun)'
  if (currentScenario?.id === 'july2005')   return 'July 2005 replay (unrun)'
  if (currentScenario?.name)                return `${currentScenario.name} (unrun)`
  return 'Scenario not run'
}

function statusLabel(opts) {
  const { bootLoading, bootError, simulating, simError, isStale, run } = opts
  if (bootLoading) return 'Connecting'
  if (bootError)   return 'Offline'
  if (simulating)  return 'Computing forecast…'
  if (simError)    return 'Simulation failed'
  if (isStale)     return 'Inputs changed — Run forecast'
  if (!run)        return 'Ready'
  return 'Forecast ready'
}

export default function Header({ onToggleHome, isHomeActive }) {
  const {
    scenarioId, currentScenario, run, isStale, currentT,
    simulating, simError, bootLoading, bootError,
  } = useFloodNet()

  const dataSourceText = deriveDataSourceText({ run, isStale, scenarioId, currentScenario })
  const statusText = statusLabel({ bootLoading, bootError, simulating, simError, isStale, run })

  let dotClass = styles.statusDotOk
  if (bootError || simError) dotClass = styles.statusDotBad
  else if (simulating) dotClass = styles.statusDotBusy
  else if (isStale) dotClass = styles.statusDotStale

  return (
    <header className={`${styles.header} glass-panel`}>
      {/* Left: Brand & Command Centre Title */}
      <div className={styles.leftCol}>
        <button
          className={styles.brandBtn}
          onClick={onToggleHome}
          title="Return to System Overview"
          type="button"
        >
          <span className={`${styles.brandDot} ${simulating ? styles.brandDotPulse : ''}`} />
          <div className={styles.brandMeta}>
            <span className={styles.brandTitle}>FloodNet</span>
            <span className={styles.brandSub}>Urban Flood Command Centre</span>
          </div>
        </button>

        {onToggleHome && (
          <button
            className={styles.overviewBtn}
            onClick={onToggleHome}
            type="button"
            title="Switch between Overview and Control Room"
          >
            {isHomeActive ? 'Map' : 'Overview'}
          </button>
        )}
      </div>

      {/* Centre: Location */}
      <div className={styles.centerCol}>
        <LocationSelector />
      </div>

      {/* Right: Authoritative Timestep, Data Source & Status */}
      <div className={styles.rightCol}>
        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Forecast Timestep</span>
          <span className={styles.metaValue}>
            {run && !isStale ? (
              <>
                <strong className={styles.timestepAccent}>T+{currentT} min</strong>
                {currentT >= 60 && (
                  <span className={styles.metaSub}> ({Math.floor(currentT / 60)}h {String(currentT % 60).padStart(2, '0')}m)</span>
                )}
              </>
            ) : (
              <span className={styles.metaDim}>— (Unrun)</span>
            )}
          </span>
        </div>

        <div className={styles.metaDivider} />

        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Data Source</span>
          <span className={styles.metaValue}>{dataSourceText}</span>
        </div>

        <div className={styles.metaDivider} />

        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Simulation Status</span>
          <div className={styles.statusRow}>
            <span className={`${styles.statusDot} ${dotClass}`} />
            <span className={styles.metaValue}>{statusText}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

