import { useState } from 'react'
import { FloodNetProvider } from './state/FloodNetContext.jsx'
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

// Right-rail tabs.  Overview and Alerts are always shown; the rest are
// secondary and collapse into the tab strip.  Tab keys are stable strings used
// as aria-controls / data attributes — do not change them.
const RIGHT_TABS = [
  { key: 'overview',   label: 'Overview' },
  { key: 'alerts',     label: 'Alerts'   },
  { key: 'why',        label: 'Why'      },
  { key: 'routing',    label: 'Route'    },
  { key: 'provenance', label: 'Sources'  },
]

function RightPanel() {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <aside className={`${styles.rightPanel} glass-panel`}>
      {/* Tab strip */}
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

      {/* Tab panels — rendered in DOM to preserve state; hidden when not active */}
      <div
        id="rtab-overview"
        role="tabpanel"
        aria-labelledby="rtab-btn-overview"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'overview' ? styles.tabPanelActive : ''}`}
      >
        <MetricsPanel />
        <AlertsPanel />
        <FloodedStreets />
      </div>

      <div
        id="rtab-alerts"
        role="tabpanel"
        aria-labelledby="rtab-btn-alerts"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'alerts' ? styles.tabPanelActive : ''}`}
      >
        <AlertsPanel />
        <MetricsPanel />
      </div>

      <div
        id="rtab-why"
        role="tabpanel"
        aria-labelledby="rtab-btn-why"
        className={`${styles.tabPanel} scroll-y ${activeTab === 'why' ? styles.tabPanelActive : ''}`}
      >
        <FloodedStreets />
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

function Dashboard() {
  return (
    <div className={styles.root}>
      <div className={styles.mapLayer}>
        <MapView />
      </div>

      <Header />

      <aside className={`${styles.leftPanel} glass-panel scroll-y`}>
        <ScenarioPanel />
        <LayerControl />
      </aside>

      <RightPanel />

      <ForecastTimeline />
      <NoticeBanner />
      <LoadingOverlay />
    </div>
  )
}

export default function App() {
  return (
    <FloodNetProvider>
      <Dashboard />
    </FloodNetProvider>
  )
}
