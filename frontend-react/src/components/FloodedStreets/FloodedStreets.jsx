import { useFloodNet } from '../../state/FloodNetContext.jsx'
import SeverityBadge from '../SeverityBadge/SeverityBadge.jsx'
import styles from './FloodedStreets.module.css'

const TOP_N = 8

export default function FloodedStreets() {
  const { run, frame, selectedSegId, selectSegment } = useFloodNet()

  const features = frame?.streets?.features || []
  const flooded = features
    .filter((f) => (f.properties?.depth_cm ?? 0) > 0)
    .sort((a, b) => (b.properties?.depth_cm ?? 0) - (a.properties?.depth_cm ?? 0))
  const ranked = flooded.slice(0, TOP_N)

  const hasData = Boolean(run && frame)

  return (
    <section className={styles.section}>
      <div className="panel-heading">Top flooded streets</div>

      {!hasData ? (
        <div className={styles.empty}>Run a forecast to see street-level flooding.</div>
      ) : ranked.length === 0 ? (
        <div className={styles.empty}>No street flooding at this timestep.</div>
      ) : (
        <ul className={styles.list}>
          {ranked.map((f) => {
            const p = f.properties || {}
            const isSelected = String(p.seg_id) === String(selectedSegId)
            return (
              <li key={p.seg_id}>
                <button
                  type="button"
                  className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                  onClick={() => selectSegment(p.seg_id)}
                >
                  <span className={styles.name}>{p.name || p.seg_id}</span>
                  <SeverityBadge severity={p.severity} depthCm={p.depth_cm} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
