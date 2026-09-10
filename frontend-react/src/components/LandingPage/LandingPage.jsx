import { useState, useEffect } from 'react'
import HeroVisual from './HeroVisual.jsx'
import styles from './LandingPage.module.css'

const STORY_STAGES = [
  {
    id: 'rain',
    num: '01',
    phase: 'RAIN',
    headline: 'Rainfall enters the system.',
    description: 'ECMWF numerical weather prediction, historical gauge records, or synthetic design storms drive the model across the 0–3 hour horizon. Rainfall is applied uniformly over the pilot — the engine does not currently ingest a spatially varying rainfall field.',
    metric: 'Rainfall intensity (mm/h), uniform',
  },
  {
    id: 'runoff',
    num: '02',
    phase: 'RUNOFF',
    headline: 'Impervious surfaces convert it into runoff.',
    description: 'High urban density and concrete streetscapes limit infiltration, converting most rainfall volume into rapid surface runoff.',
    metric: 'Rational method, per-cell C',
  },
  {
    id: 'terrain',
    num: '03',
    phase: 'TERRAIN',
    headline: 'Water moves with the urban terrain.',
    description: 'A 2D storage-cell elevation model routes runoff along natural elevation gradients, channeling overland sheet flow toward the Hindmata depression bowl.',
    metric: '10m DEM cell routing',
  },
  {
    id: 'drainage',
    num: '04',
    phase: 'DRAINAGE',
    headline: 'Capacity limits create surcharge.',
    description: 'When stormwater conduits exceed hydraulic conveyance, inlets can no longer carry away the water they capture, and it accumulates at street level. Tidal backflow at outfalls is not currently modeled.',
    metric: 'Capacity-limited graph hydraulics',
  },
  {
    id: 'flood',
    num: '05',
    phase: 'FLOOD',
    headline: 'Street depth evolves over time.',
    description: 'Surface runoff and pipe surcharge couple to compute continuous street-level flood depth, reported in centimeters, along every roadway corridor in the ward.',
    metric: 'Depth reported in cm',
  },
  {
    id: 'action',
    num: '06',
    phase: 'ACTION',
    headline: 'Emergency routes adapt to risk.',
    description: 'Dijkstra risk-aware routing navigates emergency vehicles around modeled impassable depths, based on current forecast conditions.',
    metric: 'Vehicle threshold clearance',
  },
]

export default function LandingPage({ onEnter, isTransitioning }) {
  const [activeStage, setActiveStage] = useState(0)
  const [autoPlay, setAutoPlay] = useState(true)

  useEffect(() => {
    if (!autoPlay) return
    const timer = setInterval(() => {
      setActiveStage((prev) => (prev + 1) % STORY_STAGES.length)
    }, 4200)
    return () => clearInterval(timer)
  }, [autoPlay])

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const stage = STORY_STAGES[activeStage]

  return (
    <div className={`${styles.page} ${isTransitioning ? styles.pageTransitioning : ''}`}>
      {/* 1. Top Navbar */}
      <nav className={styles.navbar}>
        <div className={styles.navLeft}>
          <span className={styles.brandTitle}>FloodNet</span>
          <span className={styles.brandBadge}>MUNICIPAL NOWCAST</span>
        </div>

        <div className={styles.navLinks}>
          <button
            type="button"
            className={styles.navLink}
            onClick={() => scrollToSection('coupled-system')}
          >
            Physical Model
          </button>
          <button
            type="button"
            className={styles.navLink}
            onClick={() => scrollToSection('how-it-works')}
          >
            How it works
          </button>
          <button
            type="button"
            className={styles.navLink}
            onClick={() => scrollToSection('pilot')}
          >
            Pilot
          </button>
          <button
            type="button"
            className={styles.navLink}
            onClick={() => scrollToSection('capabilities')}
          >
            Capabilities
          </button>
          <button
            type="button"
            className={styles.navCta}
            onClick={onEnter}
          >
            Enter Control Centre &rarr;
          </button>
        </div>
      </nav>

      {/* 2. Hero Section: restrained geographic backdrop + isolated hero visual (self-contained,
             purely decorative, error-boundary-wrapped -- see HeroVisual.jsx) */}
      <header className={styles.heroSection}>
        <div className={styles.heroTerrainBackdrop} aria-hidden="true" />
        <HeroVisual />

        {/* Scientific HUD Micro-labels & Spatial Telemetry */}
        <div className={styles.hudOverlay} aria-hidden="true">
          <div className={styles.hudTopLeft}>
            <div className={styles.hudTag}>
              <span className={styles.hudBullet} />
              MUMBAI PILOT
            </div>
            <div className={styles.hudCoords}>72.835–72.855° E, 19.010–19.030° N</div>
            <div className={styles.hudSub}>MCGM F/N &amp; F/S &middot; HINDMATA DEPRESSION</div>
          </div>

          <div className={styles.hudTopRight}>
            <div className={styles.hudTag}>
              <span className={styles.hudBullet} />
              0–180 MIN
            </div>
            <div className={styles.hudCoords}>FORECAST HORIZON // 5-MIN TIMESTEP</div>
            <div className={styles.hudSub}>STREET LEVEL &middot; 10m DEM RESOLUTION</div>
          </div>

          <div className={styles.hudBottomLeft}>
            <div className={styles.hudTag}>
              <span className={styles.hudBullet} />
              HYDRAULIC MODEL
            </div>
            <div className={styles.hudCoords}>STORAGE-CELL // CAPACITY-LIMITED GRAPH</div>
            <div className={styles.hudSub}>SURFACE STORAGE-CELLS + CONDUIT SURCHARGE</div>
          </div>

          <div className={styles.hudBottomRight}>
            <div className={styles.hudTag}>
              <span className={styles.hudBullet} />
              SYSTEM STATUS
            </div>
            <div className={styles.hudCoords}>GIS INTELLIGENCE // PROTOTYPE</div>
            <div className={styles.hudSub}>0&ndash;3H FORECAST DECISION SUPPORT</div>
          </div>
        </div>

        {/* Central Command Room Entrance & Identity */}
        <div className={styles.heroCenterFocal}>
          <div className={styles.technicalBeacon}>
            <span className={styles.beaconPulse} />
            <span className={styles.technicalBeaconText}>MUMBAI URBAN FLOOD INTELLIGENCE</span>
          </div>

          <h1 className={styles.heroBrandTitle}>
            FLOODNET
          </h1>

          <p className={styles.heroMainStatement}>
            Know where the water will be — before it arrives.
          </p>

          <p className={styles.heroSupportingCopy}>
            Street-level flood forecasting for Mumbai, combining rainfall, terrain, runoff and drainage behaviour across a 0–3 hour operational window.
          </p>

          <div className={styles.heroActionRow}>
            <button
              type="button"
              className={styles.enterControlRoomBtn}
              onClick={onEnter}
            >
              <span className={styles.pulseDot} />
              ENTER CONTROL CENTRE
              <span className={styles.btnArrow}>&rarr;</span>
            </button>

            <button
              type="button"
              className={styles.exploreForecastBtn}
              onClick={() => scrollToSection('coupled-system')}
            >
              EXPLORE FORECAST
              <span className={styles.btnDownArrow}>&darr;</span>
            </button>
          </div>

          {/* Precision Telemetry Matrix */}
          <div className={styles.telemetryMatrix}>
            <div className={styles.telemCol}>
              <span className={styles.telemTag}>PREDICTION WINDOW</span>
              <span className={styles.telemData}>0–3 Hours</span>
            </div>
            <div className={styles.telemSep} />
            <div className={styles.telemCol}>
              <span className={styles.telemTag}>STREET NETWORK</span>
              <span className={styles.telemData}>2,978 Segments</span>
            </div>
            <div className={styles.telemSep} />
            <div className={styles.telemCol}>
              <span className={styles.telemTag}>DEPTH UNITS</span>
              <span className={styles.telemData}>Reported in cm</span>
            </div>
            <div className={styles.telemSep} />
            <div className={styles.telemCol}>
              <span className={styles.telemTag}>DECISION SUPPORT</span>
              <span className={styles.telemData}>Clearance Routing</span>
            </div>
          </div>
        </div>
      </header>

      {/* 3. Physical Coupled System Centerpiece */}
      <section id="coupled-system" className={styles.centerpieceSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>Coupled Hydrodynamic Simulation</span>
          <h2 className={styles.sectionTitle}>Physics of Mumbai Street Flooding</h2>
          <p className={styles.sectionSubtitle}>
            Rainfall &rarr; Runoff &rarr; Terrain &rarr; Drainage &rarr; Flood Depth &rarr; Safe Route
          </p>
        </div>

        <div className={styles.centerpiece}>
          <div className={styles.visualCanvas}>
            <svg className={styles.stageSvg} viewBox="0 0 800 360" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="terrainGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E5D9C3" />
                  <stop offset="100%" stopColor="#D4C4A0" />
                </linearGradient>
                <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.20" />
                </linearGradient>
              </defs>

              {/* Grid backdrop */}
              <pattern id="gridPat" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(122,34,49,0.07)" strokeWidth="1" />
              </pattern>
              <rect width="800" height="360" fill="url(#gridPat)" />

              {/* Terrain Elevation Silhouette (Hindmata Depression Profile) */}
              <path
                d="M 40 240 Q 200 230 320 280 T 480 285 Q 620 250 760 210 L 760 330 L 40 330 Z"
                fill="url(#terrainGrad)"
                stroke="rgba(43,33,24,0.14)"
                strokeWidth="1.5"
              />

              {/* Rain Vectors (Active on Rain Stage) */}
              <g className={`${styles.rainGroup} ${activeStage >= 0 ? styles.activeLayer : ''}`}>
                <line x1="260" y1="50" x2="245" y2="140" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="6 8" opacity="0.75" />
                <line x1="340" y1="40" x2="325" y2="150" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="6 8" opacity="0.75" />
                <line x1="420" y1="55" x2="405" y2="160" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="6 8" opacity="0.75" />
                <line x1="500" y1="45" x2="485" y2="145" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="6 8" opacity="0.75" />
              </g>

              {/* Overland Runoff Flow Arrows (Active on Runoff) */}
              {activeStage >= 1 && (
                <g className={styles.runoffGroup}>
                  <path d="M 160 225 Q 240 245 320 270" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeDasharray="4 4" />
                  <path d="M 660 215 Q 560 245 460 275" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeDasharray="4 4" />
                </g>
              )}

              {/* Underground Stormwater Drainage Pipe (Active on Drainage) */}
              <g className={styles.drainageGroup}>
                <line x1="120" y1="310" x2="680" y2="310" stroke="#0d9488" strokeWidth="5" opacity="0.9" />
                <circle cx="340" cy="310" r="5" fill="#0d9488" stroke="#FFFFFF" strokeWidth="2" />
                <circle cx="460" cy="310" r="5" fill="#0d9488" stroke="#FFFFFF" strokeWidth="2" />
                {/* Surcharge riser */}
                {activeStage >= 3 && (
                  <path d="M 400 310 L 400 278" stroke="#dc2626" strokeWidth="3" strokeDasharray="2 3" />
                )}
              </g>

              {/* Street Flood Ponding in Depression (Active on Flood Stage) */}
              {activeStage >= 4 && (
                <g className={styles.floodGroup}>
                  <path
                    d="M 300 275 Q 400 282 500 275 Q 460 295 400 295 Q 340 295 300 275 Z"
                    fill="url(#waterGrad)"
                    stroke="#2563eb"
                    strokeWidth="2"
                  />
                  <text x="400" y="270" fill="#2563A8" fontSize="11" fontFamily="var(--mono)" textAnchor="middle" fontWeight="700">
                    Hindmata Depression (schematic)
                  </text>
                </g>
              )}

              {/* Safe Emergency Route Overlay (Active on Action Stage) */}
              {activeStage >= 5 && (
                <g className={styles.routeGroup}>
                  <path
                    d="M 80 230 Q 220 200 380 180 T 720 170"
                    fill="none"
                    stroke="#22C55E"
                    strokeWidth="4"
                  />
                  <circle cx="80" cy="230" r="6" fill="#22C55E" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                  <circle cx="720" cy="170" r="6" fill="#22C55E" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                  <text x="720" y="152" fill="#22C55E" fontSize="11" fontFamily="var(--font)" fontWeight="700" textAnchor="middle">
                    Passable Route (Ambulance)
                  </text>
                </g>
              )}

              {/* Station Annotations */}
              <text x="80" y="270" fill="#6E6255" fontSize="10" fontFamily="var(--font)" fontWeight="600">Parel Junction</text>
              <text x="400" y="345" fill="#6E6255" fontSize="10" fontFamily="var(--mono)" textAnchor="middle" fontWeight="600">
                Hindmata Depression
              </text>
              <text x="680" y="235" fill="#6E6255" fontSize="10" fontFamily="var(--font)" fontWeight="600">Dadar TT Circle</text>
            </svg>
          </div>

          {/* Scrubber timeline */}
          <div className={styles.storyScrubber}>
            {STORY_STAGES.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                className={`${styles.scrubBtn} ${idx === activeStage ? styles.scrubBtnActive : ''}`}
                onClick={() => {
                  setActiveStage(idx)
                  setAutoPlay(false)
                }}
              >
                <span className={styles.scrubNum}>{s.num}</span>
                <span className={styles.scrubPhase}>{s.phase}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Narrative Card of the current selected stage */}
        <div className={styles.narrativeCard}>
          <div className={styles.narrativeHeader}>
            <span className={styles.narrativeNum}>Phase {stage.num} of 06 &middot; {stage.phase}</span>
            <span className={styles.narrativeTag}>{stage.metric}</span>
          </div>
          <h3 className={styles.narrativeHeadline}>{stage.headline}</h3>
          <p className={styles.narrativeDesc}>{stage.description}</p>
        </div>
      </section>

      {/* 4. Pillars Section: Core Mission */}
      <section className={styles.pillarsSection}>
        <div className={styles.pillarsGrid}>
          <div className={styles.pillarCard}>
            <div className={styles.pillarIcon}>01</div>
            <h3 className={styles.pillarTitle}>Forecast where water accumulates</h3>
            <p className={styles.pillarDesc}>
              Street-level 3-hour forecasting computed at 5-minute intervals. Depths reported in centimeters across 2,978 road segments.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <div className={styles.pillarIcon}>02</div>
            <h3 className={styles.pillarTitle}>Understand why it floods</h3>
            <p className={styles.pillarDesc}>
              Physics-based attribution attributing inundation directly to rainfall intensity, terrain depression contours, and underground drain surcharge.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <div className={styles.pillarIcon}>03</div>
            <h3 className={styles.pillarTitle}>Assess safer emergency routes</h3>
            <p className={styles.pillarDesc}>
              Vehicle-aware dynamic navigation routing ambulances and emergency services around impassable street corridors.
            </p>
          </div>
        </div>
      </section>

      {/* 5. How It Works (The Physical Pipeline) */}
      <section id="how-it-works" className={styles.howSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>Coupled Physical Architecture</span>
          <h2 className={styles.sectionTitle}>How FloodNet Works</h2>
          <p className={styles.sectionSubtitle}>
            Numerical Weather Prediction &middot; 2D Overland Cells &middot; 1D Pipe Conduit Hydraulics &middot; Decision Routing
          </p>
        </div>

        {/* Coupled Model Methodology */}
        <div className={styles.methodGrid}>
          <div className={styles.methodCard}>
            <span className={styles.cardIndex}>01 / METEOROLOGY</span>
            <h4 className={styles.cardHeading}>Numerical Weather Prediction</h4>
            <p className={styles.cardBody}>
              ECMWF numerical weather prediction (NWP) forecasts, historical storm records, and synthetic design-storm scenarios — each clearly labeled by source — resampled into 5-minute simulation timesteps.
            </p>
          </div>

          <div className={styles.methodCard}>
            <span className={styles.cardIndex}>02 / SURFACE HYDROLOGY</span>
            <h4 className={styles.cardHeading}>2D Storage-Cell Flow</h4>
            <p className={styles.cardBody}>
              Finite-volume overland routing computes sheet flow along 10m DEM elevation gradients into the Hindmata depression.
            </p>
          </div>

          <div className={styles.methodCard}>
            <span className={styles.cardIndex}>03 / SUBSURFACE HYDRAULICS</span>
            <h4 className={styles.cardHeading}>1D Pipe Conduit Network</h4>
            <p className={styles.cardBody}>
              Capacity-limited graph solver evaluates junction hydraulic grade lines, pipe conveyance limits, and street gully surcharge &mdash; not a full Saint-Venant dynamic-wave model.
            </p>
          </div>

          <div className={styles.methodCard}>
            <span className={styles.cardIndex}>04 / DECISION SUPPORT</span>
            <h4 className={styles.cardHeading}>Dynamic Vehicle Routing</h4>
            <p className={styles.cardBody}>
              Dijkstra routing engine maps street-by-street flood depths against ambulance (40 cm) and car (30 cm) wading thresholds.
            </p>
          </div>
        </div>
      </section>

      {/* 6. Pilot Area: Mumbai Hindmata-Dadar */}
      <section id="pilot" className={styles.pilotSection}>
        <div className={styles.pilotCard}>
          <span className={styles.sectionKicker}>Pilot Study Area</span>
          <h2 className={styles.pilotTitle}>Mumbai &middot; Hindmata / Dadar Corridor</h2>
          <p className={styles.pilotDesc}>
            Encompassing MCGM F/North and F/South municipal wards. Hindmata sits in a natural topographic bowl,
            historically vulnerable to high-intensity monsoon rainfall.
          </p>

          <div className={styles.pilotMetrics}>
            <div className={styles.pilotMetricItem}>
              <span className={styles.pilotMetricVal}>2,978</span>
              <span className={styles.pilotMetricLabel}>Street Segments</span>
            </div>
            <div className={styles.pilotMetricItem}>
              <span className={styles.pilotMetricVal}>1,233</span>
              <span className={styles.pilotMetricLabel}>Drainage Nodes</span>
            </div>
            <div className={styles.pilotMetricItem}>
              <span className={styles.pilotMetricVal}>5 min</span>
              <span className={styles.pilotMetricLabel}>Timestep Resolution</span>
            </div>
            <div className={styles.pilotMetricItem}>
              <span className={styles.pilotMetricVal}>40 cm</span>
              <span className={styles.pilotMetricLabel}>Ambulance Clearance</span>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Operator Capabilities */}
      <section id="capabilities" className={styles.capabilitiesSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionKicker}>Command Centre Capabilities</span>
          <h2 className={styles.sectionTitle}>What the Operator Can Do</h2>
        </div>

        <div className={styles.capGrid}>
          <div className={styles.capCard}>
            <div className={styles.capHeader}>
              <span className={styles.capBadge}>Scenarios</span>
              <h4 className={styles.capTitle}>ECMWF, Replay &amp; Cloudburst</h4>
            </div>
            <p className={styles.capBody}>
              Run ECMWF NWP forecasts, replay the July 2005 Mumbai deluge (380.8 mm in 3 hours, per the Chitale Committee report), or simulate synthetic cloudburst stress tests.
            </p>
          </div>

          <div className={styles.capCard}>
            <div className={styles.capHeader}>
              <span className={styles.capBadge}>Hydraulics</span>
              <h4 className={styles.capTitle}>Drainage Surcharge Toggles</h4>
            </div>
            <p className={styles.capBody}>
              Compare normal drainage conditions against simulated 50% drain blockages to predict backwater surges before they occur.
            </p>
          </div>

          <div className={styles.capCard}>
            <div className={styles.capHeader}>
              <span className={styles.capBadge}>Timeline</span>
              <h4 className={styles.capTitle}>0–3 Hour Scrubbing</h4>
            </div>
            <p className={styles.capBody}>
              Scrub continuously from T+0 to T+180 min to monitor peak accumulation, stagnation windows, and flood recession.
            </p>
          </div>

          <div className={styles.capCard}>
            <div className={styles.capHeader}>
              <span className={styles.capBadge}>Emergency</span>
              <h4 className={styles.capTitle}>Clearance-Safe Navigation</h4>
            </div>
            <p className={styles.capBody}>
              Select origin and destination coordinates on the map to compute detour routes that bypass flooded intersections safely.
            </p>
          </div>
        </div>
      </section>

      {/* 8. Data Trust & Provenance */}
      <section className={styles.trustSection}>
        <div className={styles.trustCard}>
          <span className={styles.sectionKicker}>Data Integrity &middot; Scientific Grounding</span>
          <h3 className={styles.trustTitle}>Honest Geospatial Data Attribution</h3>
          <p className={styles.trustDesc}>
            FloodNet runs on real MCGM drainage geometry, OpenStreetMap road networks, and a physics-based hydrodynamic
            solver. Every input — real, estimated, synthetic, or historical replay — is explicitly labeled by source
            and never presented as something it isn't.
          </p>
          <div className={styles.trustBadges}>
            <span className={styles.trustBadge}>ECMWF Open Data NWP</span>
            <span className={styles.trustBadge}>OpenStreetMap Mumbai Geometry</span>
            <span className={styles.trustBadge}>10m Digital Elevation Model</span>
            <span className={styles.trustBadge}>MCGM Stormwater Network Geometry</span>
          </div>
        </div>
      </section>

      {/* 9. Enter Control Centre CTA */}
      <section className={styles.ctaSection}>
        <div className={styles.ctaCard}>
          <h2 className={styles.ctaTitle}>Ready to inspect the forecast map?</h2>
          <p className={styles.ctaSubtitle}>
            Launch the live FloodNet Command Centre to view interactive street inundation, drainage flow, and emergency routing.
          </p>
          <button type="button" className={styles.enterBtnLarge} onClick={onEnter}>
            Enter Control Centre
            <span className={styles.arrowIcon}>&rarr;</span>
          </button>
        </div>
      </section>

      {/* 10. Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <span className={styles.footerBrand}>FloodNet</span>
          <span className={styles.footerTagline}>SIH26085 — Urban Flood Nowcasting System</span>
        </div>
        <div className={styles.footerRight}>
          Municipal Corporation of Greater Mumbai (MCGM) Pilot Environment &middot; All Rights Reserved
        </div>
      </footer>
    </div>
  )
}
