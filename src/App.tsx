import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import RaceControl from './pages/RaceControl';
import Cockpit from './pages/Cockpit';
import TrackSetup from './pages/TrackSetup';

function App() {
  return (
    <HashRouter>
      <Header />
      <main id="app-container" style={{ minHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/control" replace />} />
          <Route path="/control" element={<RaceControl />} />
          <Route path="/race" element={<Cockpit />} />
          <Route path="/setup" element={<TrackSetup />} />
        </Routes>
      </main>
    </HashRouter>
  );
}

export default App;
