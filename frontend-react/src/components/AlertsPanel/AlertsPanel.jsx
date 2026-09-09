import { useMemo } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import {
  ALERT_LABEL, ADVISORY_LABEL, CATEGORY_COLOR,
  computeAllAlerts, describeAlert, rankHotspots, recommendedActions,
} from '../../lib/alerts.js'
import { fmt } from '../../lib/format.js'
import styles from './AlertsPanel.module.css'

export default function AlertsPanel() {
  const { run, series, route, currentT, roads, selectSegment, currentScenario } = useFloodNet()

  const segNameById = useMemo(() => {
    const m = new Map()
    for (const f of roads?.features || []) {
      if (f.properties?.seg_id != null) m.set(String(f.properties.seg_id), f.properties.name || f.properties.seg_id)
    }
    return m
  }, [roads])

  const priorities = useMemo(() => rankHotspots(series, segNameById, 5), [series, segNameById])
  const subjectLabel = priorities[0]?.name

  const rawAlerts = useMemo(() => {
    if (!run || !series) return []
    return computeAllAlerts({ series, route, currentT, subjectLabel })
  }, [run, series, route, currentT, subjectLabel])

  // Deduplicate depth alerts: If CRITICAL depth alert exists, keep the escalated CRITICAL alert
  // rather than showing two separate stacked cards for the same event.
  const alerts = useMemo(() => {
    const hasCriticalDepth = rawAlerts.some((a) => a.id === 'depth-critical')
    return rawAlerts.filter((a) => {
      if (a.id === 'depth-severe' && hasCriticalDepth) return false
      return true
    })
  }, [rawAlerts])

  const isHistorical = currentScenario?.source === 'historical' || run?.scenario_id === 'july2005'

  const getStateTag = (state) => {
    if (state === 'ACTIVE') return 'ACTIVE'
    if (state === 'RESOLVED') return 'RESOLVED'
    return isHistorical ? 'REPLAY EVENT' : 'FORECAST EVENT'
  }

  const handleAlertClick = (alert) => {
    if (alert.type === 'DEPTH' && priorities[0]) selectSegment(priorities[0].segId)
  }

  return (
    <section className={styles.section}>
      <div className="panel-heading">
        Incident Advisories {alerts.length > 0 && <span className={styles.count}>({alerts.length})</span>}
      </div>

      {!run ? (
        <div className={styles.empty}>Run a forecast to generate incident advisories.</div>
      ) : alerts.length === 0 ? (
        <div className={styles.empty}>No critical thresholds crossed — conditions remain within manageable levels.</div>
      ) : (
        <ul className={styles.list}>
          {alerts.map((a) => {
            const stateLabel = getStateTag(a.state)
            const isActive = a.state === 'ACTIVE'
            return (
              <li
                key={a.id}
                className={styles.alert}
                style={{ borderLeftColor: a.color || 'var(--border)' }}
                onClick={() => handleAlertClick(a)}
              >
                <div className={styles.alertHead}>
                  <span className={styles.icon}>{a.icon}</span>
                  <span
                    className={styles.tierTag}
                    style={{ background: `${a.color}22`, color: a.color, border: `1px solid ${a.color}55` }}
                  >
                    {a.title}
                  </span>
                  <span className={`${styles.stateTag} ${isActive ? styles.stateTag_ACTIVE : ''}`}>
                    {isActive && <span className={styles.activeDot} />}
                    {stateLabel}
                  </span>
                </div>
                <div className={styles.body}>{describeAlert(a)}</div>
                {(a.tier === 'CRITICAL' || a.tier === 'SEVERE') && recommendedActions(a).length > 0 && (
                  <div className={styles.actions}>
                    <div className={styles.actionsHeader}>Recommended operator actions:</div>
                    {recommendedActions(a).map((line) => (
                      <div key={line} className={styles.actionLine}>• {line}</div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
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
                <span className={styles.priorityCat} style={{ background: `${CATEGORY_COLOR[p.category]}22`, color: CATEGORY_COLOR[p.category] }}>
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
