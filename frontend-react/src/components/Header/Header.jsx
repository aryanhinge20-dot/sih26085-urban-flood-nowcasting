import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmtMinutes } from '../../lib/format.js'
import styles from './Header.module.css'

/** Derives a precise composite data-mode label.
 *
 * The "REAL PILOT DATA" badge was semantically ambiguous when synthetic rainfall
 * was selected — the terrain/network is real but the rainfall is synthetic.
 * This function builds a two-part composite that is always accurate:
 *   Infrastructure source  ·  Rainfall/forecast source
 *
 * Honesty rules (MUST NOT be changed without a corresponding backend audit):
 * - dataModeReal = true means terrain + drainage network are from actual Mumbai
 *   MCGM/OSM data, not a fixture.  It says nothing about the rainfall input.
 * - ECMWF is NWP/FORECAST, never radar, never IMD nowcast.
 * - IMD is LIVE OBSERVATION with a 3h persistence ESTIMATE, not a nowcast.
 * - SYNTHETIC and HISTORICAL REPLAY labels come from the scenario source_type.
 */
function compositeDataMode(dataModeReal, sourceType, runIsLive, runIsEcmwf) {
  const infra = dataModeReal ? 'Real terrain & drainage' : 'Demonstration data'

  // Rainfall label — based on the RUN that actually executed (not just the dropdown)
  let rainfall
  if (runIsLive) {
    rainfall = 'IMD observation + persistence estimate'
  } else if (runIsEcmwf) {
    rainfall = 'ECMWF NWP forecast'
  } else if (sourceType === 'historical_replay') {
    rainfall = 'Historical rainfall replay'
  } else if (sourceType === 'scenario') {
    rainfall = 'Synthetic rainfall scenario'
  } else {
    rainfall = null
  }

  return { infra, rainfall }
}

/** Context-sensitive status label — never calls a synthetic simulation a "forecast ready"
 *  in a way that implies meteorological forecast capability. */
function statusLabel(opts) {
  const { bootLoading, bootError, simulating, run, sourceType, runIsLive, runIsEcmwf } = opts
  if (bootLoading) return 'Connecting to FloodNet…'
  if (bootError)   return 'Some pilot layers unavailable'
  if (simulating)  return 'Generating forecast…'
  if (!run)        return 'Select a scenario and run'
  if (runIsLive)   return 'Nowcast ready'
  if (runIsEcmwf)  return 'NWP forecast ready'
  if (sourceType === 'historical_replay') return 'Replay ready'
  return 'Simulation ready'
}

export default function Header() {
  const { meta, status, currentScenario, run, currentT, simulating, bootLoading, bootError } = useFloodNet()

  const dataModeReal   = status?.data_mode === 'REAL'
  const sourceType     = currentScenario?.source?.source_type
  const runSourceType  = run?.provenance?.rainfall_source?.source_type
  const runIsLive      = runSourceType === 'live_observation'
  const runIsEcmwf     = runSourceType === 'ecmwf_forecast'

  const { infra, rainfall } = compositeDataMode(dataModeReal, sourceType, runIsLive, runIsEcmwf)
  const label = statusLabel({ bootLoading, bootError, simulating, run, sourceType, runIsLive, runIsEcmwf })

  let dotClass = ''
  if (bootError)      dotClass = styles.statusDotBad
  else if (simulating) dotClass = styles.statusDotBusy
  else if (run)        dotClass = styles.statusDotOk

  return (
    <header className={`${styles.header} glass-panel`}>
      {/* Brand */}
      <div className={styles.brand}>
        <span className={`${styles.dot} ${simulating ? styles.dotSimulating : ''}`} />
        <div>
          <div className={styles.title}>FloodNet</div>
          <div className={styles.tagline}>Urban Flood Nowcasting</div>
        </div>
      </div>

      {/* Pilot */}
      <div className={styles.pilot}>
        <div className={styles.pilotName}>{meta?.pilot?.name || 'Hindmata / Dadar, Mumbai'}</div>
        <div className={styles.pilotSub}>
          {runIsLive
            ? 'Live IMD observation · 3-hour persistence estimate'
            : runIsEcmwf
              ? 'ECMWF NWP forecast via Open-Meteo'
              : '0–3 h street-level flood forecast'}
        </div>
      </div>

      <div className={styles.spacer} />

      {/* Composite data-mode badge — always accurate, never ambiguous */}
      <div className={styles.dataMode}>
        <span className={styles.dataModeInfra}>{infra}</span>
        {rainfall && (
          <>
            <span className={styles.dataModeSep}>·</span>
            <span className={`${styles.dataModeRainfall} ${runIsEcmwf ? styles.dataModeNwp : runIsLive ? styles.dataModeLive : sourceType === 'historical_replay' ? styles.dataModeReplay : styles.dataModeSynth}`}>
              {rainfall}
            </span>
          </>
        )}
      </div>

      {/* Forecast clock */}
      {run && (
        <div className={styles.clock}>
          <div className={styles.clockLabel}>T+</div>
          <div className={styles.clockValue}>{fmtMinutes(currentT)}</div>
        </div>
      )}

      {/* Status */}
      <div className={styles.statusBlock}>
        <span className={`${styles.statusDot} ${dotClass}`} />
        <span className={styles.statusText}>{label}</span>
      </div>
    </header>
  )
}
