import { useFloodNet } from '../../state/FloodNetContext.jsx'
import styles from './LayerControl.module.css'

const PRIMARY = [
  { key: 'streets', label: 'Street flooding', color: '#ff8c1a' },
  { key: 'depth', label: 'Flood depth grid', color: '#00d4ff' },
  { key: 'hotspots', label: 'Known flooding spots (MCGM)', color: '#ff8c1a' },
  { key: 'route', label: 'Route', color: '#22e6a3' },
]
const TECHNICAL = [
  { key: 'roads', label: 'Road network (OSM)', color: '#8a94a6' },
  { key: 'drainage', label: 'Drainage network (nodes + pipes)', color: '#3aa0ff' },
  { key: 'terrain', label: 'Terrain elevation (DEM)', color: '#c9a8ff' },
]

export default function LayerControl() {
  const { layers, toggleLayer } = useFloodNet()

  const Row = ({ item }) => (
    <label className={styles.row}>
      <input type="checkbox" checked={!!layers[item.key]} onChange={() => toggleLayer(item.key)} />
      <span className={styles.swatch} style={{ background: item.color }} />
      {item.label}
    </label>
  )

  return (
    <section className={styles.section}>
      <div className="panel-heading">Map layers</div>
      <div className={styles.group}>
        {PRIMARY.map((it) => (
          <Row item={it} key={it.key} />
        ))}
      </div>
      <div className={styles.groupLabel}>Technical / infrastructure</div>
      <div className={styles.group}>
        {TECHNICAL.map((it) => (
          <Row item={it} key={it.key} />
        ))}
      </div>
    </section>
  )
}
