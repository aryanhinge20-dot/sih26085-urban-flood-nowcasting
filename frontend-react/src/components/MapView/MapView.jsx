import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { bboxToLatLngBounds, lonLatToLatLng } from '../../lib/format.js'
import { DEFAULT_BANDS_CM, SEVERITY_COLOR, SEVERITY_LABEL, severityColor, severityOf } from '../../lib/severity.js'
import styles from './MapView.module.css'

const PILOT_CENTER = [19.02, 72.845]

// Internal Leaflet layer groups.
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
  const edgeIndexRef = useRef(new Map())
  const segIndexRef = useRef(new Map())
  const routeMarkersRef = useRef([])
  const boundsFittedRef = useRef(false)
  const fittedRouteKeyRef = useRef(null)

  const {
    meta, roads, topology, hotspots, terrain,
    frame, selectedSegId, selectSegment,
    route, pickPoint,
    layers, terrainOpacity, depthOpacity,
  } = useFloodNet()

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
    const map = L.map(elRef.current, { zoomControl: false, preferCanvas: true }).setView(PILOT_CENTER, 15)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    svgRendererRef.current = L.svg()

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
    L.rectangle(bounds, { color: '#94a3b8', weight: 1.5, dashArray: '4 5', fill: false, interactive: false }).addTo(map)
    if (Array.isArray(meta.attribution)) meta.attribution.forEach((a) => map.attributionControl.addAttribution(a))
    boundsFittedRef.current = true
  }, [meta])

  // ---------------------------------------------------------------- roads (static, neutral)
  useEffect(() => {
    const g = groupsRef.current.roads
    if (!g || !roads) return
    g.clearLayers()
    roadIndexRef.current.clear()
    for (const f of roads.features || []) {
      const pl = L.polyline((f.geometry.coordinates || []).map(lonLatToLatLng), {
        color: '#94a3b8',
        weight: 1.2,
        opacity: 0.55,
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
      const w = 1.0 + 3 * Math.sqrt((e.capacity_m3s || 0) / cmax)
      const pl = L.polyline((e.geom || []).map(lonLatToLatLng), { color: '#0d9488', weight: w, opacity: 0.75 })
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
        ? L.rectangle([[n.lat - 3e-5, n.lon - 3e-5], [n.lat + 3e-5, n.lon + 3e-5]], { color: '#059669', weight: 2, fillOpacity: 0.6 })
        : L.circleMarker([n.lat, n.lon], { radius: 2.5, color: '#0284c7', weight: 1, fillOpacity: 0.6 })
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
        radius: 6,
        color: '#d97706',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: active ? 0.8 : 0.2,
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
      opacity: terrainOpacity ?? 0.35,
      interactive: false,
    }).addTo(g)
    terrainOverlayRef.current = overlay
  }, [terrain, terrainOpacity])

  useEffect(() => {
    if (terrainOverlayRef.current) {
      terrainOverlayRef.current.setOpacity(terrainOpacity ?? 0.35)
    }
  }, [terrainOpacity])

  // ---------------------------------------------------------------- per-frame: street flooding, depth grid, surcharge, edge util
  const depthOverlayRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !frame) return

    // streets: reuse existing polylines via diffing to eliminate 900+ polyline recreation churn
    const streetsG = groupsRef.current.streets
    const currentMap = segIndexRef.current
    const activeSegIds = new Set()
    const feats = frame.streets?.features || []

    for (const f of feats) {
      const p = f.properties || {}
      const d = p.depth_cm || 0
      if (d < 1) continue
      const segIdStr = String(p.seg_id)
      activeSegIds.add(segIdStr)

      const sev = p.severity || severityOf(d, DEFAULT_BANDS_CM)
      const isSelected = segIdStr === String(selectedSegIdRef.current)
      const color = isSelected ? '#1d1d1f' : severityColor(sev)
      const weight = isSelected ? 7 : 2.8 + Math.min(6, d / 10)
      const opacity = isSelected ? 1 : 0.95
      const tooltipContent = `<b>${p.name || p.seg_id}</b><br>${Math.round(d)} cm &middot; ${SEVERITY_LABEL[sev] || sev}` +
        `<br>car ${p.passable_car ? 'passable' : 'BLOCKED'} &middot; ambulance ${p.passable_ambulance ? 'passable' : 'BLOCKED'}`

      const existingPl = currentMap.get(segIdStr)
      if (existingPl) {
        existingPl.setStyle({ color, weight, opacity })
        existingPl.setTooltipContent(tooltipContent)
      } else {
        const pl = L.polyline((f.geometry.coordinates || []).map(lonLatToLatLng), {
          color,
          weight,
          opacity,
        })
        pl.bindTooltip(tooltipContent)
        pl.on('click', () => selectSegmentRef.current(p.seg_id))
        pl.on('mouseover', () => pl.setStyle({ weight: (isSelected ? 7 : 2.8 + Math.min(6, d / 10)) + 2 }))
        pl.on('mouseout', () => pl.setStyle({ weight: isSelected ? 7 : 2.8 + Math.min(6, d / 10) }))
        currentMap.set(segIdStr, pl)
        pl.addTo(streetsG)
      }
    }

    // Prune polylines that have receded to 0 depth
    for (const [segIdStr, pl] of currentMap.entries()) {
      if (!activeSegIds.has(segIdStr)) {
        streetsG.removeLayer(pl)
        currentMap.delete(segIdStr)
      }
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

    // surcharging nodes
    const surchG = groupsRef.current.drainageSurcharge
    surchG.clearLayers()
    for (const n of frame.nodes || []) {
      if (!n.surcharging) continue
      const m = L.circleMarker([n.lat, n.lon], {
        radius: 6,
        color: '#dc2626',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.75,
        className: 'node-pulse',
        renderer: svgRendererRef.current,
      })
      m.bindTooltip(`<b>Surcharging ${n.id}</b><br>cause: ${n.cause || 'capacity exceeded'}<br>${(n.surcharge_m3 ?? 0).toFixed(1)} m&sup3; &middot; HGL ${(n.hgl_m ?? 0).toFixed(2)} m`)
      m.addTo(surchG)
    }

    // recolour the drainage edges by utilisation
    if (frame.edges?.length) {
      const util = new Map(frame.edges.map((e) => [e.id, e.util || 0]))
      edgeIndexRef.current.forEach((pl, id) => {
        const u = Math.max(0, Math.min(1.2, util.get(id) ?? 0))
        const hue = 200 - 200 * Math.min(1, u)
        pl.setStyle({ color: `hsl(${hue},85%,${u > 1 ? 40 : 50}%)` })
      })
    }
  }, [frame, meta, depthOpacity])

  useEffect(() => {
    if (depthOverlayRef.current) {
      depthOverlayRef.current.setOpacity(depthOpacity ?? 0.5)
    }
  }, [depthOpacity])

  // Re-highlight selected segment
  useEffect(() => {
    const map = mapRef.current
    let selectedLayer = null
    segIndexRef.current.forEach((pl, segId) => {
      const isSelected = String(segId) === String(selectedSegId)
      pl.setStyle({ color: isSelected ? '#1d1d1f' : pl.options.color, weight: isSelected ? 7 : pl.options.weight })
      if (isSelected) {
        pl.bringToFront()
        selectedLayer = pl
      }
    })
    if (map && selectedLayer) {
      try {
        map.fitBounds(selectedLayer.getBounds().pad(0.6), { maxZoom: 17 })
      } catch {
        /* ignore */
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

    if (route.origin) addMarker(route.origin, 'A', '#16a34a')
    if (route.dest) addMarker(route.dest, 'B', route.result?.reachable === false ? '#dc2626' : '#2563eb')

    const r = route.result
    if (r?.baseline_route) {
      L.geoJSON(r.baseline_route, { style: { color: 'rgba(148, 163, 184, 0.45)', weight: 2.5, dashArray: '4 6', opacity: 0.65 } }).addTo(g)
    }

    const routeKey = route.origin && route.dest ? `${route.origin.join(',')}|${route.dest.join(',')}` : null

    if (r?.route && r.reachable !== false) {
      const gj = L.geoJSON(r.route, { style: { color: '#22c55e', weight: 6, opacity: 0.98 } }).addTo(g)
      if (routeKey && routeKey !== fittedRouteKeyRef.current) {
        try {
          map.fitBounds(gj.getBounds().pad(0.35), { maxZoom: 16, minZoom: 13, animate: true, duration: 0.5 })
          fittedRouteKeyRef.current = routeKey
        } catch {
          /* ignore */
        }
      }
    } else if (route.origin && route.dest && routeKey && routeKey !== fittedRouteKeyRef.current) {
      try {
        const bounds = L.latLngBounds([lonLatToLatLng(route.origin), lonLatToLatLng(route.dest)])
        map.fitBounds(bounds.pad(0.4), { maxZoom: 16, minZoom: 13, animate: true, duration: 0.5 })
        fittedRouteKeyRef.current = routeKey
      } catch {
        /* ignore */
      }
    }

    if (!route.origin && !route.dest) {
      fittedRouteKeyRef.current = null
    }
  }, [route])

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
