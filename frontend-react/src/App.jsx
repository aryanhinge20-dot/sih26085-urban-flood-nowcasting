import { useState, useEffect, useCallback } from 'react'
import { FloodNetProvider } from './state/FloodNetContext.jsx'
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
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <aside className={`${styles.rightPanel} glass-panel`}>
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

  return (
    <div className={view === 'landing' ? styles.landingContainer : styles.dashboardContainer}>
      {view === 'landing' ? (
        <LandingPage onEnter={navigateToDashboard} isTransitioning={isTransitioning} />
      ) : (
        <div className={styles.root}>
          <div className={styles.mapLayer}>
            <MapView />
          </div>

          <Header onToggleHome={navigateToLanding} isHomeActive={false} />

          <aside className={`${styles.leftPanel} glass-panel scroll-y`}>
            <ScenarioPanel />
            <LayerControl />
          </aside>

          <RightPanel />

          <ForecastTimeline />
          <NoticeBanner />
          <LoadingOverlay />
        </div>
      )}
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
