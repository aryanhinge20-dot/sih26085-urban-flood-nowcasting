import { useMemo } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import {
  ALERT_LABEL, ADVISORY_LABEL, CATEGORY_COLOR,
  computeAllAlerts, describeAlert, rankHotspots, recommendedActions,
} from '../../lib/alerts.js'
import { fmt } from '../../lib/format.js'
import styles from './AlertsPanel.module.css'

export default function AlertsPanel() {
  const { run, series, route, currentT, roads, selectSegment } = useFloodNet()

  const segNameById = useMemo(() => {
    const m = new Map()
    for (const f of roads?.features || []) {
      if (f.properties?.seg_id != null) m.set(String(f.properties.seg_id), f.properties.name || f.properties.seg_id)
    }
    return m
  }, [roads])

  const priorities = useMemo(() => rankHotspots(series, segNameById, 5), [series, segNameById])
  const subjectLabel = priorities[0]?.name

  const alerts = useMemo(() => {
    if (!run || !series) return []
    return computeAllAlerts({ series, route, currentT, subjectLabel })
  }, [run, series, route, currentT, subjectLabel])

  const handleAlertClick = (alert) => {
    if (alert.type === 'DEPTH' && priorities[0]) selectSegment(priorities[0].segId)
  }

  return (
    <section className={styles.section}>
      <div className="panel-heading">
        Alerts {alerts.length > 0 && <span className={styles.count}>{alerts.length}</span>}
      </div>

      {!run ? (
        <div className={styles.empty}>Run a forecast to generate alerts.</div>
      ) : alerts.length === 0 ? (
        <div className={styles.empty}>No thresholds crossed in this forecast — conditions stay within FloodNet's WATCH/ADVISORY range throughout.</div>
      ) : (
        <ul className={styles.list}>
          {alerts.map((a) => (
            <li key={a.id} className={styles.alert} onClick={() => handleAlertClick(a)}>
              <div className={styles.alertHead}>
                <span className={styles.icon}>{a.icon}</span>
                <span className={styles.tierTag} style={{ background: `${a.color}26`, color: a.color, border: `1px solid ${a.color}66` }}>
                  {a.title}
                </span>
                <span className={`${styles.stateTag} ${a.state === 'ACTIVE' ? styles.stateTag_ACTIVE : ''}`}>{a.state}</span>
              </div>
              <div className={styles.body}>{describeAlert(a)}</div>
              {(a.tier === 'CRITICAL' || a.tier === 'SEVERE') && recommendedActions(a).length > 0 && (
                <div className={styles.actions}>
                  Recommended operator actions:
                  <br />
                  {recommendedActions(a).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {run && priorities.length > 0 && (
        <>
          <div className={`panel-heading ${styles.priorityHeading}`}>Top flood priorities</div>
          <ul className={styles.priorityList}>
            {priorities.map((p, i) => (
              <li key={p.segId} className={styles.priorityRow} onClick={() => selectSegment(p.segId)}>
                <span className={styles.priorityRank}>#{i + 1}</span>
                <span className={styles.priorityName}>{p.name}</span>
                <span className={styles.priorityCat} style={{ background: `${CATEGORY_COLOR[p.category]}26`, color: CATEGORY_COLOR[p.category] }}>
                  {p.category}
                </span>
                <span className={styles.priorityMeta}>
                  {fmt(p.peakDepthCm, 0)} cm &middot; +{fmt(p.peakTMin, 0)} min
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {run && <div className={styles.disclaimer}>{ALERT_LABEL} — {ADVISORY_LABEL}</div>}
    </section>
  )
}
