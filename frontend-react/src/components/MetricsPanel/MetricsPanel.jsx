import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmt, fmtInt, fmtMinutes } from '../../lib/format.js'
import { DEFAULT_BANDS_CM, severityColor, severityOf } from '../../lib/severity.js'
import styles from './MetricsPanel.module.css'

// "Flooded" for the KPI tile below means "at/above the 'minor' band" -- read the actual cm threshold out of
// the shared bands table (never hardcode 15) so this can never drift from lib/severity.js / the backend's
// severity_bands_cm.
const FLOODED_THRESHOLD_CM = DEFAULT_BANDS_CM.find(([, label]) => label === 'minor')?.[0] ?? DEFAULT_BANDS_CM[0][0]

export default function MetricsPanel() {
  const { run, frame } = useFloodNet()

  const hasData = Boolean(run && frame)

  const streetFeatures = frame?.streets?.features || []
  const streetDepths = streetFeatures.map((f) => f.properties?.depth_cm).filter((d) => d != null)
  const maxDepthCm = streetDepths.length ? Math.max(...streetDepths) : frame?.depth_grid?.max_depth_cm ?? null
  const depthSeverity = maxDepthCm != null ? severityOf(maxDepthCm) : null

  const surchargingNodes = (frame?.nodes || []).filter((n) => n.surcharging).length
  const floodedSegments = streetFeatures.filter((f) => (f.properties?.depth_cm ?? 0) >= FLOODED_THRESHOLD_CM).length

  const tiles = [
    { key: 'rain', label: 'Rainfall', value: fmt(frame?.rain_mm_h, 0), unit: 'mm/h' },
    {
      key: 'depth',
      label: 'Max flood depth',
      value: maxDepthCm != null ? fmt(maxDepthCm, 0) : '–',
      unit: 'cm',
      color: depthSeverity ? severityColor(depthSeverity) : undefined,
    },
    { key: 'nodes', label: 'Surcharging nodes', value: fmtInt(surchargingNodes), unit: '' },
    { key: 'segs', label: 'Flooded segments', value: fmtInt(floodedSegments), unit: '' },
  ]

  return (
    <section className={styles.section}>
      <div className="panel-heading">
        Current conditions
        {hasData && <span className={styles.tMin}>t = {fmtMinutes(frame.t_min)}</span>}
      </div>

      {!hasData ? (
        <div className={styles.empty}>Run a forecast to see live conditions.</div>
      ) : (
        <div className={styles.grid}>
          {tiles.map((t) => (
            <div className={styles.tile} key={t.key}>
              <div className={styles.tileLabel}>{t.label}</div>
              <div className={styles.tileValue} style={t.color ? { color: t.color } : undefined}>
                {t.value}
                {t.unit && <span className={styles.tileUnit}> {t.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
