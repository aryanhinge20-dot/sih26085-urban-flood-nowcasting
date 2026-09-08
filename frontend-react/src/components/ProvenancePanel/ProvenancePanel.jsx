import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { provenanceTag } from '../../lib/format.js'
import styles from './ProvenancePanel.module.css'

// Keys at the top of /api/provenance that are NOT nested tag/source/note groups -- skip them while walking,
// they're rendered separately below (attribution) or aren't provenance data at all (data_mode).
const SKIP_KEYS = new Set(['data_mode', 'attribution'])

/** Recursively flattens the /api/provenance tree into {label, tag, source, note} rows. A node is a "leaf"
 * once it has a `tag` key; anything else is a namespace to recurse into, building a dotted breadcrumb label
 * (e.g. "network.roughness") so nested per-field provenance (the drainage network in particular) is never
 * collapsed away or hidden -- this is the app's one scientific-honesty surface. */
function flattenProvenance(node, prefix = '') {
  if (!node || typeof node !== 'object') return []
  if ('tag' in node) {
    return [{ label: prefix || '(root)', tag: node.tag, source: node.source, note: node.note }]
  }
  const rows = []
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue
    rows.push(...flattenProvenance(value, prefix ? `${prefix}.${key}` : key))
  }
  return rows
}

export default function ProvenancePanel() {
  const { provenance, status } = useFloodNet()

  const rows = provenance ? flattenProvenance(provenance) : []
  const providers = status?.rainfall_providers || []

  return (
    <section className={styles.section}>
      <details className={styles.details} open>
        <summary className={styles.summary}>
          <span>Data sources &amp; provenance</span>
          <span className={styles.chevron} aria-hidden="true">
            ▾
          </span>
        </summary>

        <div className={styles.body}>
          {!provenance ? (
            <div className={styles.empty}>Provenance not loaded yet.</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>No provenance entries reported.</div>
          ) : (
            <table className={styles.table}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className={styles.labelCell}>
                      <div className={styles.labelText}>{r.label}</div>
                      <span className={`tag-badge tag-${provenanceTag(r)}`}>{provenanceTag(r)}</span>
                    </td>
                    <td className={styles.sourceCell}>
                      <div>{r.source || '—'}</div>
                      {r.note && <div className={styles.note}>{r.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {providers.length > 0 && (
            <div className={styles.providers}>
              <div className={styles.groupLabel}>Rainfall providers</div>
              <ul className={styles.providerList}>
                {providers.map((p) => (
                  <li key={p.id} className={styles.providerRow}>
                    <span className={styles.providerId}>{p.id}</span>
                    <span className={styles.providerMeta}>
                      {p.source_type}
                      {p.timestamp ? ` · ${p.timestamp}` : ''}
                      {p.resolution_min != null ? ` · ${p.resolution_min} min` : ''}
                    </span>
                    <span className={`tag-badge tag-${provenanceTag(p.data_mode)}`}>{provenanceTag(p.data_mode)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(provenance?.attribution) && provenance.attribution.length > 0 && (
            <div className={styles.attribution}>{provenance.attribution.join(' · ')}</div>
          )}

          <div className={styles.footer}>
            Prototype for SIH26085. Simplified 2D storage-cell surface physics and a capacity-limited drainage
            solver; depths carry terrain and parameter uncertainty. Not an operational flood warning system.
          </div>
        </div>
      </details>
    </section>
  )
}
