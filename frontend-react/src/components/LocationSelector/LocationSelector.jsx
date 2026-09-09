import { useState, useRef, useEffect } from 'react'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import styles from './LocationSelector.module.css'

const PILOT_AREAS = [
  {
    id: 'hindmata',
    name: 'Hindmata Junction',
    zone: 'MCGM F/North Ward',
    status: 'ACTIVE PILOT',
    desc: 'Low-elevation natural bowl with high historical flood frequency.',
    coords: [72.8447, 19.0176],
  },
  {
    id: 'dadar-tt',
    name: 'Dadar TT Circle',
    zone: 'MCGM F/North Ward',
    status: 'ACTIVE PILOT',
    desc: 'Major transit corridor connecting Dr. B.A. Road and Tilak Bridge.',
    coords: [72.8465, 19.0205],
  },
  {
    id: 'parel-tt',
    name: 'Parel Junction',
    zone: 'MCGM F/South Ward (Adjacent)',
    status: 'IN PILOT BOUNDS',
    desc: 'Hospital district connector and railway underpass zone.',
    coords: [72.8415, 19.0085],
  },
  {
    id: 'matunga',
    name: 'Matunga East (King Circle)',
    zone: 'MCGM F/North Ward',
    status: 'ACTIVE PILOT',
    desc: 'Downstream receiving basin and chronic waterlogging hotspot.',
    coords: [72.8550, 19.0290],
  },
]

export default function LocationSelector() {
  const { meta, pickPoint } = useFloodNet()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('hindmata')
  const popoverRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const filtered = PILOT_AREAS.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()) ||
    a.zone.toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = (area) => {
    setSelectedId(area.id)
    setOpen(false)
    // If user selects a landmark, set point for map context if supported
    if (area.coords && pickPoint) {
      // Pick landmark coordinate
    }
  }

  const currentArea = PILOT_AREAS.find((a) => a.id === selectedId) || PILOT_AREAS[0]

  return (
    <div className={styles.wrapper} ref={popoverRef}>
      <button
        className={`${styles.triggerBtn} ${open ? styles.triggerBtnOpen : ''}`}
        onClick={() => setOpen(!open)}
        title="Select operational area or landmark"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={styles.pinIcon}>📍</span>
        <div className={styles.triggerText}>
          <div className={styles.triggerCity}>Mumbai</div>
          <div className={styles.triggerArea}>{currentArea.name}</div>
        </div>
        <span className={styles.chevron}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Select catchment area">
          <div className={styles.popoverHead}>
            <div className={styles.popoverTitle}>Operational Area Selection</div>
            <div className={styles.searchWrap}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search Mumbai pilot landmarks..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className={styles.areaList}>
            <div className={styles.listLabel}>Pilot Catchment Areas (MCGM F/North)</div>
            {filtered.map((area) => (
              <button
                key={area.id}
                className={`${styles.areaItem} ${area.id === selectedId ? styles.areaItemActive : ''}`}
                onClick={() => handleSelect(area)}
              >
                <div className={styles.areaItemHead}>
                  <span className={styles.areaName}>{area.name}</span>
                  <span className={styles.areaStatus}>{area.status}</span>
                </div>
                <div className={styles.areaZone}>{area.zone}</div>
                <div className={styles.areaDesc}>{area.desc}</div>
              </button>
            ))}
          </div>

          <div className={styles.popoverFooter}>
            <div className={styles.coverageNote}>
              <b>Active Model Coverage:</b> High-resolution 2D coupled physics currently calibrated for Hindmata–Dadar catchment ({meta?.pilot?.name || 'Mumbai F/North'}).
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
