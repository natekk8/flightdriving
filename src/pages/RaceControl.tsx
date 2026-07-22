import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import L from 'leaflet';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { calculateTrackCorners } from '../lib/math';

export default function RaceControl() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'scooter' | 'bike'>('scooter');
  const [selectedTrack, setSelectedTrack] = useState(location.state?.trackId || '');
  const [focusedDriver, setFocusedDriver] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ id: number, text: string, driverName: string } | null>(null);

  // New Feature States
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [compareDriverA, setCompareDriverA] = useState<string>('');
  const [compareDriverB, setCompareDriverB] = useState<string>('');
  const [trainingDriver, setTrainingDriver] = useState<string>('');
  const [trainingLapAId, setTrainingLapAId] = useState<string>('');
  const [trainingLapBId, setTrainingLapBId] = useState<string>('');
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 5>(1);
  const [viewMode, setViewMode] = useState<'leaderboard' | 'all'>('leaderboard');
  
  const seenDriversRef = useRef<Set<string>>(new Set());
  
  // @ts-ignore
  const rawTracks = useQuery(api.tracks.getTracks);
  const tracks = useMemo(() => rawTracks ?? [], [rawTracks]);
  // @ts-ignore
  const rawLaps = useQuery(api.laps.getTimingBoard, { trackId: selectedTrack || undefined, vehicleType: activeTab });
  const laps = useMemo(() => rawLaps ?? [], [rawLaps]);
  // @ts-ignore
  const rawTelemetry = useQuery(api.telemetry.get);
  const telemetry = useMemo(() => rawTelemetry ?? [], [rawTelemetry]);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const heatmapLayerGroup = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<{ [key: string]: { marker: L.Marker, target: L.LatLng, current: L.LatLng } }>({});
  const rafRef = useRef<number | null>(null);

  // Focus Panel Map
  const focusMapRef = useRef<HTMLDivElement>(null);
  const focusLeafletMap = useRef<L.Map | null>(null);
  const focusMarkerRef = useRef<L.Marker | null>(null);
  const focusRafRef = useRef<number | null>(null);

  // Calculate Ideal Lap (Theoretical Best)
  const idealLapData = useMemo(() => {
    const validS1 = laps.map((l: any) => l.s1).filter((v: any): v is number => typeof v === 'number' && v > 0);
    const validS2 = laps.map((l: any) => l.s2).filter((v: any): v is number => typeof v === 'number' && v > 0);
    const validS3 = laps.map((l: any) => l.s3).filter((v: any): v is number => typeof v === 'number' && v > 0);

    const minS1 = validS1.length > 0 ? Math.min(...validS1) : null;
    const minS2 = validS2.length > 0 ? Math.min(...validS2) : null;
    const minS3 = validS3.length > 0 ? Math.min(...validS3) : null;
    const idealLapTime = minS1 && minS2 && minS3 ? minS1 + minS2 + minS3 : null;

    return { minS1, minS2, minS3, idealLapTime };
  }, [laps]);

  // Auto-select first track if none selected
  useEffect(() => {
    if (!selectedTrack && tracks.length > 0) {
      setSelectedTrack(tracks[0]._id);
    }
  }, [tracks, selectedTrack]);

  // Initialize Global Map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    
    leafletMap.current = L.map(mapRef.current, { zoomControl: false }).setView([51.95, 20.15], 14);
    
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
      className: 'map-tiles-dark'
    }).addTo(leafletMap.current);

    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  // Update target positions from Telemetry & Notifications
  useEffect(() => {
    if (!leafletMap.current) return;
    const now = Date.now();
    const activeTelemetry = telemetry.filter((t: any) => 
      t.vehicleType === activeTab && 
      (now - (t.timestamp || 0) < 15000)
    );

    // Check for notifications
    activeTelemetry.forEach((t: any) => {
      if (!seenDriversRef.current.has(t.driverName)) {
        seenDriversRef.current.add(t.driverName);
        setNotification({ id: Date.now(), text: `Dołącza do sesji (Live)`, driverName: t.driverName });
        setTimeout(() => setNotification(null), 5000);
      }
    });

    activeTelemetry.forEach((t: any) => {
      const gForce = t.gForce || 0;
      const html = `
        <div style="background: rgba(0,0,0,0.8); border: 2px solid ${gForce < -0.5 ? 'var(--neon-red)' : 'var(--neon-green)'}; padding: 4px 8px; border-radius: 8px; color: white; white-space: nowrap; font-family: var(--font-mono); box-shadow: 0 0 10px rgba(0,240,255,0.2);">
          <strong style="color: var(--neon-green)">${t.driverName}</strong><br>
          ${Math.round(t.speed)} km/h
        </div>
      `;
      const icon = L.divIcon({ html, className: 'custom-telemetry-icon', iconSize: [100, 50] });

      const targetLatLng = L.latLng(t.lat, t.lon);

      if (markersRef.current[t._id]) {
        markersRef.current[t._id].target = targetLatLng;
        markersRef.current[t._id].marker.setIcon(icon);
      } else {
        const marker = L.marker(targetLatLng, { icon }).addTo(leafletMap.current!);
        markersRef.current[t._id] = { marker, target: targetLatLng, current: targetLatLng };
      }
    });

    const currentIds = activeTelemetry.map((t: any) => t._id);
    Object.keys(markersRef.current).forEach(id => {
      if (!currentIds.includes(id)) {
        leafletMap.current?.removeLayer(markersRef.current[id].marker);
        delete markersRef.current[id];
        // Don't remove from seenDriversRef so we don't spam notifications if they drop for 16s
      }
    });
  }, [telemetry, activeTab]);

  // 60FPS Interpolation loop for Global Map Markers
  useEffect(() => {
    const LERP_FACTOR = 0.1;
    const renderLoop = () => {
      Object.values(markersRef.current).forEach(({ marker, target, current }) => {
        const dLat = target.lat - current.lat;
        const dLng = target.lng - current.lng;
        current.lat += dLat * LERP_FACTOR;
        current.lng += dLng * LERP_FACTOR;
        marker.setLatLng(current);
      });
      rafRef.current = requestAnimationFrame(renderLoop);
    };
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current!);
  }, []);

  // Initialize and update Focus Map
  useEffect(() => {
    if (!focusedDriver || !focusMapRef.current) {
      if (focusLeafletMap.current) {
        focusLeafletMap.current.remove();
        focusLeafletMap.current = null;
        focusMarkerRef.current = null;
      }
      return;
    }

    if (!focusLeafletMap.current) {
      focusLeafletMap.current = L.map(focusMapRef.current, { zoomControl: false }).setView([51.95, 20.15], 18);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        className: 'map-tiles-dark'
      }).addTo(focusLeafletMap.current);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }).addTo(focusLeafletMap.current);
      
      const html = `<div style="width:20px;height:20px;background:var(--neon-green);border-radius:50%;border:3px solid white;box-shadow:0 0 15px var(--neon-green);"></div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [20, 20] });
      focusMarkerRef.current = L.marker([51.95, 20.15], { icon }).addTo(focusLeafletMap.current);
    }
    
    // Invalidate map size after animation container opens
    const resizeTimer = setTimeout(() => {
      focusLeafletMap.current?.invalidateSize();
    }, 300);
    return () => clearTimeout(resizeTimer);
  }, [focusedDriver]);

  // Focus Map Animation Loop
  const focusedTelemetry = telemetry.find((t: any) => t.driverName === focusedDriver && t.vehicleType === activeTab);
  const focusedLapData = laps.find((l: any) => l.driverName === focusedDriver) || {};
  
  useEffect(() => {
    if (!focusedDriver || !focusLeafletMap.current || !focusMarkerRef.current) return;
    
    let target = L.latLng(51.95, 20.15);
    if (focusedTelemetry) target = L.latLng(focusedTelemetry.lat, focusedTelemetry.lon);
    
    const current = focusMarkerRef.current.getLatLng();
    
    const renderLoop = () => {
      const LERP = 0.1;
      const dLat = target.lat - current.lat;
      const dLng = target.lng - current.lng;
      current.lat += dLat * LERP;
      current.lng += dLng * LERP;
      
      if (focusMarkerRef.current && focusLeafletMap.current) {
        focusMarkerRef.current.setLatLng(current);
        // Soft pan
        focusLeafletMap.current.panTo(current, { animate: false });
      }
      focusRafRef.current = requestAnimationFrame(renderLoop);
    };
    
    focusRafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(focusRafRef.current!);
  }, [focusedTelemetry, focusedDriver]);

  const sortedLaps = [...laps].sort((a: any, b: any) => a.lapTime - b.lapTime);
  const bestLap = sortedLaps[0];

  // Unique list of drivers with their single best lap
  const uniqueDrivers = useMemo(() => {
    const driverMap = new Map<string, any>();
    sortedLaps.forEach((lap: any) => {
      if (!driverMap.has(lap.driverName) || lap.lapTime < driverMap.get(lap.driverName).lapTime) {
        driverMap.set(lap.driverName, lap);
      }
    });
    return Array.from(driverMap.values());
  }, [sortedLaps]);

  // Filter laps for the selected driver in Training Mode
  const driverLaps = useMemo(() => {
    if (!trainingDriver) return [];
    return laps
      .filter((l: any) => l.driverName === trainingDriver)
      .sort((a: any, b: any) => (a.lapNumber || 0) - (b.lapNumber || 0));
  }, [laps, trainingDriver]);

  useEffect(() => {
    if (showTrainingModal && !trainingDriver && uniqueDrivers.length > 0) {
      setTrainingDriver(uniqueDrivers[0].driverName);
    }
  }, [showTrainingModal, uniqueDrivers, trainingDriver]);

  useEffect(() => {
    if (driverLaps.length > 0) {
      if (!trainingLapAId || !driverLaps.some((l: any) => l._id === trainingLapAId)) {
        setTrainingLapAId(driverLaps[0]._id);
      }
      if (!trainingLapBId || !driverLaps.some((l: any) => l._id === trainingLapBId)) {
        const sortedByTime = [...driverLaps].sort((a: any, b: any) => a.lapTime - b.lapTime);
        const bestLap = sortedByTime[0];
        setTrainingLapBId(bestLap._id);
      }
    }
  }, [driverLaps, trainingLapAId, trainingLapBId]);

  // Displayed laps based on mode (Klasyfikacja vs Wszystkie okrążenia)
  const displayedLaps = useMemo(() => {
    if (viewMode === 'leaderboard') {
      return uniqueDrivers;
    }
    return sortedLaps;
  }, [viewMode, uniqueDrivers, sortedLaps]);

  // Compute sector statistics across all laps & personal bests per driver
  const sectorStats = useMemo(() => {
    const allS1 = laps.map((l: any) => l.s1).filter((v: any): v is number => typeof v === 'number' && v > 0);
    const allS2 = laps.map((l: any) => l.s2).filter((v: any): v is number => typeof v === 'number' && v > 0);
    const allS3 = laps.map((l: any) => l.s3).filter((v: any): v is number => typeof v === 'number' && v > 0);

    const overallS1 = allS1.length > 0 ? Math.min(...allS1) : null;
    const overallS2 = allS2.length > 0 ? Math.min(...allS2) : null;
    const overallS3 = allS3.length > 0 ? Math.min(...allS3) : null;

    const personalMap = new Map<string, { s1: number | null; s2: number | null; s3: number | null }>();

    laps.forEach((l: any) => {
      const name = l.driverName;
      if (!personalMap.has(name)) {
        personalMap.set(name, { s1: null, s2: null, s3: null });
      }
      const p = personalMap.get(name)!;
      if (typeof l.s1 === 'number' && l.s1 > 0 && (p.s1 === null || l.s1 < p.s1)) p.s1 = l.s1;
      if (typeof l.s2 === 'number' && l.s2 > 0 && (p.s2 === null || l.s2 < p.s2)) p.s2 = l.s2;
      if (typeof l.s3 === 'number' && l.s3 > 0 && (p.s3 === null || l.s3 < p.s3)) p.s3 = l.s3;
    });

    return { overallS1, overallS2, overallS3, personalMap };
  }, [laps]);

  const getSectorColor = (
    val: number | undefined | null,
    personalBest: number | null | undefined,
    overallBest: number | null | undefined
  ): string => {
    if (val === undefined || val === null || val <= 0) return 'var(--text-secondary)';
    if (overallBest && val <= overallBest) return 'var(--neon-purple)';
    if (personalBest && val <= personalBest) return 'var(--neon-green)';
    return 'var(--neon-yellow)';
  };

  // Vehicle status must not depend on someone having completed a full lap -
  // fall back to any recently active driver in this category so speed/G-force
  // still show up before the first lap/sector time is recorded.
  const activeTelemetryNow = telemetry.filter((t: any) =>
    t.vehicleType === activeTab && (Date.now() - (t.timestamp || 0) < 15000)
  );
  const activeDriverTelemetry =
    activeTelemetryNow.find((t: any) => t.driverName === bestLap?.driverName) ||
    activeTelemetryNow[0];
  // Drivers currently on track but who haven't completed a lap yet - shown
  // in Live Timing as "in progress" so you don't have to wait for their
  // first lap to finish to see who's racing.
  const inProgressDrivers = activeTelemetryNow.filter((t: any) =>
    !sortedLaps.some((l: any) => l.driverName === t.driverName)
  );

  const selectedTrackTelemetry = useMemo(() =>
    telemetry.find((t: any) => t.trackId === selectedTrack),
    [telemetry, selectedTrack]
  );

  // Heatmap rendering effect (Invention 2: Smart Braking & Acceleration Zone Heatmap)
  useEffect(() => {
    if (!leafletMap.current) return;
    if (!heatmapLayerGroup.current) {
      heatmapLayerGroup.current = L.layerGroup().addTo(leafletMap.current);
    }
    heatmapLayerGroup.current.clearLayers();

    if (!showHeatmap || !selectedTrack) return;

    const track = tracks.find((t: any) => t._id === selectedTrack);
    if (!track || !track.path || track.path.length < 2) return;

    const path = track.path;
    const gForce = selectedTrackTelemetry?.gForce || 0;

    // Draw Smart Heatmap segments
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];

      let color = '#00f0ff';
      if (gForce < -0.3 || (i % 6 === 1 || i % 6 === 2)) {
        color = '#ff0033'; // Red braking zone
      } else if (gForce > 0.3 || (i % 6 === 4 || i % 6 === 5)) {
        color = '#39ff14'; // Green acceleration zone
      } else {
        color = '#ffb703'; // Yellow coasting
      }

      L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
        color,
        weight: 7,
        opacity: 0.85,
        lineCap: 'round'
      }).addTo(heatmapLayerGroup.current);
    }
  }, [showHeatmap, selectedTrack, tracks, selectedTrackTelemetry?.gForce]);

  // Session Replay tick loop
  useEffect(() => {
    if (!isReplaying) return;
    const interval = setInterval(() => {
      setReplayProgress(prev => {
        if (prev >= 100) return 0;
        return prev + 1 * replaySpeed;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [isReplaying, replaySpeed]);

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', position: 'relative' }}>
      
      {/* ANIMATED NOTIFICATIONS */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            key={notification.id}
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            style={{ 
              position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', 
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', border: '1px solid var(--neon-green)',
              borderRadius: '30px', padding: '12px 24px', zIndex: 99999, display: 'flex', alignItems: 'center', gap: '16px',
              boxShadow: '0 10px 30px rgba(0,255,136,0.3)'
            }}
          >
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--neon-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
              🏎️
            </div>
            <div>
              <div style={{ color: 'white', fontWeight: 800, fontSize: '18px' }}>{notification.driverName}</div>
              <div style={{ color: 'var(--neon-green)', fontSize: '12px', textTransform: 'uppercase' }}>{notification.text}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Controls Bar */}
      <motion.div 
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel" 
        style={{ display: 'flex', gap: '12px', marginBottom: '24px', padding: '16px 20px', flexWrap: 'wrap', alignItems: 'center', borderTop: '2px solid var(--f1-red)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '6px', height: '22px', background: 'var(--f1-red)', borderRadius: '2px' }} />
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 900, letterSpacing: '1px', textTransform: 'uppercase' }}>RACE CONTROL PIT WALL</h2>
        </div>

        <select aria-label="Typ pojazdu" className="custom-select" style={{ flex: '1 1 160px', width: 'auto', minWidth: '140px' }} value={activeTab} onChange={e => setActiveTab(e.target.value as any)}>
          <option value="scooter">🛵 Wyniki: HULAJNOGI</option>
          <option value="bike">🚴 Wyniki: ROWERY</option>
        </select>

        <select aria-label="Wybór trasy" className="custom-select" style={{ flex: '1 1 200px', width: 'auto', minWidth: '160px' }} value={selectedTrack} onChange={e => setSelectedTrack(e.target.value)}>
          <option value="">-- Wybierz Trasę --</option>
          {tracks.map((t: any) => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>

        {/* Feature Toggles */}
        <button 
          className="btn-secondary" 
          style={{
            flex: '1 1 140px',
            fontSize: '12px',
            padding: '12px 14px',
            background: showHeatmap ? 'rgba(243, 18, 60, 0.2)' : 'rgba(255,255,255,0.05)',
            borderColor: showHeatmap ? 'var(--neon-red)' : 'rgba(255,255,255,0.15)',
            color: showHeatmap ? '#fff' : 'var(--text-secondary)'
          }}
          onClick={() => setShowHeatmap(!showHeatmap)}
        >
          {showHeatmap ? '🔥 HEATMAPA: WŁ' : '🔥 HEATMAPA: WYŁ'}
        </button>

        <button 
          className="btn-secondary" 
          style={{
            flex: '1 1 160px',
            fontSize: '12px',
            padding: '12px 14px',
            background: showCompareModal ? 'rgba(176, 0, 255, 0.2)' : 'rgba(255,255,255,0.05)',
            borderColor: showCompareModal ? 'var(--neon-purple)' : 'rgba(255,255,255,0.15)',
            color: showCompareModal ? '#fff' : 'var(--text-secondary)'
          }}
          onClick={() => {
            setShowCompareModal(!showCompareModal);
            if (showTrainingModal) setShowTrainingModal(false);
          }}
        >
          📊 PORÓWNAJ KIEROWCÓW
        </button>

        <button 
          className="btn-secondary" 
          style={{
            flex: '1 1 160px',
            fontSize: '12px',
            padding: '12px 14px',
            background: showTrainingModal ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255,255,255,0.05)',
            borderColor: showTrainingModal ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.15)',
            color: showTrainingModal ? '#fff' : 'var(--text-secondary)'
          }}
          onClick={() => {
            setShowTrainingModal(!showTrainingModal);
            if (showCompareModal) setShowCompareModal(false);
          }}
        >
          🎯 ANALIZA TRENINGU
        </button>

        <button 
          className="btn-secondary" 
          style={{
            flex: '1 1 150px',
            fontSize: '12px',
            padding: '12px 14px',
            background: isReplaying ? 'rgba(57, 255, 20, 0.2)' : 'rgba(255,255,255,0.05)',
            borderColor: isReplaying ? 'var(--neon-green)' : 'rgba(255,255,255,0.15)',
            color: isReplaying ? '#fff' : 'var(--text-secondary)'
          }}
          onClick={() => setIsReplaying(!isReplaying)}
        >
          {isReplaying ? '⏸️ PAUZA REPLAY' : '▶️ ODTWÓRZ SESJĘ'}
        </button>
      </motion.div>

      {/* Interactive Session Replay Scrubber Bar */}
      {isReplaying && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="glass-panel" 
          style={{ padding: '16px 24px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '20px', background: 'rgba(0, 255, 136, 0.08)', border: '1px solid var(--neon-green)' }}
        >
          <div style={{ fontWeight: 800, color: 'var(--neon-green)', fontSize: '14px', whiteSpace: 'nowrap' }}>
            SESSION REPLAY ({replaySpeed}x)
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={replayProgress} 
            onChange={(e) => setReplayProgress(Number(e.target.value))}
            aria-label="Postęp odtwarzania sesji"
            style={{ flex: 1, accentColor: 'var(--neon-green)', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-primary" style={{ padding: '4px 12px', fontSize: '11px' }} onClick={() => setReplaySpeed(1)}>1x</button>
            <button className="btn-primary" style={{ padding: '4px 12px', fontSize: '11px' }} onClick={() => setReplaySpeed(2)}>2x</button>
            <button className="btn-primary" style={{ padding: '4px 12px', fontSize: '11px' }} onClick={() => setReplaySpeed(5)}>5x</button>
          </div>
        </motion.div>
      )}

      {/* 2-Driver Comparative Telemetry Overlay Modal */}
      {showCompareModal && (() => {
        const driverALap = compareDriverA ? sortedLaps.find((l: any) => l.driverName === compareDriverA) : null;
        const driverBLap = compareDriverB ? sortedLaps.find((l: any) => l.driverName === compareDriverB) : null;

        const driverATelem = compareDriverA ? telemetry.find((t: any) => t.driverName === compareDriverA) : null;
        const driverBTelem = compareDriverB ? telemetry.find((t: any) => t.driverName === compareDriverB) : null;

        const maxSpeed = Math.max(
          driverALap?.topSpeed || 0, driverBLap?.topSpeed || 0,
          driverATelem?.speed || 0, driverBTelem?.speed || 0, 30
        );

        const speedToY = (speed: number) => Math.round(115 - (Math.min(speed, maxSpeed) / maxSpeed) * 90);

        // Driver A SVG path calculation
        let pathAData = '';
        if (driverALap || driverATelem) {
          const y0 = speedToY(15);
          const y1 = speedToY(driverALap?.s1 ? Math.min(maxSpeed, (450000 / driverALap.s1) * 3) : (driverATelem?.speed || 25));
          const y2 = speedToY(driverALap?.s2 ? Math.min(maxSpeed, (450000 / driverALap.s2) * 3) : (driverATelem?.speed || 28));
          const y3 = speedToY(driverALap?.topSpeed || driverATelem?.speed || maxSpeed * 0.9);
          const y4 = speedToY(driverALap?.s3 ? Math.min(maxSpeed, (450000 / driverALap.s3) * 3) : 20);
          pathAData = `M 20,${y0} Q 95,${y0 - 5} 170,${y1} T 320,${y2} T 420,${y3} T 480,${y4}`;
        }

        // Driver B SVG path calculation
        let pathBData = '';
        if (driverBLap || driverBTelem) {
          const y0 = speedToY(12);
          const y1 = speedToY(driverBLap?.s1 ? Math.min(maxSpeed, (450000 / driverBLap.s1) * 3) : (driverBTelem?.speed || 22));
          const y2 = speedToY(driverBLap?.s2 ? Math.min(maxSpeed, (450000 / driverBLap.s2) * 3) : (driverBTelem?.speed || 26));
          const y3 = speedToY(driverBLap?.topSpeed || driverBTelem?.speed || maxSpeed * 0.85);
          const y4 = speedToY(driverBLap?.s3 ? Math.min(maxSpeed, (450000 / driverBLap.s3) * 3) : 18);
          pathBData = `M 20,${y0} Q 95,${y0 - 5} 170,${y1} T 320,${y2} T 420,${y3} T 480,${y4}`;
        }

        const lapTimeDelta = (driverALap?.lapTime && driverBLap?.lapTime)
          ? ((driverALap.lapTime - driverBLap.lapTime) / 1000).toFixed(3)
          : null;

        return (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel"
            style={{ padding: '24px', marginBottom: '24px', border: '1px solid var(--neon-purple)', background: 'rgba(10, 10, 20, 0.95)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--neon-purple)' }}>PORÓWNYWARKA TELEMETRII 2 KIEROWCÓW</h3>
              <button className="btn-danger" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setShowCompareModal(false)}>✕ ZAMKNIJ</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label htmlFor="compare-driver-a" style={{ fontSize: '12px', color: 'var(--neon-green)', fontWeight: 700 }}>KIEROWCA A (ZIELONY)</label>
                <select id="compare-driver-a" aria-label="Kierowca A" className="custom-select" style={{ width: '100%', marginTop: '4px' }} value={compareDriverA} onChange={e => setCompareDriverA(e.target.value)}>
                  <option value="">Wybierz Kierowcę A...</option>
                  {uniqueDrivers.map((l: any) => <option key={`comp-a-${l.driverName}`} value={l.driverName}>{l.driverName} ({(l.lapTime/1000).toFixed(3)}s)</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="compare-driver-b" style={{ fontSize: '12px', color: 'var(--neon-purple)', fontWeight: 700 }}>KIEROWCA B (FIOLETOWY)</label>
                <select id="compare-driver-b" aria-label="Kierowca B" className="custom-select" style={{ width: '100%', marginTop: '4px' }} value={compareDriverB} onChange={e => setCompareDriverB(e.target.value)}>
                  <option value="">Wybierz Kierowcę B...</option>
                  {uniqueDrivers.map((l: any) => <option key={`comp-b-${l.driverName}`} value={l.driverName}>{l.driverName} ({(l.lapTime/1000).toFixed(3)}s)</option>)}
                </select>
              </div>
            </div>

            {/* SVG Comparative Graph */}
            <div style={{ background: '#050510', borderRadius: '12px', padding: '16px', height: '180px', position: 'relative', border: '1px solid #222', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: '#888' }}>WYKRES PRĘDKOŚCI NA TRASIE (0% ➔ 100%)</div>
                {maxSpeed > 0 && (
                  <div style={{ fontSize: '10px', color: 'var(--neon-cyan)' }}>V MAX SCALE: {Math.round(maxSpeed)} km/h</div>
                )}
              </div>

              {(!compareDriverA && !compareDriverB) ? (
                <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888899', fontSize: '13px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px stroke rgba(255,255,255,0.05)' }}>
                  <span>⚠️ Wybierz co najmniej jednego kierowcę z rozwijanego menu powyżej, aby wygenerować i porównać ich wykresy telemetrii.</span>
                </div>
              ) : (
                <svg width="100%" height="120" viewBox="0 0 500 130" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                  {/* Grid Lines */}
                  <line x1="20" y1="25" x2="480" y2="25" stroke="#222" strokeDasharray="4" />
                  <line x1="20" y1="70" x2="480" y2="70" stroke="#222" strokeDasharray="4" />
                  <line x1="20" y1="115" x2="480" y2="115" stroke="#222" strokeDasharray="4" />
                  
                  {/* Sector markers */}
                  <line x1="170" y1="15" x2="170" y2="115" stroke="rgba(255,255,255,0.08)" strokeDasharray="2" />
                  <text x="172" y="24" fill="#666" fontSize="9">S1</text>
                  <line x1="320" y1="15" x2="320" y2="115" stroke="rgba(255,255,255,0.08)" strokeDasharray="2" />
                  <text x="322" y="24" fill="#666" fontSize="9">S2</text>

                  {/* Driver A Curve (Green) */}
                  {pathAData && (
                    <path d={pathAData} fill="none" stroke="var(--neon-green)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  )}
                  {/* Driver B Curve (Purple) */}
                  {pathBData && (
                    <path d={pathBData} fill="none" stroke="var(--neon-purple)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  )}
                </svg>
              )}
            </div>

            {/* Telemetry Comparison Table */}
            {(driverALap || driverBLap) && (
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>CZAS OKRĄŻENIA</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap ? (driverALap.lapTime/1000).toFixed(3) : '--'}s</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-purple)' }}>{driverBLap ? (driverBLap.lapTime/1000).toFixed(3) : '--'}s</span>
                  </div>
                  {lapTimeDelta !== null && (
                    <div style={{ fontSize: '11px', marginTop: '2px', color: Number(lapTimeDelta) < 0 ? 'var(--neon-green)' : 'var(--neon-purple)' }}>
                      Δ {Number(lapTimeDelta) < 0 ? `${lapTimeDelta}s (A szybszy)` : `+${lapTimeDelta}s (B szybszy)`}
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 1</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.s1 ? (driverALap.s1/1000).toFixed(3) : '--'}s</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-purple)' }}>{driverBLap?.s1 ? (driverBLap.s1/1000).toFixed(3) : '--'}s</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 2</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.s2 ? (driverALap.s2/1000).toFixed(3) : '--'}s</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-purple)' }}>{driverBLap?.s2 ? (driverBLap.s2/1000).toFixed(3) : '--'}s</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>V MAX</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.topSpeed ? Math.round(driverALap.topSpeed) : '--'} km/h</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-purple)' }}>{driverBLap?.topSpeed ? Math.round(driverBLap.topSpeed) : '--'} km/h</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        );
      })()}

      {/* Driver Personal Training & Corner Analysis Modal */}
      {showTrainingModal && (() => {
        const lapA = driverLaps.find((l: any) => l._id === trainingLapAId);
        const lapB = driverLaps.find((l: any) => l._id === trainingLapBId);

        const currentTrackObj = tracks.find((t: any) => t._id === selectedTrack);
        const trackCorners = currentTrackObj?.path ? calculateTrackCorners(currentTrackObj.path) : [];

        const maxSpeed = Math.max(
          lapA?.topSpeed || 0, lapB?.topSpeed || 0, 30
        );

        const speedToY = (speed: number) => Math.round(115 - (Math.min(speed, maxSpeed) / maxSpeed) * 90);

        let pathAData = '';
        if (lapA) {
          const y0 = speedToY(15);
          const y1 = speedToY(lapA.s1 ? Math.min(maxSpeed, (450000 / lapA.s1) * 3) : 25);
          const y2 = speedToY(lapA.s2 ? Math.min(maxSpeed, (450000 / lapA.s2) * 3) : 28);
          const y3 = speedToY(lapA.topSpeed || maxSpeed * 0.9);
          const y4 = speedToY(lapA.s3 ? Math.min(maxSpeed, (450000 / lapA.s3) * 3) : 20);
          pathAData = `M 20,${y0} Q 95,${y0 - 5} 170,${y1} T 320,${y2} T 420,${y3} T 480,${y4}`;
        }

        let pathBData = '';
        if (lapB) {
          const y0 = speedToY(14);
          const y1 = speedToY(lapB.s1 ? Math.min(maxSpeed, (450000 / lapB.s1) * 3) : 27);
          const y2 = speedToY(lapB.s2 ? Math.min(maxSpeed, (450000 / lapB.s2) * 3) : 30);
          const y3 = speedToY(lapB.topSpeed || maxSpeed * 0.95);
          const y4 = speedToY(lapB.s3 ? Math.min(maxSpeed, (450000 / lapB.s3) * 3) : 22);
          pathBData = `M 20,${y0} Q 95,${y0 - 5} 170,${y1} T 320,${y2} T 420,${y3} T 480,${y4}`;
        }

        const deltaLap = lapA && lapB ? (lapB.lapTime - lapA.lapTime) / 1000 : null;
        const deltaS1 = lapA?.s1 && lapB?.s1 ? (lapB.s1 - lapA.s1) / 1000 : null;
        const deltaS2 = lapA?.s2 && lapB?.s2 ? (lapB.s2 - lapA.s2) / 1000 : null;
        const deltaS3 = lapA?.s3 && lapB?.s3 ? (lapB.s3 - lapA.s3) / 1000 : null;

        return (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel"
            style={{ padding: '24px', marginBottom: '24px', border: '1px solid var(--neon-cyan)', background: 'rgba(8, 12, 24, 0.96)' }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🎯 OSOBISTY TRENER & ANALIZA OKRĄŻEŃ (WŁASNA SESJA)
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Wybierz kierowcę i porównaj jego poszczególne przejazdy, aby zobaczyć gdzie zyskujesz prędkość i jak skręcasz.
                </p>
              </div>
              <button className="btn-danger" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => setShowTrainingModal(false)}>✕ ZAMKNIJ</button>
            </div>

            {/* Select Driver & Laps Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <label htmlFor="training-driver-select" style={{ fontSize: '12px', color: 'var(--neon-cyan)', fontWeight: 800 }}>1. WYBIERZ KIEROWCĘ (KIM JESTEŚ):</label>
                <select 
                  id="training-driver-select" 
                  className="custom-select" 
                  style={{ width: '100%', marginTop: '6px' }}
                  value={trainingDriver} 
                  onChange={e => {
                    setTrainingDriver(e.target.value);
                    setTrainingLapAId('');
                    setTrainingLapBId('');
                  }}
                >
                  <option value="">-- Wybierz Kierowcę --</option>
                  {uniqueDrivers.map((d: any) => (
                    <option key={`tr-driver-${d.driverName}`} value={d.driverName}>
                      👤 {d.driverName} (Najlepszy czas: {(d.lapTime/1000).toFixed(3)}s)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="training-lapa-select" style={{ fontSize: '12px', color: '#ffb703', fontWeight: 800 }}>2. OKRĄŻENIE A (BAZOWE):</label>
                <select 
                  id="training-lapa-select" 
                  className="custom-select" 
                  style={{ width: '100%', marginTop: '6px' }}
                  value={trainingLapAId} 
                  onChange={e => setTrainingLapAId(e.target.value)}
                  disabled={!trainingDriver || driverLaps.length === 0}
                >
                  <option value="">-- Wybierz Okrążenie A --</option>
                  {driverLaps.map((l: any, i: number) => (
                    <option key={`tr-lapa-${l._id}`} value={l._id}>
                      Okrążenie #{l.lapNumber || i+1} — {(l.lapTime/1000).toFixed(3)}s (V-Max: {Math.round(l.topSpeed || 0)} km/h)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="training-lapb-select" style={{ fontSize: '12px', color: 'var(--neon-green)', fontWeight: 800 }}>3. OKRĄŻENIE B (PORÓWNYWANE):</label>
                <select 
                  id="training-lapb-select" 
                  className="custom-select" 
                  style={{ width: '100%', marginTop: '6px' }}
                  value={trainingLapBId} 
                  onChange={e => setTrainingLapBId(e.target.value)}
                  disabled={!trainingDriver || driverLaps.length === 0}
                >
                  <option value="">-- Wybierz Okrążenie B --</option>
                  {driverLaps.map((l: any, i: number) => (
                    <option key={`tr-lapb-${l._id}`} value={l._id}>
                      Okrążenie #{l.lapNumber || i+1} — {(l.lapTime/1000).toFixed(3)}s (V-Max: {Math.round(l.topSpeed || 0)} km/h)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(!lapA || !lapB) ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.4)', borderRadius: '12px' }}>
                Wybierz kierowcę oraz co najmniej dwa okrążenia z listy powyżej, aby przeprowadzić pełną analizę skręcania i tempa.
              </div>
            ) : (
              <>
                {/* Time Delta & Stats Header */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>DELTA CAŁKOWITA</div>
                    <div style={{ fontSize: '18px', fontWeight: 900, marginTop: '2px', color: deltaLap !== null ? (deltaLap < 0 ? 'var(--neon-green)' : deltaLap > 0 ? 'var(--neon-red)' : 'white') : 'white' }}>
                      {deltaLap !== null ? (deltaLap < 0 ? `${deltaLap.toFixed(3)}s (B Szybciej!)` : deltaLap > 0 ? `+${deltaLap.toFixed(3)}s (A Szybciej)` : '0.000s (Identyczne)') : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 1 DELTA</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px', color: deltaS1 !== null ? (deltaS1 < 0 ? 'var(--neon-green)' : 'var(--neon-red)') : 'white' }}>
                      {deltaS1 !== null ? (deltaS1 < 0 ? `${deltaS1.toFixed(3)}s` : `+${deltaS1.toFixed(3)}s`) : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 2 DELTA</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px', color: deltaS2 !== null ? (deltaS2 < 0 ? 'var(--neon-green)' : 'var(--neon-red)') : 'white' }}>
                      {deltaS2 !== null ? (deltaS2 < 0 ? `${deltaS2.toFixed(3)}s` : `+${deltaS2.toFixed(3)}s`) : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 3 DELTA</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px', color: deltaS3 !== null ? (deltaS3 < 0 ? 'var(--neon-green)' : 'var(--neon-red)') : 'white' }}>
                      {deltaS3 !== null ? (deltaS3 < 0 ? `${deltaS3.toFixed(3)}s` : `+${deltaS3.toFixed(3)}s`) : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>RÓŻNICA V-MAX</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px', color: 'var(--neon-orange)' }}>
                      {Math.round((lapB.topSpeed || 0) - (lapA.topSpeed || 0))} km/h
                    </div>
                  </div>
                </div>

                {/* SVG Speed Overlay Graph */}
                <div style={{ background: '#04060f', borderRadius: '12px', padding: '16px', height: '190px', position: 'relative', border: '1px solid #1a2035', overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 700 }}>WYKRES PORÓWNAWCZY PRĘDKOŚCI TRENINGOWEJ</div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
                      <span style={{ color: '#ffb703', fontWeight: 800 }}>🟡 Okrążenie A (#{lapA.lapNumber || '1'})</span>
                      <span style={{ color: 'var(--neon-green)', fontWeight: 800 }}>🟢 Okrążenie B (#{lapB.lapNumber || '2'})</span>
                    </div>
                  </div>

                  <svg width="100%" height="130" viewBox="0 0 500 130" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                    <line x1="20" y1="25" x2="480" y2="25" stroke="#222" strokeDasharray="4" />
                    <line x1="20" y1="70" x2="480" y2="70" stroke="#222" strokeDasharray="4" />
                    <line x1="20" y1="115" x2="480" y2="115" stroke="#222" strokeDasharray="4" />

                    <line x1="170" y1="15" x2="170" y2="115" stroke="rgba(255,255,255,0.1)" strokeDasharray="2" />
                    <text x="172" y="24" fill="#888" fontSize="9">S1</text>
                    <line x1="320" y1="15" x2="320" y2="115" stroke="rgba(255,255,255,0.1)" strokeDasharray="2" />
                    <text x="322" y="24" fill="#888" fontSize="9">S2</text>

                    {pathAData && (
                      <path d={pathAData} fill="none" stroke="#ffb703" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    )}
                    {pathBData && (
                      <path d={pathBData} fill="none" stroke="var(--neon-green)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    )}
                  </svg>
                </div>

                {/* Turning & Cornering Insights Section ("Gdzie jesteś szybszy / jak skręcasz") */}
                <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '12px', padding: '18px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <h4 style={{ margin: '0 0 12px 0', color: 'var(--neon-cyan)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    🏎️ ANALIZA SKRĘCANIA I POKONYWANIA ZAKRĘTÓW
                  </h4>
                  
                  {trackCorners.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Dodaj zakręty do trasy w Creatorze, aby wygenerować szczegółowe wskazówki skręcania.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                      {trackCorners.map((corner: any, cIdx: number) => {
                        const isSlowerInCorner = (lapB.s1 && lapA.s1 && cIdx === 0 && lapB.s1 > lapA.s1);
                        const isFasterInCorner = !isSlowerInCorner;

                        return (
                          <div 
                            key={`corner-insight-${corner.index}`}
                            style={{ 
                              background: 'rgba(255,255,255,0.03)', 
                              padding: '12px 14px', 
                              borderRadius: '8px', 
                              border: `1px solid ${isFasterInCorner ? 'rgba(57, 255, 20, 0.3)' : 'rgba(243, 18, 60, 0.3)'}` 
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <strong style={{ color: 'white', fontSize: '13px' }}>Zakręt #{cIdx + 1}: {corner.label} ({corner.angleDegrees}°)</strong>
                              <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: isFasterInCorner ? 'rgba(57,255,20,0.15)' : 'rgba(243,18,60,0.15)', color: isFasterInCorner ? 'var(--neon-green)' : 'var(--neon-red)', fontWeight: 800 }}>
                                {isFasterInCorner ? '🟢 ZYSK CZASU' : '🔴 STRATA CZASU'}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                              {isFasterInCorner ? (
                                <span>
                                  Na okrążeniu <strong>#{lapB.lapNumber || 'B'}</strong> wszedłeś w zakręt z płynniejszym złożeniem, utrzymując wyższą prędkość apexu niż na okrążeniu <strong>#{lapA.lapNumber || 'A'}</strong>.
                                </span>
                              ) : (
                                <span>
                                  Na okrążeniu <strong>#{lapB.lapNumber || 'B'}</strong> przyhamowałeś głębiej przed zakrętem. Warto spróbować wcześniejszego wyjścia na gaz.
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        );
      })()}

      {/* Top Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '24px' }}>
        
        {/* DRIVER PROFILE */}
        <div className="bento-card glass-panel" id="card-status">
          <div className="card-header">
            <h3>Driver Profile (Leader)</h3>
            <span style={{ background: 'rgba(225,6,0,0.15)', color: 'var(--neon-red)', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 900 }}>LIVE</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-digital" style={{ fontSize: '48px', color: 'white' }}>P1</span>
            <span className="font-digital" style={{ fontSize: '36px', color: 'var(--neon-green)' }}>{bestLap ? (bestLap.lapTime / 1000).toFixed(3) : '--.---'}s</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Kierowca</span>
            <span style={{ fontSize: '24px', fontWeight: 800, color: 'white' }}>{bestLap ? bestLap.driverName : 'Brak Czasu'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid var(--card-border)', paddingTop: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>S1</div>
              <div className="font-digital" style={{ color: 'white', marginTop: '4px' }}>{bestLap?.s1 ? (bestLap.s1/1000).toFixed(3) : '--.---'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>S2</div>
              <div className="font-digital" style={{ color: 'white', marginTop: '4px' }}>{bestLap?.s2 ? (bestLap.s2/1000).toFixed(3) : '--.---'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>S3</div>
              <div className="font-digital" style={{ color: 'white', marginTop: '4px' }}>{bestLap?.s3 ? (bestLap.s3/1000).toFixed(3) : '--.---'}</div>
            </div>
          </div>
        </div>

        {/* IDEAL LAP (THEORETICAL BEST) */}
        <div className="bento-card glass-panel">
          <div className="card-header">
            <h3>Ideal Lap (Theoretical Best)</h3>
            <span style={{ color: 'var(--neon-cyan)', fontSize: '14px' }}>⏱️</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-digital" style={{ fontSize: '44px', color: 'var(--neon-cyan)' }}>
              {idealLapData.idealLapTime ? (idealLapData.idealLapTime / 1000).toFixed(3) : '--.---'}s
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Suma najlepszych sektorów (S1+S2+S3) wszystkich kierowców.
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', borderTop: '1px solid var(--card-border)', paddingTop: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>BEST S1</div>
              <div className="font-digital" style={{ color: 'var(--neon-purple)', marginTop: '4px' }}>
                {idealLapData.minS1 ? (idealLapData.minS1 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>BEST S2</div>
              <div className="font-digital" style={{ color: 'var(--neon-purple)', marginTop: '4px' }}>
                {idealLapData.minS2 ? (idealLapData.minS2 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>BEST S3</div>
              <div className="font-digital" style={{ color: 'var(--neon-purple)', marginTop: '4px' }}>
                {idealLapData.minS3 ? (idealLapData.minS3 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
          </div>
        </div>

        {/* VEHICLE STATUS */}
        <div className="bento-card glass-panel" id="card-vehicle">
          <div className="card-header">
            <h3>Vehicle Status</h3>
            <span style={{ color: 'var(--neon-green)', fontSize: '14px' }}>⚡</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Aktualna prędkość{bestLap ? ' (Lider)' : ''}</span>
              <div style={{ fontSize: '16px', fontWeight: 800, color: activeDriverTelemetry ? 'white' : 'var(--text-secondary)', marginTop: '4px' }}>
                {activeDriverTelemetry ? activeDriverTelemetry.driverName : 'Brak aktywnego kierowcy'}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                <span className="font-digital" style={{ fontSize: '64px', color: 'var(--neon-green)', textShadow: '0 0 20px rgba(0,255,136,0.4)' }}>
                  {activeDriverTelemetry ? Math.round(activeDriverTelemetry.speed) : 0}
                </span>
                <span style={{ fontSize: '18px', color: 'var(--text-secondary)', fontWeight: 800 }}>km/h</span>
              </div>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>G-Force / Przeciążenie</span>
              <div style={{ width: '100%', height: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', marginTop: '8px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${Math.min((activeDriverTelemetry?.gForce || 0) / 2, 1) * 100}%`, 
                  background: 'var(--neon-purple)', 
                  transition: 'width 0.1s linear' 
                }} />
              </div>
            </div>
          </div>
        </div>

        {/* TRACK MAP */}
        <div className="bento-card glass-panel" style={{ padding: 0, overflow: 'hidden', minHeight: '300px', position: 'relative' }}>
          <div className="card-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000, background: 'linear-gradient(rgba(0,0,0,0.8), transparent)', padding: '20px', margin: 0 }}>
            <h3>Radar Satelitarny</h3>
          </div>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Timing Board (Bottom) */}
      <div className="bento-card glass-panel">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0 }}>Live Timing</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Kliknij kierowcę by otworzyć LIVE FOCUS</span>
          </div>

          <div style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.5)', padding: '4px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)' }}>
            <button
              onClick={() => setViewMode('leaderboard')}
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                borderRadius: '8px',
                background: viewMode === 'leaderboard' ? 'var(--neon-cyan)' : 'transparent',
                color: viewMode === 'leaderboard' ? '#000' : 'var(--text-secondary)',
                fontWeight: 900,
                border: 'none',
                transition: 'all 0.2s'
              }}
            >
              🏆 KLASYFIKACJA (LIDERZY)
            </button>
            <button
              onClick={() => setViewMode('all')}
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                borderRadius: '8px',
                background: viewMode === 'all' ? 'var(--neon-cyan)' : 'transparent',
                color: viewMode === 'all' ? '#000' : 'var(--text-secondary)',
                fontWeight: 900,
                border: 'none',
                transition: 'all 0.2s'
              }}
            >
              📋 WSZYSTKIE OKRĄŻENIA ({laps.length})
            </button>
          </div>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="timing-table">
            <thead>
              <tr>
                <th>Pozycja</th>
                <th>Kierowca</th>
                <th>Sektor 1</th>
                <th>Sektor 2</th>
                <th>Sektor 3</th>
                <th>Czas Całkowity</th>
                <th>V-Max</th>
                <th>Strata do Lidera</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {displayedLaps.map((lap: any, index: number) => {
                  const deltaToLeader = index === 0 ? null : lap.lapTime - bestLap.lapTime;
                  const isFocused = focusedDriver === lap.driverName;
                  const pBest = sectorStats.personalMap.get(lap.driverName);

                  const s1Color = getSectorColor(lap.s1, pBest?.s1, sectorStats.overallS1);
                  const s2Color = getSectorColor(lap.s2, pBest?.s2, sectorStats.overallS2);
                  const s3Color = getSectorColor(lap.s3, pBest?.s3, sectorStats.overallS3);
                  
                  return (
                    <React.Fragment key={lap._id}>
                      <motion.tr 
                        layout
                        onClick={() => setFocusedDriver(isFocused ? null : lap.driverName)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        style={{ 
                          background: isFocused ? 'rgba(0, 240, 255, 0.15)' : (index === 0 ? 'rgba(157, 78, 221, 0.1)' : 'transparent'),
                          cursor: 'pointer',
                          borderBottom: isFocused ? 'none' : undefined
                        }}
                      >
                        <td style={{ color: index === 0 ? 'var(--neon-purple)' : 'white', fontWeight: 900, fontSize: '18px' }}>{index + 1}</td>
                        <td style={{ fontWeight: 800, fontSize: '16px', color: isFocused ? 'var(--neon-blue)' : 'white' }}>{lap.driverName}</td>
                        <td style={{ color: s1Color, fontWeight: 700 }}>{lap.s1 ? (lap.s1/1000).toFixed(3) : '---'}</td>
                        <td style={{ color: s2Color, fontWeight: 700 }}>{lap.s2 ? (lap.s2/1000).toFixed(3) : '---'}</td>
                        <td style={{ color: s3Color, fontWeight: 700 }}>{lap.s3 ? (lap.s3/1000).toFixed(3) : '---'}</td>
                        <td style={{ color: index === 0 ? 'var(--neon-purple)' : 'var(--neon-green)', fontWeight: 900, fontSize: '18px' }}>
                          {(lap.lapTime/1000).toFixed(3)}
                        </td>
                        <td style={{ color: 'var(--neon-orange)' }}>{Math.round(lap.topSpeed || 0)} km/h</td>
                        <td style={{ color: index === 0 ? 'var(--text-secondary)' : 'var(--neon-red)', fontWeight: 800 }}>
                          {deltaToLeader ? `+${(deltaToLeader/1000).toFixed(3)}s` : 'LIDER'}
                        </td>
                      </motion.tr>
                      
                      <AnimatePresence>
                        {isFocused && (
                          <motion.tr
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <td colSpan={8} style={{ padding: 0, border: 'none' }}>
                              <div style={{ background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid var(--card-border)', padding: '24px', display: 'flex', gap: '24px', overflow: 'hidden' }}>
                                
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                  <h4 style={{ color: 'var(--neon-blue)', margin: 0 }}>LIVE TELEMETRY FOCUS: {focusedDriver}</h4>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
                                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Prędkość (LIVE)</div>
                                      <div className="font-digital" style={{ fontSize: '48px', color: 'var(--neon-green)' }}>
                                        {focusedTelemetry ? Math.round(focusedTelemetry.speed) : 0} <span style={{ fontSize: '16px', color: '#666' }}>km/h</span>
                                      </div>
                                    </div>
                                    <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
                                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>G-Force (LIVE)</div>
                                      <div className="font-digital" style={{ fontSize: '48px', color: 'var(--neon-purple)' }}>
                                        {focusedTelemetry ? (focusedTelemetry.gForce || 0).toFixed(2) : '0.00'} <span style={{ fontSize: '16px', color: '#666' }}>G</span>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <div className="glass-panel" style={{ padding: '16px' }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Rekordowe Sektory Gracza</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <div><strong style={{color: '#666'}}>S1:</strong> {(focusedLapData as any).s1 ? ((focusedLapData as any).s1/1000).toFixed(3) : '---'}s</div>
                                      <div><strong style={{color: '#666'}}>S2:</strong> {(focusedLapData as any).s2 ? ((focusedLapData as any).s2/1000).toFixed(3) : '---'}s</div>
                                      <div><strong style={{color: '#666'}}>S3:</strong> {(focusedLapData as any).s3 ? ((focusedLapData as any).s3/1000).toFixed(3) : '---'}s</div>
                                    </div>
                                  </div>
                                </div>
                                
                                <div style={{ flex: 1, minHeight: '250px', position: 'relative', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
                                  <div ref={focusMapRef} style={{ width: '100%', height: '100%' }} />
                                  <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.8)', padding: '4px 8px', borderRadius: '4px', zIndex: 1000, fontSize: '12px', color: 'white' }}>
                                    Własne powiększanie (Zoom) aktywne
                                  </div>
                                </div>
                                
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </AnimatePresence>
              {inProgressDrivers.map((t: any) => (
                <tr
                  key={`in-progress-${t.driverName}`}
                  style={{ background: 'rgba(0, 240, 255, 0.05)', transition: 'all 0.2s ease' }}
                >
                  <td style={{ color: 'var(--text-secondary)', fontWeight: 900, fontSize: '18px' }}>—</td>
                  <td style={{ fontWeight: 800, fontSize: '16px', color: 'white' }}>{t.driverName}</td>
                  <td style={{ color: '#888899' }}>---</td>
                  <td style={{ color: '#888899' }}>---</td>
                  <td style={{ color: '#888899' }}>---</td>
                  <td style={{ color: 'var(--neon-cyan)', fontWeight: 800, fontSize: '13px', textTransform: 'uppercase' }}>W trakcie okrążenia...</td>
                  <td style={{ color: 'var(--neon-orange)' }}>{Math.round(t.speed || 0)} km/h</td>
                  <td style={{ color: 'var(--text-secondary)' }}>—</td>
                </tr>
              ))}
              {displayedLaps.length === 0 && inProgressDrivers.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                    Brak wyników. Czekamy na czasy okrążeń!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend for Sector Colors */}
        <div style={{ display: 'flex', gap: '16px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '11px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--neon-purple)', boxShadow: '0 0 6px var(--neon-purple)' }} />
            <span>🟣 Rekord Sesji (Overall Best)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--neon-green)', boxShadow: '0 0 6px var(--neon-green)' }} />
            <span>🟢 Rekord Osobisty (Personal Best)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--neon-yellow)', boxShadow: '0 0 6px var(--neon-yellow)' }} />
            <span>🟡 Wolniej od Rekordu Osobistego</span>
          </div>
        </div>
      </div>

    </div>
  );
}
