import { FloodNetProvider } from './state/FloodNetContext.jsx'
import Header from './components/Header/Header.jsx'
import MapView from './components/MapView/MapView.jsx'
import ScenarioPanel from './components/ScenarioPanel/ScenarioPanel.jsx'
import LayerControl from './components/LayerControl/LayerControl.jsx'
import MetricsPanel from './components/MetricsPanel/MetricsPanel.jsx'
import FloodedStreets from './components/FloodedStreets/FloodedStreets.jsx'
import WhyFloodedPanel from './components/WhyFloodedPanel/WhyFloodedPanel.jsx'
import RoutePlanner from './components/RoutePlanner/RoutePlanner.jsx'
import ProvenancePanel from './components/ProvenancePanel/ProvenancePanel.jsx'
import ForecastTimeline from './components/ForecastTimeline/ForecastTimeline.jsx'
import LoadingOverlay from './components/LoadingOverlay/LoadingOverlay.jsx'
import NoticeBanner from './components/NoticeBanner/NoticeBanner.jsx'
import styles from './App.module.css'

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

      <aside className={`${styles.rightPanel} glass-panel scroll-y`}>
        <MetricsPanel />
        <FloodedStreets />
        <WhyFloodedPanel />
        <RoutePlanner />
        <ProvenancePanel />
      </aside>

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
