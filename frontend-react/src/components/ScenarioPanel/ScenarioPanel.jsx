import { useFloodNet, LIVE_ID } from '../../state/FloodNetContext.jsx'
import { fmt, shortId } from '../../lib/format.js'
import styles from './ScenarioPanel.module.css'

const BLOCKAGE_OPTIONS = [
  { value: 'none', label: 'None — all drains clear', spec: { mode: 'none' } },
  { value: 'half', label: 'Uniform 50% blockage', spec: { mode: 'fraction', fraction: 0.5 } },
  { value: 'seventy', label: 'Uniform 70% blockage (validated demo case)', spec: { mode: 'fraction', fraction: 0.7 } },
  { value: 'random', label: 'Random 30% of drains at 60%', spec: { mode: 'random', share: 0.3, fraction: 0.6 } },
]

/** SOURCE / MODE / STATION / RETRIEVED / RAINFALL / FORECAST EXTENSION -- rendered from the structured
 * `detail` fields the backend attaches to a live run's provenance (never parsed out of prose). */
function LiveProvenanceBlock({ rainfallSource }) {
  const d = rainfallSource?.detail || {}
  const row = (label, value) => (
    <div className={styles.liveRow}>
      <span className={styles.liveLabel}>{label}</span>
      <span className={styles.liveValue}>{value ?? '—'}</span>
    </div>
  )
  return (
    <div className={styles.liveProv}>
      <div className={styles.liveHeadline}>Flood forecast driven by live IMD observation + persistence estimate</div>
      {row('Source', d.source || 'IMD')}
      {row('Mode', 'LIVE OBSERVATION')}
      {row('Station', d.station)}
      {row('Retrieved', d.retrieved_at)}
      {row('Rainfall', d.observed_rainfall_mm != null ? `${fmt(d.observed_rainfall_mm, 1)} mm (${d.observation_type || '24h observed'})` : null)}
      {row('Forecast extension', d.forecast_extension_label)}
      {d.forecast_extension_note && <div className={styles.liveNote}>{d.forecast_extension_note}</div>}
    </div>
  )
}

/** Always-visible readiness indicator (Task 5): LIVE / LIVE UNAVAILABLE, computed from /api/status (no
 * credentials configured) and, once attempted this session, from the actual outcome of that attempt. Never
 * shows "LIVE" as succeeded unless a live run genuinely returned data. */
function LiveStatusIndicator({ providerEntry, liveAttempt }) {
  let state, title, sub
  if (liveAttempt.status === 'success') {
    state = 'ok'; title = 'LIVE'; sub = `IMD observation received${liveAttempt.timestamp ? ` — ${liveAttempt.timestamp}` : ''}`
  } else if (liveAttempt.status === 'unavailable') {
    state = 'bad'; title = 'LIVE UNAVAILABLE'; sub = 'IMD API credentials are not configured.'
  } else if (liveAttempt.status === 'error') {
    state = 'bad'; title = 'LIVE UNAVAILABLE'; sub = 'IMD request failed.'
  } else if (!providerEntry?.available) {
    state = 'bad'; title = 'LIVE UNAVAILABLE'; sub = 'IMD credentials required'
  } else {
    state = 'idle'; title = 'LIVE'; sub = 'Configured — run a forecast to fetch the current observation'
  }
  return (
    <div className={`${styles.liveStatus} ${styles['liveStatus_' + state]}`}>
      <span className={styles.liveStatusDot} />
      <div>
        <div className={styles.liveStatusTitle}>{title}</div>
        <div className={styles.liveStatusSub}>{sub}</div>
      </div>
    </div>
  )
}

export default function ScenarioPanel() {
  const {
    scenarios, scenarioId, setScenarioId, currentScenario,
    blockage, setBlockage,
    runSimulation, runCompare, simulating,
    run, simError, status, liveAttempt,
  } = useFloodNet()

  const blockageKey = BLOCKAGE_OPTIONS.find((o) => JSON.stringify(o.spec) === JSON.stringify(blockage))?.value ?? 'none'
  const sourceType = currentScenario?.source?.source_type
  const isLiveSelected = scenarioId === LIVE_ID
  const liveProviderEntry = status?.rainfall_providers?.find((p) => p.id === LIVE_ID) || null
  const liveOptionLabel = liveProviderEntry?.available
    ? `Live Observation — ${liveProviderEntry.source_name || 'IMD'}`
    : 'Live Observation (IMD — credentials required)'

  const summary = run?.summary
  const mb = run?.mass_balance
  const runIsLive = Boolean(run?.provenance?.rainfall_source)

  return (
    <section className={styles.section}>
      <div className="panel-heading">Rainfall &amp; scenario</div>

      <div className={styles.field}>
        <label className="field-label" htmlFor="scenario-select">
          Scenario
        </label>
        <select id="scenario-select" value={scenarioId ?? ''} onChange={(e) => setScenarioId(e.target.value)}>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {fmt(s.total_mm, 0)} mm
            </option>
          ))}
          <option value={LIVE_ID}>{liveOptionLabel}</option>
        </select>
      </div>

      {isLiveSelected ? (
        <>
          <div className={styles.desc}>
            Runs FloodNet on the current IMD-observed rainfall at Mumbai-Santacruz, extended across the 3h
            forecast window with a stated <b>3-hour persistence estimate</b> — not an official IMD nowcast.
          </div>
          <div className={styles.sourceRow}>
            <span className="tag-badge tag-ESTIMATED">LIVE OBSERVATION</span>
            <span className="tag-badge tag-UNKNOWN">3-HOUR PERSISTENCE ESTIMATE</span>
          </div>
          <LiveStatusIndicator providerEntry={liveProviderEntry} liveAttempt={liveAttempt} />
        </>
      ) : (
        currentScenario && (
          <>
            <div className={styles.desc}>{currentScenario.description}</div>
            <div className={styles.sourceRow}>
              <span className={`tag-badge tag-${sourceType === 'historical_replay' ? 'REAL' : 'SYNTHETIC'}`}>
                {sourceType === 'historical_replay' ? 'HISTORICAL REPLAY' : 'SYNTHETIC SCENARIO'}
              </span>
              <span className="tag-badge tag-UNKNOWN">{currentScenario.source?.source_name || currentScenario.provenance?.source}</span>
            </div>
          </>
        )
      )}

      <div className={styles.field}>
        <label className="field-label" htmlFor="blockage-select">
          Drainage blockage
        </label>
        <select
          id="blockage-select"
          value={blockageKey}
          onChange={(e) => setBlockage(BLOCKAGE_OPTIONS.find((o) => o.value === e.target.value)?.spec)}
        >
          {BLOCKAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.buttons}>
        <button className="btn btn-primary btn-block" onClick={() => runSimulation()} disabled={simulating || !scenarioId}>
          Run forecast
        </button>
      </div>
      <div className={styles.buttons}>
        <button className="btn btn-block" onClick={() => runCompare()} disabled={simulating || !scenarioId}>
          Compare normal vs blocked
        </button>
      </div>

      {simError && <div className={styles.errBox}>{simError}</div>}

      {runIsLive && <LiveProvenanceBlock rainfallSource={run.provenance.rainfall_source} />}

      {run && summary && (
        <div className={styles.runInfo}>
          {run.__isCompareBlocked && (
            <div className={styles.compareNote}>
              Comparing normal vs blocked — map, streets and KPIs below show the <b>BLOCKED</b> run; the normal run
              is the cyan line on the timeline chart, blocked is red.
            </div>
          )}
          run <b>{shortId(run.run_id)}</b> &middot; {fmt(run.runtime_s, 1)} s &middot; mass-balance error <b>{fmt(mb?.error_pct, 4)}%</b>
          <br />
          peak depth <b>{fmt(summary.max_depth_cm, 0)} cm</b> &middot; surcharging nodes <b>{summary.peak_surcharging_nodes ?? '–'}</b>
          <br />
          flooded segments <b>{summary.peak_flooded_segments ?? '–'}</b> &middot; surcharge <b>{fmt(summary.total_surcharge_m3, 0)} m&sup3;</b>
        </div>
      )}
    </section>
  )
}
