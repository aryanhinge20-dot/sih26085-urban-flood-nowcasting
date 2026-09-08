import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { SIMULATE_STAGES } from '../../state/FloodNetContext.jsx'
import styles from './LoadingOverlay.module.css'

/** Phase 6: a synchronous ~60-100s /api/simulate call has no incremental-progress signal, so this shows
 * WHICH real engine stage (backend/floodnet/simulation/engine.py's actual coupling loop) is running,
 * cycling on a timer -- never a fabricated completion percentage. */
export default function LoadingOverlay() {
  const { simulating, simStageIdx } = useFloodNet()
  if (!simulating) return null
  return (
    <div className={styles.overlay}>
      <div className={`${styles.card} glass-panel`}>
        <div className={styles.spinner} />
        <div className={styles.title}>GENERATING FLOOD FORECAST</div>
        <div className={styles.sub}>Running the coupled rainfall &rarr; runoff &rarr; drainage &rarr; street-depth model over the 0&ndash;180 min window</div>
        <div className={styles.stageList}>
          {SIMULATE_STAGES.map((label, i) => {
            const cls = i === simStageIdx ? styles.stageActive : i < simStageIdx ? styles.stageDone : ''
            return (
              <div key={label} className={`${styles.stage} ${cls}`}>
                <span className={styles.dot} />
                {label}
              </div>
            )
          })}
        </div>
        <div className={styles.note}>
          A full 3-hour simulation on the real Mumbai pilot network typically takes about a minute. Stages above
          reflect the engine's actual computation order, not a measured percentage.
        </div>
      </div>
    </div>
  )
}
