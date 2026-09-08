import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmt } from '../../lib/format.js'
import SeverityBadge from '../SeverityBadge/SeverityBadge.jsx'
import styles from './WhyFloodedPanel.module.css'

// Mirrors the backend's `dominant_cause` enum (backend/floodnet/api/main.py's /explain endpoint) 1:1. Any
// value not in this table (including "unknown") falls back to the last entry -- never a blank or guessed
// sentence.
const CAUSE_SENTENCES = {
  drainage_overcapacity: 'The nearby drainage node is surcharging because inflow exceeds its hydraulic capacity.',
  drainage_blockage: 'The nearby drainage node is surcharging because an outgoing pipe is blocked.',
  drainage_downstream_backup:
    'The nearby drainage node is surcharging because downstream capacity is limiting outflow (backwater).',
  surface_ponding_only:
    'This street is wet from surface runoff, but the nearest drainage node is not currently surcharging -- ' +
    'water is pooling faster than it can reach or be captured by the drainage network.',
  unknown: 'No clear dominant cause could be attributed from the current simulation state.',
}

/** Builds a concise, human-readable causal sentence from a real /explain API response. The base clause is
 * looked up from `dominant_cause`; every number appended after it (rainfall, nearest node id/distance) is
 * read directly off the passed-in `explain` object for THIS segment/timestep -- nothing here is a fixed
 * string tied to one segment. Exported so it's independently reviewable/testable as a pure function. */
export function explainSentence(explain) {
  if (!explain) return ''
  const base = CAUSE_SENTENCES[explain.dominant_cause] || CAUSE_SENTENCES.unknown
  const node = explain.nearest_drainage_node
  const parts = []
  if (explain.rainfall_mm_h != null) parts.push(`rain ${fmt(explain.rainfall_mm_h, 0)} mm/h`)
  if (node?.id != null && node?.distance_m != null) {
    parts.push(`nearest node ${node.id}, ${node.distance_m.toFixed(0)} m away`)
  }
  return parts.length ? `${base} (${parts.join('; ')})` : base
}

export default function WhyFloodedPanel() {
  const { selectedSegId, explain, explainLoading, explainError } = useFloodNet()

  return (
    <section className={styles.section}>
      <div className="panel-heading">Why is this flooded?</div>

      {!selectedSegId ? (
        <div className={styles.hint}>Select a flooded street on the map or in the list above to see why it floods.</div>
      ) : explainError ? (
        <div className={styles.errBox}>{explainError}</div>
      ) : explainLoading && !explain ? (
        <div className={styles.loading}>Loading explanation&hellip;</div>
      ) : explain ? (
        <div className={styles.body}>
          <div className={styles.headRow}>
            <span className={styles.segName}>{explain.seg_name || explain.seg_id}</span>
            <SeverityBadge severity={explain.severity} depthCm={explain.depth_cm} />
          </div>

          <div className={styles.factRow}>
            <span className={styles.factLabel}>Rainfall</span>
            <span className={styles.factValue}>{fmt(explain.rainfall_mm_h, 0)} mm/h</span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.factLabel}>Ground elevation</span>
            <span className={styles.factValue}>
              {explain.terrain_context?.ground_elevation_m != null
                ? `${fmt(explain.terrain_context.ground_elevation_m, 2)} m`
                : 'not available'}
            </span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.factLabel}>Nearest drainage node</span>
            <span className={styles.factValue}>
              {explain.nearest_drainage_node?.id ?? 'not available'}
              {explain.nearest_drainage_node?.distance_m != null
                ? ` · ${fmt(explain.nearest_drainage_node.distance_m, 0)} m away`
                : ''}
            </span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.factLabel}>Node surcharging</span>
            <span className={styles.factValue}>
              {explain.nearest_drainage_node ? (explain.nearest_drainage_node.surcharging ? 'Yes' : 'No') : 'not available'}
              {explain.nearest_drainage_node?.utilization != null
                ? ` · ${Math.round(explain.nearest_drainage_node.utilization * 100)}% utilized`
                : ''}
            </span>
          </div>

          <p className={styles.sentence}>{explainSentence(explain)}</p>
          {explainLoading && <div className={styles.refreshing}>Refreshing&hellip;</div>}
        </div>
      ) : (
        <div className={styles.hint}>No explanation available for this segment yet.</div>
      )}
    </section>
  )
}
