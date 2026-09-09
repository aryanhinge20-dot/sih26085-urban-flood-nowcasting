import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { bboxToLatLngBounds, lonLatToLatLng } from '../../lib/format.js'
import { DEFAULT_BANDS_CM, SEVERITY_COLOR, SEVERITY_LABEL, severityColor, severityOf } from '../../lib/severity.js'
import styles from './MapView.module.css'

const PILOT_CENTER = [19.02, 72.845]

// Internal Leaflet layer groups. `drainage` (nodes+edges+surcharge together) is the single "Drainage
// Network" toggle from the product spec -- individual nodes/edges are never separately switchable, and are
// OFF by default (see FloodNetContext DEFAULT_LAYERS). Everything else maps 1:1 to a Context layer key.
const GROUP_KEYS = ['roads', 'drainageEdges', 'drainageNodes', 'drainageSurcharge', 'hotspots', 'terrain', 'depth', 'streets', 'route']
const VISIBILITY_FOR = (layers) => ({
  roads: layers.roads,
  drainageEdges: layers.drainage,
  drainageNodes: layers.drainage,
  drainageSurcharge: layers.drainage,
  hotspots: layers.hotspots,
  terrain: layers.terrain,
  depth: layers.depth,
  streets: layers.streets,
  route: layers.route,
})

export default function MapView() {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const groupsRef = useRef({})
  const svgRendererRef = useRef(null)
  const roadIndexRef = useRef(new Map())
  const edgeIndexRef = useRef(new Map()) // edge_id -> polyline (restyled per frame, never recreated)
  const segIndexRef = useRef(new Map()) // seg_id -> polyline (recreated per frame)
  const routeMarkersRef = useRef([])
  const boundsFittedRef = useRef(false)

  const {
    meta, roads, topology, hotspots, terrain,
    frame, selectedSegId, selectSegment,
    route, pickPoint,
    layers, terrainOpacity, depthOpacity,
  } = useFloodNet()

  // refs mirroring frequently-changing callbacks/values, so the one-time map-init effect's event
  // listeners always see the latest without needing to be re-bound (which would mean removing/re-adding
  // a click handler on the Leaflet map on every render -- wasteful and easy to get wrong). Updated in an
  // effect (runs after render, every render) rather than inline during the render body.
  const pickPointRef = useRef(pickPoint)
  const selectSegmentRef = useRef(selectSegment)
  const selectedSegIdRef = useRef(selectedSegId)
  useEffect(() => {
    pickPointRef.current = pickPoint
    selectSegmentRef.current = selectSegment
    selectedSegIdRef.current = selectedSegId
  })

  // ---------------------------------------------------------------- init (once)
  useEffect(() => {
    // No corner is free for Leaflet's default zoom control: header/left-panel/right-panel/timeline hug all
    // four edges (see App.module.css), and Leaflet's own control container is z-index 1000 (leaflet.css),
    // above every panel here (800-900) -- a corner control would visibly float on top of the timeline or
    // header. Scroll-to-zoom and drag-to-pan remain fully enabled without it.
    const map = L.map(elRef.current, { zoomControl: false, preferCanvas: true }).setView(PILOT_CENTER, 15)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    svgRendererRef.current = L.svg() // SVG renderer so the surcharge-pulse CSS animation works (default is canvas)

    const groups = Object.fromEntries(GROUP_KEYS.map((k) => [k, L.layerGroup().addTo(map)]))
    groupsRef.current = groups
    mapRef.current = map

    map.on('click', (e) => pickPointRef.current([e.latlng.lng, e.latlng.lat]))

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---------------------------------------------------------------- layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const vis = VISIBILITY_FOR(layers)
    for (const [key, on] of Object.entries(vis)) {
      const g = groupsRef.current[key]
      if (!g) continue
      const has = map.hasLayer(g)
      if (on && !has) g.addTo(map)
      if (!on && has) map.removeLayer(g)
    }
  }, [layers])

  // ---------------------------------------------------------------- pilot bbox + fit bounds (once)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !meta?.pilot?.bbox_lonlat || boundsFittedRef.current) return
    const bounds = bboxToLatLngBounds(meta.pilot.bbox_lonlat)
    map.fitBounds(bounds)
    L.rectangle(bounds, { color: '#00d4ff', weight: 1, dashArray: '4 5', fill: false, interactive: false }).addTo(map)
    if (Array.isArray(meta.attribution)) meta.attribution.forEach((a) => map.attributionControl.addAttribution(a))
    boundsFittedRef.current = true
  }, [meta])

  // ---------------------------------------------------------------- roads (static, subdued)
  useEffect(() => {
    const g = groupsRef.current.roads
    if (!g || !roads) return
    g.clearLayers()
    roadIndexRef.current.clear()
    for (const f of roads.features || []) {
      const pl = L.polyline((f.geometry.coordinates || []).map(lonLatToLatLng), {
        color: '#4b5568',
        weight: 1.1,
        opacity: 0.5,
        interactive: false,
      })
      roadIndexRef.current.set(f.properties.seg_id, pl)
      pl.addTo(g)
    }
  }, [roads])

  // ---------------------------------------------------------------- drainage network (static geometry, restyled per-frame)
  useEffect(() => {
    const edgesG = groupsRef.current.drainageEdges
    const nodesG = groupsRef.current.drainageNodes
    if (!edgesG || !nodesG || !topology) return
    edgesG.clearLayers()
    nodesG.clearLayers()
    edgeIndexRef.current.clear()
    const caps = (topology.edges || []).map((e) => e.capacity_m3s || 0)
    const cmax = Math.max(1e-6, ...caps)
    for (const e of topology.edges || []) {
      const w = 0.8 + 3 * Math.sqrt((e.capacity_m3s || 0) / cmax)
      const pl = L.polyline((e.geom || []).map(lonLatToLatLng), { color: '#3aa0ff', weight: w, opacity: 0.6 })
      pl.bindTooltip(
        `<b>Drain ${e.id}</b><br>${e.shape || ''} ${(e.width_m ?? 0).toFixed(2)}&times;${(e.height_m ?? 0).toFixed(2)} m` +
          `<br>capacity ${(e.capacity_m3s ?? 0).toFixed(2)} m&sup3;/s &middot; status ${e.status || ''}` +
          (e.blockage ? `<br>blockage ${Math.round(e.blockage * 100)}%` : ''),
      )
      edgeIndexRef.current.set(e.id, pl)
      pl.addTo(edgesG)
    }
    for (const n of topology.nodes || []) {
      const m = n.is_outfall
        ? L.rectangle([[n.lat - 3e-5, n.lon - 3e-5], [n.lat + 3e-5, n.lon + 3e-5]], { color: '#22e6a3', weight: 2, fillOpacity: 0.5 })
        : L.circleMarker([n.lat, n.lon], { radius: 2.2, color: '#7ec8ff', weight: 1, fillOpacity: 0.5 })
      m.bindTooltip(`<b>${n.is_outfall ? 'Outfall' : 'Node'} ${n.id}</b><br>ground ${(n.ground_m ?? 0).toFixed(2)} m &middot; invert ${(n.invert_m ?? 0).toFixed(2)} m`)
      m.addTo(nodesG)
    }
  }, [topology])

  // ---------------------------------------------------------------- hotspots (static)
  useEffect(() => {
    const g = groupsRef.current.hotspots
    if (!g || !hotspots) return
    g.clearLayers()
    for (const f of hotspots.features || []) {
      if (f.geometry?.type !== 'Point') continue
      const [lon, lat] = f.geometry.coordinates
      const p = f.properties || {}
      const active = p.active !== false
      const m = L.circleMarker([lat, lon], {
        radius: 7,
        color: '#ff8c1a',
        weight: 2,
        fillColor: '#ff8c1a',
        fillOpacity: active ? 0.75 : 0.12,
      })
      m.bindTooltip(
        `<b>${p.name || 'Flooding spot'}</b><br>ward ${p.ward || ''} &middot; ${p.affect_road || ''}` +
          `<br>${p.depth_attr || ''}${active ? '' : '<br><i>inactive</i>'}`,
      )
      m.addTo(g)
    }
  }, [hotspots])

  // ---------------------------------------------------------------- terrain DEM overlay (static)
  const terrainOverlayRef = useRef(null)
  useEffect(() => {
    const g = groupsRef.current.terrain
    if (!g || !terrain?.png_base64) return
    g.clearLayers()
    const overlay = L.imageOverlay('data:image/png;base64,' + terrain.png_base64, bboxToLatLngBounds(terrain.bbox_lonlat), {
      opacity: terrainOpacity ?? 0.4,
      interactive: false,
    }).addTo(g)
    terrainOverlayRef.current = overlay
  }, [terrain, terrainOpacity])

  useEffect(() => {
    if (terrainOverlayRef.current) {
      terrainOverlayRef.current.setOpacity(terrainOpacity ?? 0.4)
    }
  }, [terrainOpacity])

  // ---------------------------------------------------------------- per-frame: street flooding, depth grid, surcharge, edge util
  const depthOverlayRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !frame) return

    // streets
    const streetsG = groupsRef.current.streets
    streetsG.clearLayers()
    segIndexRef.current.clear()
    const feats = frame.streets?.features || []
    for (const f of feats) {
      const p = f.properties || {}
      const d = p.depth_cm || 0
      if (d < 1) continue // don't clutter the map with essentially-dry segments
      const sev = p.severity || severityOf(d, DEFAULT_BANDS_CM)
      const isSelected = String(p.seg_id) === String(selectedSegIdRef.current)
      const pl = L.polyline((f.geometry.coordinates || []).map(lonLatToLatLng), {
        color: isSelected ? '#ffffff' : severityColor(sev),
        weight: isSelected ? 7 : 2.5 + Math.min(7, d / 9),
        opacity: isSelected ? 1 : 0.92,
      })
      pl.bindTooltip(
        `<b>${p.name || p.seg_id}</b><br>${Math.round(d)} cm &middot; ${SEVERITY_LABEL[sev] || sev}` +
          `<br>car ${p.passable_car ? 'passable' : 'BLOCKED'} &middot; ambulance ${p.passable_ambulance ? 'passable' : 'BLOCKED'}`,
      )
      pl.on('click', () => selectSegmentRef.current(p.seg_id))
      pl.on('mouseover', () => pl.setStyle({ weight: (isSelected ? 7 : 2.5 + Math.min(7, d / 9)) + 2 }))
      pl.on('mouseout', () => pl.setStyle({ weight: isSelected ? 7 : 2.5 + Math.min(7, d / 9) }))
      segIndexRef.current.set(String(p.seg_id), pl)
      pl.addTo(streetsG)
    }

    // depth grid
    const depthG = groupsRef.current.depth
    depthG.clearLayers()
    depthOverlayRef.current = null
    if (frame.depth_grid?.png_base64) {
      const bbox = frame.depth_grid.bbox_lonlat || meta?.pilot?.bbox_lonlat
      if (bbox) {
        const overlay = L.imageOverlay('data:image/png;base64,' + frame.depth_grid.png_base64, bboxToLatLngBounds(bbox), {
          opacity: depthOpacity ?? 0.5,
          interactive: false,
        }).addTo(depthG)
        depthOverlayRef.current = overlay
      }
    }

    // surcharging nodes (part of the "Drainage Network" toggle group)
    const surchG = groupsRef.current.drainageSurcharge
    surchG.clearLayers()
    for (const n of frame.nodes || []) {
      if (!n.surcharging) continue
      const m = L.circleMarker([n.lat, n.lon], {
        radius: 6,
        color: '#ff3366',
        weight: 2,
        fillColor: '#ff3366',
        fillOpacity: 0.6,
        className: 'node-pulse',
        renderer: svgRendererRef.current,
      })
      m.bindTooltip(`<b>Surcharging ${n.id}</b><br>cause: ${n.cause || 'capacity exceeded'}<br>${(n.surcharge_m3 ?? 0).toFixed(1)} m&sup3; &middot; HGL ${(n.hgl_m ?? 0).toFixed(2)} m`)
      m.addTo(surchG)
    }

    // recolour the (persistent) drainage edges by utilisation
    if (frame.edges?.length) {
      const util = new Map(frame.edges.map((e) => [e.id, e.util || 0]))
      edgeIndexRef.current.forEach((pl, id) => {
        const u = Math.max(0, Math.min(1.2, util.get(id) ?? 0))
        const hue = 210 - 210 * Math.min(1, u)
        pl.setStyle({ color: `hsl(${hue},85%,${u > 1 ? 42 : 60}%)` })
      })
    }
  }, [frame, meta, depthOpacity])

  useEffect(() => {
    if (depthOverlayRef.current) {
      depthOverlayRef.current.setOpacity(depthOpacity ?? 0.5)
    }
  }, [depthOpacity])

  // re-highlight the selected segment without waiting for the next frame fetch (e.g. selection made from
  // the FloodedStreets/AlertsPanel/"Top flood priorities" lists rather than a map click), and pan the map
  // to it -- "jump to the relevant map location" for alert/priority clicks.
  useEffect(() => {
    const map = mapRef.current
    let selectedLayer = null
    segIndexRef.current.forEach((pl, segId) => {
      const isSelected = String(segId) === String(selectedSegId)
      pl.setStyle({ color: isSelected ? '#ffffff' : pl.options.color, weight: isSelected ? 7 : pl.options.weight })
      if (isSelected) {
        pl.bringToFront()
        selectedLayer = pl
      }
    })
    if (map && selectedLayer) {
      try {
        map.fitBounds(selectedLayer.getBounds().pad(0.6), { maxZoom: 17 })
      } catch {
        /* degenerate (single-point) geometry -- ignore, highlighting already happened */
      }
    }
  }, [selectedSegId])

  // ---------------------------------------------------------------- route
  useEffect(() => {
    const g = groupsRef.current.route
    const map = mapRef.current
    if (!g || !map) return
    g.clearLayers()
    routeMarkersRef.current = []

    const addMarker = (lonlat, label, color) => {
      const icon = L.divIcon({
        className: 'route-marker',
        html: `<div class="route-marker-inner" style="background:${color}"><span>${label}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 24],
      })
      const m = L.marker(lonLatToLatLng(lonlat), { icon }).addTo(g)
      routeMarkersRef.current.push(m)
    }

    if (route.origin) addMarker(route.origin, 'A', '#22e6a3')
    if (route.dest) addMarker(route.dest, 'B', route.result?.reachable === false ? '#ff3366' : '#00d4ff')

    const r = route.result
    if (r?.baseline_route) {
      L.geoJSON(r.baseline_route, { style: { color: '#9ca3af', weight: 3, dashArray: '5 7', opacity: 0.8 } }).addTo(g)
    }
    if (r?.route && r.reachable !== false) {
      const gj = L.geoJSON(r.route, { style: { color: '#22e6a3', weight: 5, opacity: 0.95 } }).addTo(g)
      try {
        map.fitBounds(gj.getBounds().pad(0.35))
      } catch {
        /* empty geometry -- ignore */
      }
    }
  }, [route])

  // legend rows: DEFAULT_BANDS_CM is [[5,'clear'],[15,'minor'],[30,'moderate'],[60,'severe']] ascending by
  // upper bound; severityOf() returns 'critical' for anything at/above the last limit. Build "X-Y cm" rows
  // directly from that same table so the legend can never drift from the actual thresholds.
  const legendRows = DEFAULT_BANDS_CM.map(([limit, label], i) => {
    const lo = i === 0 ? 0 : DEFAULT_BANDS_CM[i - 1][0]
    return { sev: label, text: `${lo}–${limit} cm` }
  }).concat([{ sev: 'critical', text: `≥${DEFAULT_BANDS_CM[DEFAULT_BANDS_CM.length - 1][0]} cm` }])

  return (
    <>
      <div ref={elRef} className={styles.mapEl} />
      <div className={`${styles.legend} glass-panel`}>
        <div className={styles.legendTitle}>Street flood depth</div>
        {legendRows.map(({ sev, text }) => (
          <div className={styles.legendRow} key={sev}>
            <span className={styles.legendSwatch} style={{ background: SEVERITY_COLOR[sev] }} />
            {SEVERITY_LABEL[sev]} <span style={{ color: 'var(--text-faint)' }}>&nbsp;{text}</span>
          </div>
        ))}
      </div>
    </>
  )
}
