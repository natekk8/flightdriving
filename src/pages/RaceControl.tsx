import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import L from 'leaflet';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';

export default function RaceControl() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'scooter' | 'bike'>('scooter');
  const [selectedTrack, setSelectedTrack] = useState(location.state?.trackId || '');
  const [focusedDriver, setFocusedDriver] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ id: number, text: string, driverName: string } | null>(null);
  
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
  // @ts-ignore
  const clearBoard = useMutation(api.laps.clearBoard);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: { marker: L.Marker, target: L.LatLng, current: L.LatLng } }>({});
  const rafRef = useRef<number | null>(null);

  // Focus Panel Map
  const focusMapRef = useRef<HTMLDivElement>(null);
  const focusLeafletMap = useRef<L.Map | null>(null);
  const focusMarkerRef = useRef<L.Marker | null>(null);
  const focusRafRef = useRef<number | null>(null);

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

      {/* Top Controls */}
      <div className="glass-panel" style={{ display: 'flex', gap: '16px', marginBottom: '24px', padding: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0, borderLeft: '4px solid var(--neon-blue)', paddingLeft: '12px' }}>RACE CONTROL MENU</h2>
        <select className="custom-select" style={{ width: '200px', transform: 'skewX(-12deg)' }} value={activeTab} onChange={e => setActiveTab(e.target.value as any)}>
          <option value="scooter">Wyniki: HULAJNOGI</option>
          <option value="bike">Wyniki: ROWERY</option>
        </select>
        <select className="custom-select" style={{ width: '300px', transform: 'skewX(-12deg)' }} value={selectedTrack} onChange={e => setSelectedTrack(e.target.value)}>
          <option value="">-- Wybierz Trasę --</option>
          {tracks.map((t: any) => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>
        <button className="btn-danger" style={{ transform: 'skewX(-12deg)', marginLeft: 'auto' }} onClick={() => { if (window.confirm('Czy na pewno chcesz zresetować wyniki dla tej trasy? (Tej akcji nie można cofnąć)')) { clearBoard({ trackId: selectedTrack || undefined }); } }}>Reset Wyników dla wybranej trasy</button>
      </div>

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
        <div className="card-header">
          <h3>Live Timing</h3>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Kliknij kierowcę by otworzyć LIVE FOCUS</span>
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
                {sortedLaps.map((lap: any, index: number) => {
                  const deltaToLeader = index === 0 ? null : lap.lapTime - bestLap.lapTime;
                  const isFocused = focusedDriver === lap.driverName;
                  
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
                        <td style={{ color: 'var(--text-secondary)' }}>{lap.s1 ? (lap.s1/1000).toFixed(3) : '---'}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{lap.s2 ? (lap.s2/1000).toFixed(3) : '---'}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{lap.s3 ? (lap.s3/1000).toFixed(3) : '---'}</td>
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
              <AnimatePresence>
                {inProgressDrivers.map((t: any) => (
                  <motion.tr
                    key={`in-progress-${t._id}`}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    style={{ background: 'rgba(0, 240, 255, 0.05)' }}
                  >
                    <td style={{ color: 'var(--text-secondary)', fontWeight: 900, fontSize: '18px' }}>—</td>
                    <td style={{ fontWeight: 800, fontSize: '16px', color: 'white' }}>{t.driverName}</td>
                    <td style={{ color: '#555' }}>---</td>
                    <td style={{ color: '#555' }}>---</td>
                    <td style={{ color: '#555' }}>---</td>
                    <td style={{ color: 'var(--neon-blue)', fontWeight: 800, fontSize: '13px', textTransform: 'uppercase' }}>W trakcie okrążenia...</td>
                    <td style={{ color: 'var(--neon-orange)' }}>{Math.round(t.speed || 0)} km/h</td>
                    <td style={{ color: 'var(--text-secondary)' }}>—</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
              {sortedLaps.length === 0 && inProgressDrivers.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                    Brak wyników. Czekamy na czasy okrążeń!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
