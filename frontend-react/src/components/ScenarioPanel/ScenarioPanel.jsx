import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmt, shortId } from '../../lib/format.js'
import styles from './ScenarioPanel.module.css'

const BLOCKAGE_OPTIONS = [
  { value: 'none', label: 'None — all drains clear', spec: { mode: 'none' } },
  { value: 'half', label: 'Uniform 50% blockage', spec: { mode: 'fraction', fraction: 0.5 } },
  { value: 'seventy', label: 'Uniform 70% blockage (validated demo case)', spec: { mode: 'fraction', fraction: 0.7 } },
  { value: 'random', label: 'Random 30% of drains at 60%', spec: { mode: 'random', share: 0.3, fraction: 0.6 } },
]

export default function ScenarioPanel() {
  const {
    scenarios, scenarioId, setScenarioId, currentScenario,
    blockage, setBlockage,
    runSimulation, runCompare, simulating,
    run, simError,
  } = useFloodNet()

  const blockageKey = BLOCKAGE_OPTIONS.find((o) => JSON.stringify(o.spec) === JSON.stringify(blockage))?.value ?? 'none'
  const sourceType = currentScenario?.source?.source_type

  const summary = run?.summary
  const mb = run?.mass_balance

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
        </select>
      </div>

      {currentScenario && (
        <>
          <div className={styles.desc}>{currentScenario.description}</div>
          <div className={styles.sourceRow}>
            <span className={`tag-badge tag-${sourceType === 'historical_replay' ? 'REAL' : 'SYNTHETIC'}`}>
              {sourceType === 'historical_replay' ? 'HISTORICAL REPLAY' : 'SYNTHETIC SCENARIO'}
            </span>
            <span className="tag-badge tag-UNKNOWN">{currentScenario.source?.source_name || currentScenario.provenance?.source}</span>
          </div>
        </>
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
