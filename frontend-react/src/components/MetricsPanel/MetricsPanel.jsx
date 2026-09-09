import { useMemo } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmt, fmtInt, fmtMinutes } from '../../lib/format.js'
import { DEFAULT_BANDS_CM, severityColor, severityOf } from '../../lib/severity.js'
import styles from './MetricsPanel.module.css'

// "Flooded" for the KPI tile below means "at/above the 'minor' band" -- read the actual cm threshold out of
// the shared bands table so this can never drift from lib/severity.js / backend severity_bands_cm.
const FLOODED_THRESHOLD_CM = DEFAULT_BANDS_CM.find(([, label]) => label === 'minor')?.[0] ?? DEFAULT_BANDS_CM[0][0]

export default function MetricsPanel() {
  const { run, frame, series, currentT } = useFloodNet()

  const hasData = Boolean(run && frame)

  const streetFeatures = frame?.streets?.features || []
  const streetDepths = streetFeatures.map((f) => f.properties?.depth_cm).filter((d) => d != null)
  const maxDepthCm = streetDepths.length ? Math.max(...streetDepths) : frame?.depth_grid?.max_depth_cm ?? null
  const depthSeverity = maxDepthCm != null ? severityOf(maxDepthCm) : null

  const surchargingNodes = (frame?.nodes || []).filter((n) => n.surcharging).length
  const floodedSegments = streetFeatures.filter((f) => (f.properties?.depth_cm ?? 0) >= FLOODED_THRESHOLD_CM).length

  // Trend comparisons against the previous simulated frame in `series` (purely presentational comparison)
  const trends = useMemo(() => {
    if (!series?.t_min?.length) return null

    const ts = series.t_min
    // Find current index
    let idxNow = 0
    let minDiff = Infinity
    for (let i = 0; i < ts.length; i++) {
      const diff = Math.abs(ts[i] - currentT)
      if (diff < minDiff) {
        minDiff = diff
        idxNow = i
      }
    }

    // Find peak over whole run
    let peakDepth = 0
    let peakDepthT = 0
    if (series.max_depth_cm?.length) {
      for (let i = 0; i < series.max_depth_cm.length; i++) {
        if (series.max_depth_cm[i] > peakDepth) {
          peakDepth = series.max_depth_cm[i]
          peakDepthT = ts[i]
        }
      }
    }

    if (idxNow === 0) {
      return {
        peakDepth,
        peakDepthT,
        depthTrend: 'T+0 baseline',
        rainTrend: 'T+0 baseline',
        nodeTrend: 'T+0 baseline',
        segTrend: 'T+0 baseline',
      }
    }

    const idxPrev = idxNow - 1
    const dtMin = ts[idxNow] - ts[idxPrev]

    const dDepth = (series.max_depth_cm?.[idxNow] ?? 0) - (series.max_depth_cm?.[idxPrev] ?? 0)
    const dRain = (series.rain_mm_h?.[idxNow] ?? 0) - (series.rain_mm_h?.[idxPrev] ?? 0)
    const dNodes = (series.surcharging_count?.[idxNow] ?? 0) - (series.surcharging_count?.[idxPrev] ?? 0)
    const dSegs = (series.flooded_segments?.[idxNow] ?? 0) - (series.flooded_segments?.[idxPrev] ?? 0)

    const fmtDiff = (diff, unit = '') => {
      if (Math.abs(diff) < 0.1) return `→ Stable vs ${dtMin}m ago`
      const sign = diff > 0 ? '↑ +' : '↓ '
      return `${sign}${Math.round(diff)}${unit ? ' ' + unit : ''} vs ${dtMin}m ago`
    }

    return {
      peakDepth,
      peakDepthT,
      depthTrend: fmtDiff(dDepth, 'cm'),
      rainTrend: fmtDiff(dRain, 'mm/h'),
      nodeTrend: fmtDiff(dNodes),
      segTrend: fmtDiff(dSegs),
    }
  }, [series, currentT])

  const tiles = [
    {
      key: 'rain',
      label: 'Rainfall intensity',
      value: fmt(frame?.rain_mm_h, 0),
      unit: 'mm/h',
      trend: trends?.rainTrend,
    },
    {
      key: 'depth',
      label: 'Max flood depth',
      value: maxDepthCm != null ? fmt(maxDepthCm, 0) : '–',
      unit: 'cm',
      color: depthSeverity ? severityColor(depthSeverity) : undefined,
      trend: trends?.depthTrend,
      subnote: trends?.peakDepth ? `Peak: ${Math.round(trends.peakDepth)} cm at T+${trends.peakDepthT}m` : null,
    },
    {
      key: 'nodes',
      label: 'Surcharging drains',
      value: fmtInt(surchargingNodes),
      unit: 'nodes',
      trend: trends?.nodeTrend,
    },
    {
      key: 'segs',
      label: 'Flooded streets',
      value: fmtInt(floodedSegments),
      unit: 'streets',
      trend: trends?.segTrend,
    },
  ]

  return (
    <section className={styles.section}>
      <div className="panel-heading">
        Flood metrics
        {hasData && <span className={styles.tMin}>t = {fmtMinutes(frame.t_min)}</span>}
      </div>

      {!hasData ? (
        <div className={styles.empty}>Run a forecast to view flood conditions.</div>
      ) : (
        <div className={styles.grid}>
          {tiles.map((t) => (
            <div className={styles.tile} key={t.key}>
              <div className={styles.tileLabel}>{t.label}</div>
              <div className={styles.tileValue} style={t.color ? { color: t.color } : undefined}>
                {t.value}
                {t.unit && <span className={styles.tileUnit}> {t.unit}</span>}
              </div>
              {t.trend && <div className={styles.tileTrend}>{t.trend}</div>}
              {t.subnote && <div className={styles.tileSubnote}>{t.subnote}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
