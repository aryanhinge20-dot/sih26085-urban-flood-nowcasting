import { useMemo } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { fmtMinutes } from '../../lib/format.js'
import styles from './ForecastTimeline.module.css'

const W = 1000
const H = 100

export default function ForecastTimeline() {
  const { run, currentScenario, series, compareResult, currentT, setCurrentT, playing, setPlaying } = useFloodNet()

  const ts = run?.frames_t_min || []
  const tMin = ts.length ? ts[0] : 0
  const tMax = ts.length ? ts[ts.length - 1] : 180
  const step = ts.length > 1 ? ts[1] - ts[0] : 5

  const x = (t) => ((t - tMin) / Math.max(1, tMax - tMin)) * W
  const cursorX = x(currentT)

  const rainPath = useMemo(() => {
    const sc = currentScenario
    if (!sc?.t_min?.length) return { bars: [], imax: 0 }
    const imax = Math.max(1, ...sc.intensity_mm_h)
    const n = sc.t_min.length
    const bw = Math.max(0.6, W / n - 1)
    const bars = sc.t_min.map((t, i) => ({
      x: x(t),
      w: bw,
      h: (sc.intensity_mm_h[i] / imax) * (H * 0.42),
    }))
    return { bars, imax, total: sc.total_mm }
  }, [currentScenario, tMin, tMax])

  // Compare mode plots flooded-segment count, not max depth: the pilot's extreme depth is dominated by a
  // handful of geometry-limited cells that saturate almost identically whether drains are blocked or not
  // (confirmed against the live backend: normal vs 50%-blocked max depth differs by ~0.01 cm at t=180 on
  // the `heavy` scenario) -- plotting max depth here would look like nothing happened. Flooded-segment
  // count is the metric that actually, visibly separates the two runs (see docs/VALIDATION.md /
  // scripts/demo_check.py, which uses the same metric for its blocked-vs-normal check).
  const metricLabel = compareResult ? 'flooded segments' : 'max depth (cm)'
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
      .map((v, i) => `${i ? 'L' : 'M'}${x(l.t[i])},${H - 4 - (v / ymax) * (H - 16)}`)
      .join(' ')

  const handlePlay = () => {
    if (!run) return
    setPlaying(!playing)
  }

  return (
    <div className={`${styles.bar} glass-panel`}>
      <button className={`btn btn-primary ${styles.playBtn}`} onClick={handlePlay} disabled={!run} title="Play / pause forecast playback">
        {playing ? '❚❚' : '▶'}
      </button>

      <div className={styles.body}>
        <div className={styles.topRow}>
          <span>
            0&ndash;180 min forecast
            {run && (
              <span className={styles.metricLegend}>
                {' '}
                &middot; {metricLabel}
                {compareResult && (
                  <>
                    {' '}
                    (<span style={{ color: '#00d4ff' }}>&#9679; normal</span> vs <span style={{ color: '#ff3366' }}>&#9679; blocked</span>)
                  </>
                )}
              </span>
            )}
          </span>
          {rainPath.total != null && <b>rain total {Math.round(rainPath.total)} mm &middot; peak {Math.round(rainPath.imax)} mm/h</b>}
        </div>
        <div className={styles.chartWrap}>
          {run ? (
            <>
              <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                {rainPath.bars.map((b, i) => (
                  <rect key={i} x={b.x} y={H * 0.46 - b.h} width={b.w} height={b.h} fill="#00d4ff" opacity="0.55" />
                ))}
                {depthLines.map((l) => (
                  <path key={l.label} d={toPath(l)} fill="none" stroke={l.color} strokeWidth="2.5" />
                ))}
                <line x1={cursorX} x2={cursorX} y1="0" y2={H} stroke="#ffffff" strokeWidth="2" opacity="0.85" />
                <circle cx={cursorX} cy="4" r="4" fill="#ffffff" />
              </svg>
              <div className={styles.futureShade} style={{ width: `${100 - (cursorX / W) * 100}%` }} />
            </>
          ) : (
            <div className={styles.empty}>Run a forecast to see the 0&ndash;180 min timeline</div>
          )}
        </div>
        <input
          className={styles.slider}
          type="range"
          min={tMin}
          max={tMax}
          step={step || 5}
          value={currentT}
          disabled={!run}
          onChange={(e) => setCurrentT(Number(e.target.value))}
        />
      </div>

      <div className={styles.clock}>
        <div className={styles.clockValue}>{run ? fmtMinutes(currentT) : '—'}</div>
        <div className={styles.clockUnit}>{currentT <= 0 ? 'now' : 'into forecast'}</div>
      </div>
    </div>
  )
}
