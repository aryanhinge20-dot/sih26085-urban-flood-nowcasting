import { useCallback, useMemo } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmtMinutes } from '../../lib/format.js'
import styles from './ForecastTimeline.module.css'

const W = 1000
const H = 70

const TICKS = [0, 30, 60, 90, 120, 150, 180]

export default function ForecastTimeline() {
  const { run, currentScenario, series, compareResult, currentT, setCurrentT, playing, setPlaying } = useFloodNet()

  const ts = run?.frames_t_min || []
  const tMin = ts.length ? ts[0] : 0
  const tMax = ts.length ? ts[ts.length - 1] : 180
  const step = ts.length > 1 ? ts[1] - ts[0] : 5

  const x = useCallback((t) => ((t - tMin) / Math.max(1, tMax - tMin)) * W, [tMin, tMax])
  const cursorX = x(currentT)

  const rainPath = useMemo(() => {
    const sc = currentScenario
    if (!sc?.t_min?.length) return { bars: [], imax: 0 }
    const imax = Math.max(1, ...sc.intensity_mm_h)
    const n = sc.t_min.length
    const bw = Math.max(1, W / n - 1.5)
    const bars = sc.t_min.map((t, i) => ({
      x: ((t - tMin) / Math.max(1, tMax - tMin)) * W,
      w: bw,
      h: (sc.intensity_mm_h[i] / imax) * (H * 0.45),
    }))
    return { bars, imax, total: sc.total_mm }
  }, [currentScenario, tMin, tMax])

  const metricLabel = compareResult ? 'flooded segments' : 'max flood depth (cm)'
  const depthLines = useMemo(() => {
    const lines = []
    if (compareResult) {
      const t = compareResult.t_min || compareResult.frames_t_min
      lines.push({ t, y: compareResult.normal.flooded_segments, color: '#00d4ff', label: 'normal' })
      lines.push({ t, y: compareResult.blocked.flooded_segments, color: '#ff3366', label: 'blocked' })
    } else if (series) {
      lines.push({ t: series.t_min, y: series.max_depth_cm, color: '#00d4ff', label: 'max depth' })
    }
    return lines
  }, [series, compareResult])

  const ymax = Math.max(5, ...depthLines.flatMap((l) => l.y || []))
  const toPath = (l) =>
    (l.y || [])
      .map((v, i) => `${i ? 'L' : 'M'}${x(l.t[i])},${H - 4 - (v / ymax) * (H - 14)}`)
      .join(' ')

  const toAreaPath = (l) => {
    const pts = (l.y || []).map((v, i) => `${i ? 'L' : 'M'}${x(l.t[i])},${H - 4 - (v / ymax) * (H - 14)}`)
    if (!pts.length) return ''
    return `${pts.join(' ')} L${x(l.t[l.t.length - 1])},${H} L${x(l.t[0])},${H} Z`
  }

  const handlePlay = () => {
    if (!run) return
    setPlaying(!playing)
  }

  return (
    <div className={`${styles.bar} glass-panel`}>
      <button
        className={`btn btn-primary ${styles.playBtn}`}
        onClick={handlePlay}
        disabled={!run}
        title={playing ? 'Pause forecast playback' : 'Play forecast evolution'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div className={styles.body}>
        <div className={styles.topRow}>
          <span className={styles.titleText}>
            0&ndash;180 min forecast timeline
            {run && (
              <span className={styles.metricLegend}>
                {' '}
                &middot; {metricLabel}
                {compareResult && (
                  <>
                    {' '}
                    (<span style={{ color: '#00d4ff' }}>&#9679; normal</span> vs{' '}
                    <span style={{ color: '#ff3366' }}>&#9679; blocked</span>)
                  </>
                )}
              </span>
            )}
          </span>
          {rainPath.total != null && (
            <span className={styles.rainSummary}>
              Rain total: {Math.round(rainPath.total)} mm &middot; Peak: {Math.round(rainPath.imax)} mm/h
            </span>
          )}
        </div>

        <div className={styles.chartWrap}>
          {run ? (
            <>
              <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="depthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#00d4ff" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Rain bars (hyetograph) */}
                {rainPath.bars.map((b, i) => (
                  <rect
                    key={i}
                    x={b.x}
                    y={H * 0.45 - b.h}
                    width={b.w}
                    height={b.h}
                    fill="#00d4ff"
                    opacity="0.4"
                    rx="1"
                  />
                ))}

                {/* Flood depth area fill & hydrograph line */}
                {depthLines.map((l) => (
                  <g key={l.label}>
                    {!compareResult && (
                      <path d={toAreaPath(l)} fill="url(#depthGrad)" />
                    )}
                    <path d={toPath(l)} fill="none" stroke={l.color} strokeWidth="2.2" strokeLinecap="round" />
                  </g>
                ))}

                {/* Time cursor */}
                <line x1={cursorX} x2={cursorX} y1="0" y2={H} stroke="#ffffff" strokeWidth="2" opacity="0.9" />
                <circle cx={cursorX} cy="3" r="3.5" fill="#ffffff" />
              </svg>
              <div className={styles.futureShade} style={{ width: `${100 - (cursorX / W) * 100}%` }} />
            </>
          ) : (
            <div className={styles.empty}>Execute a forecast scenario to view the 0&ndash;180 min timeline</div>
          )}
        </div>

        {/* Time slider */}
        <input
          className={styles.slider}
          type="range"
          min={tMin}
          max={tMax}
          step={step || 5}
          value={currentT}
          disabled={!run}
          onChange={(e) => setCurrentT(Number(e.target.value))}
          aria-label="Forecast timestep slider"
        />

        {/* Timeline tick labels */}
        <div className={styles.ticksRow}>
          {TICKS.map((t) => (
            <span
              key={t}
              className={`${styles.tick} ${Math.abs(t - currentT) < 15 ? styles.tickActive : ''}`}
            >
              +{t}m
            </span>
          ))}
        </div>
      </div>

      <div className={styles.clock}>
        <div className={styles.clockValue}>{run ? fmtMinutes(currentT) : '—'}</div>
        <div className={styles.clockUnit}>{currentT <= 0 ? 'T+0 (Initial)' : 'Simulated Time'}</div>
      </div>
    </div>
  )
}
