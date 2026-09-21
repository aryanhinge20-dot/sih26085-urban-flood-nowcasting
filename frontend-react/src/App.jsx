import { Suspense, lazy, useState, useEffect, useCallback } from 'react'
import { FloodNetProvider, useFloodNet } from './state/FloodNetContext.jsx'
import LandingPage from './components/LandingPage/LandingPage.jsx'
import Header from './components/Header/Header.jsx'
import MapView from './components/MapView/MapView.jsx'
import ScenarioPanel from './components/ScenarioPanel/ScenarioPanel.jsx'
import LayerControl from './components/LayerControl/LayerControl.jsx'
import AlertsPanel from './components/AlertsPanel/AlertsPanel.jsx'
import MetricsPanel from './components/MetricsPanel/MetricsPanel.jsx'
import FloodedStreets from './components/FloodedStreets/FloodedStreets.jsx'
import WhyFloodedPanel from './components/WhyFloodedPanel/WhyFloodedPanel.jsx'
import RoutePlanner from './components/RoutePlanner/RoutePlanner.jsx'
import ProvenancePanel from './components/ProvenancePanel/ProvenancePanel.jsx'
import ForecastTimeline from './components/ForecastTimeline/ForecastTimeline.jsx'
import LoadingOverlay from './components/LoadingOverlay/LoadingOverlay.jsx'
import NoticeBanner from './components/NoticeBanner/NoticeBanner.jsx'
import GuidedBriefing from './components/GuidedBriefing/GuidedBriefing.jsx'
import StoryStrip from './components/StoryStrip/StoryStrip.jsx'
import HotspotsCard from './components/HotspotsCard/HotspotsCard.jsx'
import MapModeToggle from './components/Terrain3D/MapModeToggle.jsx'

// three.js is fetched only when 3D terrain is first opened
const Terrain3D = lazy(() => import('./components/Terrain3D/Terrain3D.jsx'))
import ExploreTour from './components/ExploreTour/ExploreTour.jsx'
import styles from './App.module.css'

// ─── Navigation ──────────────────────────────────────────────────────────────
//
// Architecture: Two views — landing (/) and dashboard (/dashboard).
// We use pushState/popstate so:
//   • scroll anchors on the landing page do NOT create history entries
//   • Back from dashboard → landing (one step, not through every anchor scroll)
//   • Refresh on dashboard → dashboard
//   • Refresh on landing → landing
//
// Detection: we look at window.location.pathname ending in /dashboard.
// When running under Vite's /static/ base path this still works because
// we always pushState to the same origin.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') // e.g. "/static"

function isDashboardPath() {
  return window.location.pathname.startsWith(BASE + '/dashboard')
}

// ─── Right rail tabs ──────────────────────────────────────────────────────────
const RIGHT_TABS = [
  { key: 'overview',   label: 'Overview'    },
  { key: 'alerts',     label: 'Alerts'      },
  { key: 'why',        label: 'Why flooded' },
  { key: 'routing',    label: 'Route'       },
  { key: 'provenance', label: 'Sources'     },
]

function RightPanel() {
  // The selected tab lives in Context (not local state) so a guided briefing can open the Alerts /
  // Why-flooded / Route tab as a narrated step without reaching into the DOM to click a tab button.
  // Rendering and behaviour are otherwise unchanged.
  const { activeRightTab: activeTab, setActiveRightTab: setActiveTab } = useFloodNet()

  return (
    <aside className={`${styles.rightPanel} glass-panel`} data-tour="right-panel">
      <div className={styles.tabStrip} role="tablist" aria-label="Right panel sections">
        {RIGHT_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            aria-controls={`rtab-${t.key}`}
            id={`rtab-btn-${t.key}`}
            className={`${styles.tabBtn} ${activeTab === t.key ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id="rtab-overview"
        role="tabpanel"
        aria-labelledby="rtab-btn-overview"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'overview' ? styles.tabPanelActive : ''}`}
      >
        <MetricsPanel />
        <HotspotsCard />
        <FloodedStreets />
      </div>

      <div
        id="rtab-alerts"
        role="tabpanel"
        aria-labelledby="rtab-btn-alerts"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'alerts' ? styles.tabPanelActive : ''}`}
      >
        <AlertsPanel />
      </div>

      <div
        id="rtab-why"
        role="tabpanel"
        aria-labelledby="rtab-btn-why"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'why' ? styles.tabPanelActive : ''}`}
      >
        <WhyFloodedPanel />
      </div>

      <div
        id="rtab-routing"
        role="tabpanel"
        aria-labelledby="rtab-btn-routing"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'routing' ? styles.tabPanelActive : ''}`}
      >
        <RoutePlanner />
      </div>

      <div
        id="rtab-provenance"
        role="tabpanel"
        aria-labelledby="rtab-btn-provenance"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'provenance' ? styles.tabPanelActive : ''}`}
      >
        <ProvenancePanel />
      </div>
    </aside>
  )
}

function MainApp() {
  const [view, setView] = useState(() =>
    isDashboardPath() ? 'dashboard' : 'landing'
  )
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Listen for popstate (Browser Back / Forward)
  useEffect(() => {
    const handlePop = () => {
      setView(isDashboardPath() ? 'dashboard' : 'landing')
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  const navigateToDashboard = useCallback(() => {
    setIsTransitioning(true)
    setTimeout(() => {
      if (!isDashboardPath()) {
        window.history.pushState({ view: 'dashboard' }, '', BASE + '/dashboard')
      }
      setView('dashboard')
      setIsTransitioning(false)
    }, 360)
  }, [])

  const navigateToLanding = useCallback(() => {
    if (isDashboardPath()) {
      window.history.pushState({ view: 'landing' }, '', BASE + '/')
    }
    setView('landing')
  }, [])

  // "Explore FloodNet" homepage tour. It starts on the landing page and then walks into the real control
  // centre, so its active flag lives here — the only component that owns view navigation.
  const [exploring, setExploring] = useState(false)
  // A "How FloodNet Works" card on the landing page opens that stage in the live dashboard.
  const [pendingStage, setPendingStage] = useState(null)
  // The tour's five tab steps need to open the real right-panel tabs; that selection lives in Context.
  const { setActiveRightTab, mapMode, setMapMode } = useFloodNet()

  return (
    <div className={view === 'landing' ? styles.landingContainer : styles.dashboardContainer}>
      {view === 'landing' ? (
        <LandingPage
          onEnter={navigateToDashboard}
          onExplore={() => setExploring(true)}
          onOpenStage={(id) => { setPendingStage(id); navigateToDashboard() }}
          isTransitioning={isTransitioning}
        />
      ) : (
        <div className={styles.root}>
          <div className={styles.mapLayer} data-tour="map">
            {/* Leaflet stays mounted (hidden) in 3D so returning to 2D restores the exact view */}
            <div className={styles.mapFill} style={mapMode === '3d' ? { visibility: 'hidden' } : undefined}>
              <MapView />
            </div>
            {mapMode === '3d' && (
              <Suspense fallback={<div className={styles.mapLoading}>Loading 3D terrain…</div>}>
                <Terrain3D onClose={() => setMapMode('2d')} />
              </Suspense>
            )}
          </div>
          <MapModeToggle />

          <Header onToggleHome={navigateToLanding} isHomeActive={false} />
          <StoryStrip openStage={pendingStage} onOpened={() => setPendingStage(null)} />

          <aside className={`${styles.leftPanel} glass-panel scroll-y`} data-tour="left-panel">
            <ScenarioPanel />
            <LayerControl />
          </aside>

          <RightPanel />

          <ForecastTimeline />
          <NoticeBanner />
          <GuidedBriefing />
          <LoadingOverlay />
        </div>
      )}

      <ExploreTour
        active={exploring}
        view={view}
        onGoDashboard={navigateToDashboard}
        onGoLanding={navigateToLanding}
        setTab={setActiveRightTab}
        onClose={() => setExploring(false)}
      />
    </div>
  )
}

export default function App() {
  return (
    <FloodNetProvider>
      <MainApp />
    </FloodNetProvider>
  )
}
