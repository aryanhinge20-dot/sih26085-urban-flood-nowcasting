import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useFloodNet } from '../../state/FloodNetContext.jsx'
import { bboxToLatLngBounds, lonLatToLatLng } from '../../lib/format.js'
import { DEFAULT_BANDS_CM, SEVERITY_COLOR, SEVERITY_LABEL, severityColor, severityOf } from '../../lib/severity.js'
import styles from './MapView.module.css'

const PILOT_CENTER = [19.02, 72.845]

// Colours for POST /api/route/alternatives candidate layers, keyed by the candidate's primary objective label
// (see RoutePlanner.jsx's OBJECTIVE_LABEL for the matching honest UI text -- "fastest" here is DISTANCE-only).
const OBJECTIVE_COLOR = { safest: '#22c55e', fastest: '#f59e0b', balanced: '#8b5cf6' }
const DEFAULT_CANDIDATE_COLOR = '#64748b'

// ── drainage node state (three tiers, straight from the solver) ────────────────────────────────────────
// Each per-frame node dict carries `state`, exactly one of 'normal' | 'at_capacity' | 'surcharging':
//   surcharging  -- the node spilled water to the street during this frame interval (a real problem).
//   at_capacity  -- fill_frac >= the solver's own internal full threshold: water has reached street level
//                   and is blocking upstream flow, but it did NOT spill during the interval.
//   normal       -- everything else.
// `fill_frac` / `freeboard_m` are INSTANTANEOUS at the frame boundary, while `state` / `surcharging` are
// INTERVAL-aware, so a node that spilled early in the interval and then drained legitimately reports
// state 'surcharging' with a fill_frac well below 1.0. Every tooltip below therefore times its fill
// number explicitly ("fill at frame end") so the two can never read as a contradiction.
function nodeStateOf(f) {
  if (!f) return null
  if (f.state === 'normal' || f.state === 'at_capacity' || f.state === 'surcharging') return f.state
  return f.surcharging ? 'surcharging' : 'normal' // defensive fallback for a pre-`state` payload
}

// Continuous fill encoding on NORMAL nodes only: radius and fill-opacity vary smoothly with fill_frac
// while the HUE IS HELD at the baseline blue. Deliberately NOT banded -- node depths in this network run
// from 0.57 m to 4.47 m, so any fixed fill-fraction cut (0.85, say) would mean a wildly different real
// freeboard from node to node, i.e. the UI would be asserting a threshold the physics does not define.
const NODE_STYLE_STATIC = { radius: 2.5, color: '#0284c7', weight: 1, fillColor: '#0284c7', fillOpacity: 0.6 }

function nodeStyleFor(f) {
  const state = nodeStateOf(f)
  if (state === 'surcharging') {
    return { radius: 6, color: '#dc2626', weight: 2, fillColor: '#ef4444', fillOpacity: 0.8 }
  }
  if (state === 'at_capacity') {
    // Amber/orange: clearly between calm blue and alarm red, and no pulse -- the pulse is reserved for
    // nodes that are actually spilling.
    return { radius: 4.5, color: '#c2410c', weight: 2, fillColor: '#f97316', fillOpacity: 0.85 }
  }
  if (!f) return NODE_STYLE_STATIC
  const fill = Math.max(0, Math.min(1, f.fill_frac ?? 0))
  return { radius: 2.2 + 1.8 * fill, color: '#0284c7', weight: 1, fillColor: '#0284c7', fillOpacity: 0.32 + 0.5 * fill }
}

const NODE_STATE_TEXT = {
  normal: 'NORMAL',
  at_capacity: 'AT CAPACITY &mdash; water at street level, no spill this interval',
  surcharging: 'SURCHARGING &mdash; spilled to street during this interval',
}

// `n` is the static topology node (ground/invert), `f` the per-frame state (undefined before the first frame).
function nodeTooltip(n, f) {
  const head = `<b>${n.is_outfall ? 'Outfall' : 'Node'} ${n.id}</b>`
  const geom = `ground ${(n.ground_m ?? 0).toFixed(2)} m &middot; invert ${(n.invert_m ?? 0).toFixed(2)} m`
  const state = nodeStateOf(f)
  if (!state) return `${head}<br>${geom}`

  const rows = [NODE_STATE_TEXT[state]]
  if (f.freeboard_m != null) {
    rows.push(
      f.freeboard_m <= 0
        ? 'water at street level (0.00 m freeboard)'
        : `water ${f.freeboard_m.toFixed(2)} m below street level`,
    )
  }
  if (f.fill_frac != null) rows.push(`fill at frame end ${Math.round(Math.max(0, Math.min(1, f.fill_frac)) * 100)}%`)
  if (f.surcharge_m3 > 0) rows.push(`spilled ${f.surcharge_m3.toFixed(1)} m&sup3; this interval`)
  if (f.cause) rows.push(`cause: ${f.cause}`)
  if (f.hgl_m != null) rows.push(`HGL ${f.hgl_m.toFixed(2)} m`)
  return `${head}<br>${geom}<br>${rows.join('<br>')}`
}

// Applied both from the per-frame effect and once right after the static geometry is (re)built, so the
// network is never left showing state-less geometry when topology happens to resolve after the first frame.
function applyNodeFrameStyles(index, frame) {
  const states = new Map((frame?.nodes || []).map((n) => [String(n.id), n]))
  index.forEach((entry, id) => {
    const f = states.get(id)
    entry.layer.setTooltipContent(nodeTooltip(entry.node, f))
    // Outfalls keep their distinct green-rectangle treatment -- they are the network's boundary condition,
    // not a manhole that can surcharge -- so only their tooltip is refreshed.
    if (entry.isOutfall) return
    entry.layer.setStyle(nodeStyleFor(f))
  })
}

// Recolour the drainage edges by utilisation.
// `edge_util` is structurally bounded at 1.0 by the solver (Q = cap_eff * min(1, sqrt(head/drop)), only ever
// reduced afterwards) -- measured max across every frame of two full scenarios was exactly 1.0000 -- so
// there is no >1 case to render and no clamp above 1 to apply. Crucially, util == 1.0 means the conduit is
// flowing at its FULL DESIGN CAPACITY, which is the normal design condition for a storm drain under load,
// NOT a failure. The ramp therefore runs calm teal (idle) -> saturated indigo (full bore): still an obvious
// gradient, but it never reads as alarm and never competes with the genuinely red surcharging nodes, which
// are the actual problem on this map.
function applyEdgeFrameStyles(index, frame) {
  if (!frame?.edges?.length) return
  const util = new Map(frame.edges.map((e) => [e.id, e.util || 0]))
  index.forEach((pl, id) => {
    const u = Math.max(0, Math.min(1, util.get(id) ?? 0))
    pl.setStyle({ color: `hsl(${178 + 54 * u},${45 + 35 * u}%,${62 - 24 * u}%)`, opacity: 0.55 + 0.35 * u })
  })
}

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
  // id -> { layer, node, isOutfall }. Mirrors edgeIndexRef: markers are created ONCE with the static
  // topology (creating 1200+ of them is expensive) and then re-styled in place every frame.
  const nodeIndexRef = useRef(new Map())
  const segIndexRef = useRef(new Map())
  const routeMarkersRef = useRef([])
  const boundsFittedRef = useRef(false)
  const fittedRouteKeyRef = useRef(null)

  const {
    meta, roads, topology, hotspots, terrain,
    frame, selectedSegId, selectSegment,
    route, pickPoint, alternatives, alternativesStale, selectAlternative,
    layers, terrainOpacity, depthOpacity,
  } = useFloodNet()

  const pickPointRef = useRef(pickPoint)
  const selectSegmentRef = useRef(selectSegment)
  const selectedSegIdRef = useRef(selectedSegId)
  // Declared before the static-geometry effects, so on any commit this is already the current frame by the
  // time the topology effect below rebuilds the drainage network.
  const frameRef = useRef(frame)
  useEffect(() => {
    pickPointRef.current = pickPoint
    selectSegmentRef.current = selectSegment
    selectedSegIdRef.current = selectedSegId
    frameRef.current = frame
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
    nodeIndexRef.current.clear()
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
        : L.circleMarker([n.lat, n.lon], NODE_STYLE_STATIC)
      m.bindTooltip(nodeTooltip(n, null))
      // Outfalls keep their distinct green-rectangle treatment and are never re-styled by state (they are
      // the network's boundary condition, not a manhole that can surcharge); they are still indexed so the
      // per-frame effect can refresh their tooltip.
      nodeIndexRef.current.set(String(n.id), { layer: m, node: n, isOutfall: Boolean(n.is_outfall) })
      m.addTo(nodesG)
    }
    // If topology resolved after the first frame did, style it straight away rather than leaving the whole
    // network state-less until the user next scrubs the timeline.
    applyNodeFrameStyles(nodeIndexRef.current, frameRef.current)
    applyEdgeFrameStyles(edgeIndexRef.current, frameRef.current)
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

    // Drainage nodes: re-style the persistent markers into the three solver tiers, so every node carries
    // its hydraulic state instead of only the surcharging minority (previously 1117 of 1233 nodes were
    // inert blue decoration that never changed across the whole run).
    applyNodeFrameStyles(nodeIndexRef.current, frame)

    // Pulse halo for spilling nodes only. Kept as a separate SVG-rendered, non-interactive ring because the
    // node markers themselves live on the canvas renderer (map is preferCanvas) where a CSS animation class
    // cannot apply; `fill:false` + `interactive:false` means it is purely the pulse, and hover still falls
    // through to the node marker below, which owns the single unified tooltip.
    const surchG = groupsRef.current.drainageSurcharge
    surchG.clearLayers()
    for (const n of frame.nodes || []) {
      if (nodeStateOf(n) !== 'surcharging') continue
      L.circleMarker([n.lat, n.lon], {
        radius: 6,
        color: '#dc2626',
        weight: 2,
        fill: false,
        className: 'node-pulse',
        interactive: false,
        renderer: svgRendererRef.current,
      }).addTo(surchG)
    }

    applyEdgeFrameStyles(edgeIndexRef.current, frame)
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
  // Two candidate-route layer patterns share the `route` layer group: the original single-route
  // baseline(dashed grey)+route(solid green) pair, and -- additive, only drawn once alternatives have been
  // requested -- N safest/fastest/balanced candidate layers (recommended/selected = strongest line, the rest
  // lighter/thinner), reusing the exact same visual convention.
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

    const candidates = alternatives.result?.candidates || []
    const altUnreachable = alternatives.result?.reachable === false
    const markerColor = candidates.length > 0 ? (altUnreachable ? '#dc2626' : '#2563eb') : (route.result?.reachable === false ? '#dc2626' : '#2563eb')

    if (route.origin) addMarker(route.origin, 'A', '#16a34a')
    if (route.dest) addMarker(route.dest, 'B', markerColor)

    const routeKey = route.origin && route.dest ? `${route.origin.join(',')}|${route.dest.join(',')}` : null

    if (candidates.length > 0) {
      // Alternatives mode: render every candidate, selected/recommended on top and strongest.
      let selectedLayer = null
      candidates.forEach((c, i) => {
        if (!c.route) return
        const isSelected = alternatives.selected === i
        const color = OBJECTIVE_COLOR[c.objectives?.[0]] || DEFAULT_CANDIDATE_COLOR
        // Alternatives are deliberately NOT auto-recomputed when the dashboard timestep changes (evaluated
        // and rejected as too costly). So once `alternativesStale` is true, this geometry was computed for a
        // different timestep than the street-flood colouring and depth overlay it is drawn over: dash it and
        // drop its opacity so it can never present itself as current. RoutePlanner carries the wording.
        const gj = L.geoJSON(c.route, {
          style: alternativesStale
            ? { color, weight: isSelected ? 4.5 : 2.5, opacity: isSelected ? 0.55 : 0.28, dashArray: '5 7' }
            : { color, weight: isSelected ? 6 : 3, opacity: isSelected ? 0.98 : 0.5 },
        }).addTo(g)
        gj.on('click', () => selectAlternative(i))
        if (isSelected) {
          gj.bringToFront()
          selectedLayer = gj
        }
      })
      if (selectedLayer && routeKey && routeKey !== fittedRouteKeyRef.current) {
        try {
          map.fitBounds(selectedLayer.getBounds().pad(0.35), { maxZoom: 16, minZoom: 13, animate: true, duration: 0.5 })
          fittedRouteKeyRef.current = routeKey
        } catch {
          /* ignore */
        }
      }
    } else {
      const r = route.result
      if (r?.baseline_route) {
        L.geoJSON(r.baseline_route, { style: { color: 'rgba(148, 163, 184, 0.45)', weight: 2.5, dashArray: '4 6', opacity: 0.65 } }).addTo(g)
      }

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
    }

    if (!route.origin && !route.dest) {
      fittedRouteKeyRef.current = null
    }
  }, [route, alternatives, alternativesStale, selectAlternative])

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
