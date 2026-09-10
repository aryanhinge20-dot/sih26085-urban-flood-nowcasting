import { useFloodNet, LIVE_ID, ECMWF_ID } from '../../state/FloodNetContext.jsx'
import { fmt, shortId } from '../../lib/format.js'
import styles from './ScenarioPanel.module.css'

// A hypothetical what-if input the operator chooses (never a measured/real-time blockage reading) --
// labelled "Blockage scenario" in the UI, not "drainage state", so it's never mistaken for model-derived
// output. Actual model-derived drainage state (surcharging node count, utilization) is reported separately
// in MetricsPanel/WhyFloodedPanel from the real simulation output.
const BLOCKAGE_OPTIONS = [
  { value: 'none',    label: 'None — all drains clear (0%)',              spec: { mode: 'none' } },
  { value: 'half',    label: 'Uniform 50% blockage (what-if)',            spec: { mode: 'fraction', fraction: 0.5 } },
  { value: 'seventy', label: 'Uniform 70% blockage (what-if)', spec: { mode: 'fraction', fraction: 0.7 } },
  { value: 'random',  label: 'Random 30% of drains at 60% (what-if)',     spec: { mode: 'random', share: 0.3, fraction: 0.6 } },
]

/** SOURCE / MODE / STATION / RETRIEVED / RAINFALL / FORECAST EXTENSION — rendered
 *  from the structured `detail` fields the backend attaches to a live run's provenance.
 *  Never parsed out of prose; labels are verbatim from the backend contract. */
function LiveProvenanceBlock({ rainfallSource }) {
  const d = rainfallSource?.detail || {}
  const row = (label, value) =>
    value != null ? (
      <div className={styles.provRow} key={label}>
        <span className={styles.provLabel}>{label}</span>
        <span className={styles.provValue}>{value}</span>
      </div>
    ) : null
  return (
    <div className={styles.provBlock}>
      <div className={styles.provHeadline}>
        Flood forecast driven by live IMD observation + persistence estimate
      </div>
      {row('Source',  d.source || 'IMD')}
      {row('Mode',    'LIVE OBSERVATION')}
      {row('Station', d.station)}
      {row('Retrieved', d.retrieved_at)}
      {row('Rainfall',
        d.observed_rainfall_mm != null
          ? `${fmt(d.observed_rainfall_mm, 1)} mm (${d.observation_type || '24h observed'})`
          : null)}
      {row('Forecast extension', d.forecast_extension_label)}
      {d.forecast_extension_note && (
        <div className={styles.provNote}>{d.forecast_extension_note}</div>
      )}
    </div>
  )
}

/** Always-visible readiness indicator. Never shows "LIVE" as succeeded unless a
 *  live run genuinely returned data; never inspects anything that could contain a key. */
function LiveStatusIndicator({ providerEntry, liveAttempt }) {
  let state, title, sub
  if (liveAttempt.status === 'success') {
    state = 'ok'
    title = 'LIVE'
    sub   = `IMD observation received${liveAttempt.timestamp ? ` — ${liveAttempt.timestamp}` : ''}`
  } else if (liveAttempt.status === 'unavailable') {
    state = 'bad'; title = 'LIVE UNAVAILABLE'; sub = 'IMD API credentials are not configured.'
  } else if (liveAttempt.status === 'error') {
    state = 'bad'; title = 'LIVE UNAVAILABLE'; sub = 'IMD request failed.'
  } else if (!providerEntry?.available) {
    state = 'bad'; title = 'LIVE UNAVAILABLE'; sub = 'IMD credentials required'
  } else {
    state = 'idle'; title = 'LIVE'; sub = 'Configured — run a forecast to fetch the observation'
  }
  return (
    <div className={`${styles.statusRow} ${styles['statusRow_' + state]}`}>
      <span className={styles.statusDot} />
      <div>
        <div className={styles.statusTitle}>{title}</div>
        <div className={styles.statusSub}>{sub}</div>
      </div>
    </div>
  )
}

/** SOURCE/MODEL/RETRIEVED/CLASSIFICATION/TIMESTAMPS/RAINFALL block for an ECMWF NWP run.
 *  Deliberately labelled "ECMWF NWP" / "Numerical Weather Prediction" throughout —
 *  never IMD, LIVE, radar, or nowcast. */
function EcmwfProvenanceBlock({ rainfallSource }) {
  const d = rainfallSource?.detail || {}
  const row = (label, value) =>
    value != null ? (
      <div className={styles.provRow} key={label}>
        <span className={styles.provLabel}>{label}</span>
        <span className={styles.provValue}>{value}</span>
      </div>
    ) : null
  return (
    <div className={styles.provBlock}>
      <div className={styles.provHeadline}>
        Flood forecast driven by ECMWF NWP forecast (Open-Meteo — temporary source)
      </div>
      {row('Source',  d.source || 'Open-Meteo')}
      {row('Model',   d.model || 'ECMWF')}
      {row('Classification', d.classification || 'FORECAST')}
      {row('Retrieved', d.retrieved_at)}
      {row('Location',
        d.location_lonlat ? `${d.location_lonlat[1]}, ${d.location_lonlat[0]}` : null)}
      {row('Forecast hours', d.forecast_timestamps?.join(', '))}
      {row('Precipitation (mm/h)', d.precipitation_mm?.map((v) => fmt(v, 1)).join(', '))}
      <div className={styles.provNote}>
        Numerical weather prediction forecast — not a radar nowcast, not an IMD product.
        Temporary source while official IMD API access is pending.
      </div>
    </div>
  )
}

/** Always-visible ECMWF readiness indicator. ECMWF needs no credentials so it is
 *  never "unavailable" for a configuration reason — only idle, error, or ok. */
function EcmwfStatusIndicator({ ecmwfAttempt }) {
  let state, title, sub
  if (ecmwfAttempt.status === 'success') {
    state = 'ok'
    title = 'ECMWF NWP'
    sub   = `Forecast received${ecmwfAttempt.timestamp ? ` — ${ecmwfAttempt.timestamp}` : ''}`
  } else if (ecmwfAttempt.status === 'error') {
    state = 'bad'
    title = 'ECMWF UNAVAILABLE'
    sub   = ecmwfAttempt.message || 'Open-Meteo request failed.'
  } else {
    state = 'idle'
    title = 'ECMWF NWP'
    sub   = 'Run a forecast to fetch the current ECMWF precipitation forecast'
  }
  return (
    <div className={`${styles.statusRow} ${styles['statusRow_' + state]}`}>
      <span className={styles.statusDot} />
      <div>
        <div className={styles.statusTitle}>{title}</div>
        <div className={styles.statusSub}>{sub}</div>
      </div>
    </div>
  )
}

export default function ScenarioPanel() {
  const {
    scenarios, scenarioId, setScenarioId, currentScenario,
    blockage, setBlockage,
    runSimulation, runCompare, simulating,
    run, simError, status, liveAttempt, ecmwfAttempt, isStale,
  } = useFloodNet()

  const blockageKey    = BLOCKAGE_OPTIONS.find((o) => JSON.stringify(o.spec) === JSON.stringify(blockage))?.value ?? 'none'
  const sourceType     = currentScenario?.source?.source_type
  const isLiveSelected = scenarioId === LIVE_ID
  const isEcmwfSelected= scenarioId === ECMWF_ID
  const liveProvider   = status?.rainfall_providers?.find((p) => p.id === LIVE_ID) || null
  const liveOptionLabel= liveProvider?.available
    ? `Live Observation — ${liveProvider.source_name || 'IMD'}`
    : 'Live Observation (IMD — credentials required)'
  const ecmwfLabel = 'ECMWF NWP Forecast (Open-Meteo — temporary, while IMD access is pending)'

  const summary       = run?.summary
  const mb            = run?.mass_balance
  const runSourceType = run?.provenance?.rainfall_source?.source_type
  const runIsLive     = runSourceType === 'live_observation'
  const runIsEcmwf    = runSourceType === 'ecmwf_forecast'

  return (
    <section className={styles.section}>
      <div className="panel-heading">Scenario &amp; Rainfall</div>

      <div className={styles.field}>
        <label className="field-label" htmlFor="scenario-select">Scenario</label>
        <select
          id="scenario-select"
          value={scenarioId ?? ''}
          onChange={(e) => setScenarioId(e.target.value)}
          disabled={simulating}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {fmt(s.total_mm, 0)} mm</option>
          ))}
          <option value={LIVE_ID}>{liveOptionLabel}</option>
          <option value={ECMWF_ID}>{ecmwfLabel}</option>
        </select>
      </div>

      {isLiveSelected ? (
        <>
          <div className={styles.desc}>
            Runs FloodNet on the current IMD-observed rainfall at Mumbai-Santacruz, extended
            across the 3h forecast window with a stated{' '}
            <strong>3-hour persistence estimate</strong> — not an official IMD nowcast.
          </div>
          <div className={styles.tagRow}>
            <span className="tag-badge tag-ESTIMATED">LIVE OBSERVATION</span>
            <span className="tag-badge tag-UNKNOWN">3-HOUR PERSISTENCE ESTIMATE</span>
          </div>
          <LiveStatusIndicator providerEntry={liveProvider} liveAttempt={liveAttempt} />
        </>
      ) : isEcmwfSelected ? (
        <>
          <div className={styles.desc}>
            Runs FloodNet on the current ECMWF (IFS 0.25°) precipitation forecast for the
            pilot area, fetched from Open-Meteo — a numerical-weather-prediction{' '}
            <strong>FORECAST</strong>, not a radar nowcast, and not an IMD product.
            Temporary source while official IMD API access is pending.
          </div>
          <div className={styles.tagRow}>
            <span className="tag-badge tag-NWP">ECMWF NWP</span>
            <span className="tag-badge tag-UNKNOWN">FORECAST</span>
          </div>
          <EcmwfStatusIndicator ecmwfAttempt={ecmwfAttempt} />
        </>
      ) : (
        currentScenario && (
          <>
            <div className={styles.desc}>{currentScenario.description}</div>
            <div className={styles.tagRow}>
              <span className={`tag-badge tag-${sourceType === 'historical_replay' ? 'REAL' : 'SYNTHETIC'}`}>
                {sourceType === 'historical_replay' ? 'HISTORICAL REPLAY' : 'SYNTHETIC SCENARIO'}
              </span>
              <span className="tag-badge tag-UNKNOWN">
                {currentScenario.source?.source_name || currentScenario.provenance?.source}
              </span>
            </div>
          </>
        )
      )}

      <div className={styles.actions}>
        <button
          className="btn btn-primary btn-block"
          onClick={() => runSimulation()}
          disabled={simulating || !scenarioId}
          aria-busy={simulating}
        >
          {simulating ? (
            <><span className={styles.btnSpinner} aria-hidden="true" />Generating forecast…</>
          ) : 'Run forecast'}
        </button>
      </div>

      {/* Blockage is a secondary what-if exploration, not part of the primary
          rainfall -> forecast path — kept collapsed by default so only the
          scenario selector and "Run forecast" show in the default state. */}
      <details className={styles.whatIf}>
        <summary className={styles.whatIfSummary}>What-if: reduced drainage capacity (optional)</summary>
        <div className={styles.whatIfBody}>
          <div className={styles.field}>
            <label className="field-label" htmlFor="blockage-select">Blockage scenario (what-if)</label>
            <select
              id="blockage-select"
              value={blockageKey}
              onChange={(e) => setBlockage(BLOCKAGE_OPTIONS.find((o) => o.value === e.target.value)?.spec)}
              disabled={simulating}
            >
              {BLOCKAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            className={`btn btn-block ${styles.whatIfActions}`}
            onClick={() => runCompare()}
            disabled={simulating || !scenarioId}
          >
            Compare normal vs blocked
          </button>
        </div>
      </details>

      {simError && <div className={styles.errBox}>{simError}</div>}

      {/* Post-run provenance blocks — shown only when run genuinely used that source and is not stale */}
      {run && !isStale && runIsLive  && <LiveProvenanceBlock  rainfallSource={run.provenance.rainfall_source} />}
      {run && !isStale && runIsEcmwf && <EcmwfProvenanceBlock rainfallSource={run.provenance.rainfall_source} />}

      {/* Run summary grid — shown only when current active run matches selected inputs */}
      {run && !isStale && summary && (
        <div className={styles.runSummary}>
          {run.__isCompareBlocked && (
            <div className={styles.compareNote}>
              Viewing <strong>BLOCKED</strong> run — normal (blue) vs blocked (orange) on timeline
            </div>
          )}
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCell}>
              <span className={styles.summaryCellLabel}>Forecast peak depth</span>
              <span className={styles.summaryCellValue}>{fmt(summary.max_depth_cm, 0)} cm</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryCellLabel}>Surcharge volume</span>
              <span className={styles.summaryCellValue}>{fmt(summary.total_surcharge_m3, 0)} m³</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryCellLabel}>Flooded segs</span>
              <span className={styles.summaryCellValue}>{summary.peak_flooded_segments ?? '–'}</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryCellLabel}>Surcharging</span>
              <span className={styles.summaryCellValue}>{summary.peak_surcharging_nodes ?? '–'} nodes</span>
            </div>
            <div className={styles.summaryCell}>
              <span className={styles.summaryCellLabel}>Runtime</span>
              <span className={styles.summaryCellValue}>{fmt(run.runtime_s, 1)} s</span>
            </div>
          </div>
          <div className={styles.summaryFooter}>
            Mass-balance error: <strong>{fmt(mb?.error_pct, 4)}%</strong>
            {' · '}
            Run <code>{shortId(run.run_id)}</code>
          </div>
        </div>
      )}
    </section>
  )
}
