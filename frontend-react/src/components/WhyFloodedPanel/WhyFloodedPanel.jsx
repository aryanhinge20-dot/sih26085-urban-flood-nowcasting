import { useState, useMemo } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmt } from '../../lib/format.js'
import SeverityBadge from '../SeverityBadge/SeverityBadge.jsx'
import styles from './WhyFloodedPanel.module.css'

// Mirrors the backend's `dominant_cause` enum (backend/floodnet/api/main.py's /explain endpoint) 1:1.
const CAUSE_SENTENCES = {
  drainage_overcapacity: 'The nearby drainage node is surcharging because inflow exceeds its hydraulic capacity.',
  drainage_blockage: 'The nearby drainage node is surcharging because an outgoing pipe is blocked.',
  drainage_downstream_backup:
    'The nearby drainage node is surcharging because downstream capacity is limiting outflow (backwater).',
  surface_ponding_only:
    'Surface runoff is accumulating faster than local drainage inlets can capture water, causing depression ponding without node surcharge.',
  unknown: 'No clear dominant cause could be attributed from the current simulation state.',
}

export function explainSentence(explain) {
  if (!explain) return ''
  const base = CAUSE_SENTENCES[explain.dominant_cause] || CAUSE_SENTENCES.unknown
  const node = explain.nearest_drainage_node
  const parts = []
  if (explain.rainfall_mm_h != null) parts.push(`Rain: ${fmt(explain.rainfall_mm_h, 0)} mm/h`)
  if (node?.id != null && node?.distance_m != null) {
    parts.push(`Nearest node ${node.id} (${node.distance_m.toFixed(0)}m)`)
  }
  return parts.length ? `${base} [${parts.join(' · ')}]` : base
}

const DRAINAGE_CAUSES = new Set(['drainage_overcapacity', 'drainage_blockage', 'drainage_downstream_backup'])

export function buildCausalChain(explain) {
  if (!explain) return []
  const node = explain.nearest_drainage_node
  const isSurcharging = Boolean(node?.surcharging)
  const hasDrainageIssue = DRAINAGE_CAUSES.has(explain.dominant_cause)
  const surchargeActive = isSurcharging || hasDrainageIssue
  const rainRate = explain.rainfall_mm_h != null ? explain.rainfall_mm_h : 0
  const depth = explain.depth_cm != null ? explain.depth_cm : 0

  return [
    {
      id: 'rain',
      phase: '01',
      label: 'RAINFALL',
      sublabel: 'Precipitation Intensity',
      status: 'computed',
      active: true,
      detail: rainRate > 0 ? `${fmt(rainRate, 0)} mm/h spatial rainfall rate` : 'Atmospheric precipitation input',
    },
    {
      id: 'runoff',
      phase: '02',
      label: 'RUNOFF',
      sublabel: 'Impervious Surface Conversion',
      status: 'structural',
      active: true,
      detail: 'Urban density and asphalt streetscapes convert 85%+ rainfall into rapid surface runoff.',
    },
    {
      id: 'terrain',
      phase: '03',
      label: 'TERRAIN',
      sublabel: '2D Elevation Routing',
      status: 'computed',
      active: true,
      detail: explain.terrain_context?.ground_elevation_m != null
        ? `Water drains along DEM gradients toward Hindmata depression bowl (${fmt(explain.terrain_context.ground_elevation_m, 2)}m MSL).`
        : 'Water routing along DEM elevation gradients into local depression.',
    },
    {
      // Evidence-gated: only shown as an active/contributing cause when the model's own dominant_cause
      // classification says drainage is actually limiting -- e.g. utilization=3%, not surcharging (a real,
      // observed case: surface_ponding_only) must NOT visually imply drainage capacity was exceeded.
      id: 'drainage',
      phase: '04',
      label: 'DRAINAGE CAPACITY',
      sublabel: 'Conduit Hydraulic Conveyance',
      status: 'computed',
      active: hasDrainageIssue,
      detail: hasDrainageIssue
        ? (node?.utilization != null
            ? `Conduit node ${node.id || 'N/A'} at ${Math.round(node.utilization * 100)}% capacity -- limiting factor here.`
            : 'Stormwater pipe network conveyance capacity exceeded here.')
        : (node?.utilization != null
            ? `Nearest conduit node ${node.id || 'N/A'} at ${Math.round(node.utilization * 100)}% capacity -- drainage not the current limiting factor.`
            : 'Drainage not the current limiting factor.'),
    },
    {
      id: 'surcharge',
      phase: '05',
      label: 'SURCHARGE / OVERFLOW',
      sublabel: 'Inlet Surcharge & Backwater',
      status: 'computed',
      active: surchargeActive,
      detail: surchargeActive
        ? `Hydraulic overload: backwater surcharges up through street inlets.`
        : 'Conduit inflow captured without street-level surcharge.',
    },
    {
      id: 'flooding',
      phase: '06',
      label: 'STREET FLOODING',
      sublabel: 'Roadway Inundation Depth',
      status: 'computed',
      active: depth > 0,
      detail: depth > 0
        ? `${fmt(depth, 1)} cm modeled flood depth on roadway segment.`
        : 'Corridor remains passable (0.0 cm).',
    },
  ]
}

export default function WhyFloodedPanel() {
  const { selectedSegId, explain, explainLoading, explainError, series, currentT } = useFloodNet()
  const [showEvidence, setShowEvidence] = useState(false)

  // Compute peak depth and time for this specific road segment across the whole run
  const segPeak = useMemo(() => {
    if (!series?.streets?.[selectedSegId] || !series?.t_min) return null
    const depths = series.streets[selectedSegId]
    let maxD = 0
    let maxT = 0
    for (let i = 0; i < depths.length; i++) {
      if (depths[i] > maxD) {
        maxD = depths[i]
        maxT = series.t_min[i]
      }
    }
    return { depthCm: maxD, tMin: maxT }
  }, [series, selectedSegId])

  return (
    <section className={styles.section}>
      <div className="panel-heading">Why this area floods</div>

      {!selectedSegId ? (
        <div className={styles.hint}>Click any flooded street on the map to inspect its causal chain.</div>
      ) : explainError ? (
        <div className={styles.errBox}>{explainError}</div>
      ) : explainLoading && !explain ? (
        <div className={styles.loading}>Analyzing hydrodynamic factors&hellip;</div>
      ) : explain ? (
        <div className={styles.body}>
          <div className={styles.headRow}>
            <span className={styles.segName}>{explain.seg_name || explain.seg_id}</span>
            <SeverityBadge severity={explain.severity} depthCm={explain.depth_cm} />
          </div>

          {/* Explicit Distinction: Current Frame Depth vs Forecast Peak */}
          <div className={styles.depthContextRow}>
            <div className={styles.depthContextItem}>
              <span className={styles.depthContextLabel}>
                CURRENT FRAME (T+{explain.t_min != null ? Math.round(explain.t_min) : currentT}m)
              </span>
              <span className={`${styles.depthContextVal} ${explain.depth_cm > 0 ? styles.depthActive : styles.depthDry}`}>
                {explain.depth_cm > 0 ? `${fmt(explain.depth_cm, 1)} cm` : 'No street flooding (0.0 cm)'}
              </span>
            </div>
            {segPeak && (
              <div className={styles.depthContextItem}>
                <span className={styles.depthContextLabel}>FORECAST PEAK</span>
                <span className={styles.depthContextVal}>
                  {segPeak.depthCm > 0
                    ? `${fmt(segPeak.depthCm, 1)} cm @ T+${Math.round(segPeak.tMin)}m`
                    : 'Remains dry over 3h'}
                </span>
              </div>
            )}
          </div>

          {/* Primary Human Explanation */}
          <div className={styles.explanationBox}>
            <div className={styles.explanationTitle}>Attributed Factor</div>
            <p className={styles.sentence}>{explainSentence(explain)}</p>
          </div>

          {/* Causal Chain */}
          <div className={styles.chainHeading}>Coupled Causal Flow (Physics Attribution)</div>
          <ol className={styles.chain}>
            {buildCausalChain(explain).map((step) => (
              <li key={step.id} className={`${styles.chainStep} ${step.active ? styles.chainStepActive : styles.chainStepInactive}`}>
                <div className={styles.chainHeaderLine}>
                  <span className={styles.chainPhase}>{step.phase}</span>
                  <span className={styles.chainLabel}>{step.label}</span>
                  {step.status === 'structural' && <span className={styles.chainStructural}>physics</span>}
                </div>
                <div className={styles.chainSublabel}>{step.sublabel}</div>
                <span className={styles.chainDetail}>{step.detail}</span>
              </li>
            ))}
          </ol>

          {/* Progressive Disclosure: Technical Evidence */}
          <div className={styles.evidenceToggleRow}>
            <button
              type="button"
              className={styles.evidenceToggle}
              onClick={() => setShowEvidence((v) => !v)}
              aria-expanded={showEvidence}
            >
              <span>{showEvidence ? '▾ Hide hydrodynamic evidence' : '▸ Show hydrodynamic evidence'}</span>
            </button>
          </div>

          {showEvidence && (
            <div className={styles.evidenceTable}>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Precipitation Rate</span>
                <span className={styles.factValue}>{fmt(explain.rainfall_mm_h, 0)} mm/h</span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Ground Elevation (DEM)</span>
                <span className={styles.factValue}>
                  {explain.terrain_context?.ground_elevation_m != null
                    ? `${fmt(explain.terrain_context.ground_elevation_m, 2)} m MSL`
                    : 'N/A'}
                </span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Nearest Drain Node</span>
                <span className={styles.factValue}>
                  {explain.nearest_drainage_node?.id ?? 'N/A'}
                  {explain.nearest_drainage_node?.distance_m != null
                    ? ` (${fmt(explain.nearest_drainage_node.distance_m, 0)}m)`
                    : ''}
                </span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Hydraulic Surcharge</span>
                <span className={styles.factValue}>
                  {explain.nearest_drainage_node ? (explain.nearest_drainage_node.surcharging ? 'Active Surcharge' : 'Normal / Free Flow') : 'N/A'}
                  {explain.nearest_drainage_node?.utilization != null
                    ? ` · ${Math.round(explain.nearest_drainage_node.utilization * 100)}% load`
                    : ''}
                </span>
              </div>
            </div>
          )}

          {explainLoading && <div className={styles.refreshing}>Updating for timestep&hellip;</div>}
        </div>
      ) : (
        <div className={styles.hint}>No explanation available for this segment.</div>
      )}
    </section>
  )
}

