import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmtMinutes } from '../../lib/format.js'
import styles from './Header.module.css'

export default function Header() {
  const { meta, status, currentScenario, run, currentT, simulating, bootLoading, bootError } = useFloodNet()

  const dataModeReal = status?.data_mode === 'REAL'
  const sourceType = currentScenario?.source?.source_type // 'scenario' | 'historical_replay'
  // Based on the RUN that actually executed, not just the dropdown selection -- a forecast is only
  // "live-driven" once IMD data was genuinely fetched and used, never merely because "Live" is selected.
  // Checked by source_type specifically (not just "some rainfall_source is present") so an ECMWF-driven run
  // is never mislabelled as a live IMD observation, or vice versa.
  const runSourceType = run?.provenance?.rainfall_source?.source_type
  const runIsLive = runSourceType === 'live_observation'
  const runIsEcmwf = runSourceType === 'ecmwf_forecast'

  let statusLabel = 'Idle — select a scenario and run a forecast'
  let statusDot = ''
  if (bootLoading) {
    statusLabel = 'Connecting to FloodNet backend…'
  } else if (bootError) {
    statusLabel = 'Some pilot layers unavailable'
    statusDot = styles.statusDotBad
  } else if (simulating) {
    statusLabel = 'Generating forecast…'
    statusDot = styles.statusDotBusy
  } else if (run) {
    statusLabel = 'Forecast ready'
    statusDot = styles.statusDotOk
  }

  return (
    <header className={`${styles.header} glass-panel`}>
      <div className={styles.brand}>
        <span className={styles.dot} />
        <div>
          <div className={styles.title}>FloodNet</div>
          <div className={styles.tagline}>Urban Flood Nowcasting</div>
        </div>
      </div>

      <div className={styles.pilot}>
        <div className={styles.pilotName}>{meta?.pilot?.name || 'Pilot: Hindmata / Dadar, Mumbai'}</div>
        <div className={styles.pilotSub}>
          {runIsLive
            ? 'Flood forecast driven by live IMD observation + persistence estimate'
            : runIsEcmwf
              ? 'Flood forecast driven by ECMWF NWP forecast (Open-Meteo, temporary source)'
              : '0–3 h street-level flood forecast'}
        </div>
      </div>

      <div className={styles.spacer} />

      <div className={styles.badges}>
        <span className={`${styles.pill} ${dataModeReal ? styles.pillReal : styles.pillDemo}`}>
          {dataModeReal ? 'REAL PILOT DATA' : 'DEMONSTRATION DATA'}
        </span>
        {runIsLive ? (
          <span className={`${styles.pill} ${styles.pillReal}`}>LIVE OBSERVATION</span>
        ) : runIsEcmwf ? (
          <span className={`${styles.pill} ${styles.pillReal}`}>ECMWF NWP FORECAST</span>
        ) : sourceType === 'historical_replay' ? (
          <span className={`${styles.pill} ${styles.pillReplay}`}>HISTORICAL REPLAY</span>
        ) : sourceType === 'scenario' ? (
          <span className={`${styles.pill} ${styles.pillSource}`}>SYNTHETIC SCENARIO</span>
        ) : null}
      </div>

      <div className={styles.clock}>
        <div className={styles.clockLabel}>Forecast time</div>
        {run ? `T+${fmtMinutes(currentT)}` : '—'}
      </div>

      <div className={styles.status}>
        <span className={`${styles.statusDot} ${statusDot}`} />
        {statusLabel}
      </div>
    </header>
  )
}
