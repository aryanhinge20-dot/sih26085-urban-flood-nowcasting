import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { activeSource } from '../../lib/sources.js'
import LocationSelector from '../LocationSelector/LocationSelector.jsx'
import styles from './Header.module.css'

// The header names the rainfall source that is ACTUALLY active (lib/sources.js): the completed run's own
// source while its inputs are current, otherwise the current selection marked as not yet run.
function deriveDataSourceText(opts) {
  const src = activeSource(opts)
  return src.ran ? src.name : `${src.name} · not run`
}

function statusLabel(opts) {
  const { bootLoading, bootError, simulating, simError, isStale, run } = opts
  if (bootLoading) return 'Connecting'
  if (bootError)   return 'Offline'
  if (simulating)  return 'Running'
  if (simError)    return 'Error'
  if (isStale)     return 'Inputs changed'
  if (!run)        return 'Ready'
  return 'Complete'
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
          aria-label="FloodNet — return to system overview"
          type="button"
        >
          <span className={`${styles.brandDot} ${simulating ? styles.brandDotPulse : ''}`} aria-hidden="true" />
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
            aria-label={isHomeActive ? 'Switch to map control room' : 'Switch to system overview'}
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

        <div className={styles.metaDivider} aria-hidden="true" />

        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Data Source</span>
          <span className={styles.metaValue} title={dataSourceText}>{dataSourceText}</span>
        </div>

        <div className={styles.metaDivider} aria-hidden="true" />

        <div className={styles.metaBlock}>
          <span className={styles.metaLabel} id="sim-status-label">Simulation Status</span>
          {/* Polite live region: run status transitions (Computing -> Ready / Failed) happen without
              any further user action and are infrequent, so announcing them does not spam. The dot is
              decorative -- the same state is always carried by statusText, so colour is never the
              only channel. */}
          <div
            className={styles.statusRow}
            role="status"
            aria-atomic="true"
            aria-labelledby="sim-status-label"
          >
            <span className={`${styles.statusDot} ${dotClass}`} aria-hidden="true" />
            <span className={styles.metaValue}>{statusText}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

