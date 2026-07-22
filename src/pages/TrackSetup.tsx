import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import { calculateTrackCorners } from '../lib/math';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion, AnimatePresence } from 'framer-motion';

type Point = { lat: number; lon: number };

function haversineMeters(p1: Point, p2: Point) {
  const R = 6371000;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lon - p1.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePathMeters(pts: Point[]) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += haversineMeters(pts[i], pts[i + 1]);
  }
  return Math.round(len);
}

export default function TrackSetup() {
  const [trackName, setTrackName] = useState('');
  const [path, setPath] = useState<Point[]>([]);
  const [s1Index, setS1Index] = useState<number | undefined>();
  const [s2Index, setS2Index] = useState<number | undefined>();
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [mode, setMode] = useState<'draw' | 's1' | 's2'>('draw');
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [showTrackList, setShowTrackList] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // @ts-ignore
  const rawTracks = useQuery(api.tracks.getTracks);
  const tracks = useMemo(() => rawTracks ?? [], [rawTracks]);
  // @ts-ignore
  const saveTrack = useMutation(api.tracks.saveTrack);
  // @ts-ignore
  const updateTrack = useMutation(api.tracks.updateTrack);
  // @ts-ignore
  const deleteTrack = useMutation(api.tracks.deleteTrack);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const labelsLayer = useRef<L.TileLayer | null>(null);

  const modeRef = useRef(mode);
  const pathRef = useRef(path);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pathRef.current = path; }, [path]);

  const s1IndexRef = useRef<number | undefined>(undefined);
  const s2IndexRef = useRef<number | undefined>(undefined);
  useEffect(() => { s1IndexRef.current = s1Index; }, [s1Index]);
  useEffect(() => { s2IndexRef.current = s2Index; }, [s2Index]);

  // Corner analysis for current path
  const corners = useMemo(() => calculateTrackCorners(path), [path]);

  // Real sector distance preview metrics
  const sectorMetrics = useMemo(() => {
    if (path.length < 2) return null;
    const s1 = s1Index ?? path.length;
    const s2 = s2Index ?? path.length;

    const p1 = path.slice(0, Math.min(s1 + 1, path.length));
    const p2 = path.slice(Math.min(s1, path.length - 1), Math.min(s2 + 1, path.length));
    const p3 = path.slice(Math.min(s2, path.length - 1));

    const s1Len = calculatePathMeters(p1);
    const s2Len = calculatePathMeters(p2);
    const s3Len = calculatePathMeters(p3);
    const total = s1Len + s2Len + s3Len;

    return { s1Len, s2Len, s3Len, total };
  }, [path, s1Index, s2Index]);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    
    leafletMap.current = L.map(mapRef.current, { zoomControl: false, maxBoundsViscosity: 1.0 }).setView([51.95, 20.15], 13);
    
    // Satellite Map Darkened for OLED look
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
      className: 'map-tiles-dark'
    }).addTo(leafletMap.current);

    labelsLayer.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    });

    layerGroup.current = L.layerGroup().addTo(leafletMap.current);

    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  useEffect(() => {
    if (!leafletMap.current || !labelsLayer.current) return;
    if (labelsVisible) {
      if (!leafletMap.current.hasLayer(labelsLayer.current)) leafletMap.current.addLayer(labelsLayer.current);
    } else {
      if (leafletMap.current.hasLayer(labelsLayer.current)) leafletMap.current.removeLayer(labelsLayer.current);
    }
  }, [labelsVisible]);

  // Render Polylines, Markers, Draggable Nodes & Corner Badges
  useEffect(() => {
    if (!layerGroup.current) return;
    layerGroup.current.clearLayers();

    let s1 = s1Index ?? path.length;
    let s2 = s2Index ?? path.length;

    const p1 = path.slice(0, s1 + 1);
    const p2 = path.slice(s1, s2 + 1);
    const p3 = path.slice(s2, path.length);

    if (p1.length > 0) L.polyline(p1 as any, { color: '#00f0ff', weight: 6, opacity: 0.85 }).addTo(layerGroup.current);
    if (p2.length > 0) L.polyline(p2 as any, { color: '#f3123c', weight: 6, opacity: 0.85 }).addTo(layerGroup.current);
    if (p3.length > 0) L.polyline(p3 as any, { color: '#39ff14', weight: 6, opacity: 0.85 }).addTo(layerGroup.current);

    // Corner Badges
    const cornerMap = new Map(corners.map(c => [c.index, c]));

    path.forEach((pt, idx) => {
      const isStart = idx === 0;
      const isFinish = idx === path.length - 1;
      const isS1 = idx === s1Index;
      const isS2 = idx === s2Index;
      const corner = cornerMap.get(idx);
      
      let html = `<div style="width:100%;height:100%;border-radius:50%;background:rgba(255,255,255,0.6);border:1.5px solid white;"></div>`;
      let size = 12;

      if (isStart) {
        html = `<div style="background:#080c18;color:#00f0ff;border:2px solid #00f0ff;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 12px #00f0ff;">🏁 START</div>`;
        size = 24;
      } else if (isFinish) {
        html = `<div style="background:#080c18;color:#39ff14;border:2px solid #39ff14;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 12px #39ff14;">🏁 META</div>`;
        size = 24;
      } else if (isS1) {
        html = `<div style="background:#080c18;color:#f3123c;border:2px solid #f3123c;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 15px #f3123c;animation: pulse 1.5s infinite;">🚩 SEKTOR 1 (SPLIT)</div>`;
        size = 26;
      } else if (isS2) {
        html = `<div style="background:#080c18;color:#ff9100;border:2px solid #ff9100;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 15px #ff9100;animation: pulse 1.5s infinite;">🚩 SEKTOR 2 (SPLIT)</div>`;
        size = 26;
      } else if (corner) {
        const badgeColor = corner.severity === 'hairpin' ? '#ff0033' : corner.severity === 'sharp' ? '#ff9100' : '#00f0ff';
        html = `<div style="background:rgba(0,0,0,0.85);color:${badgeColor};border:1px solid ${badgeColor};border-radius:4px;padding:2px 6px;font-size:10px;font-weight:800;white-space:nowrap;">${corner.label} (${corner.angleDegrees}°)</div>`;
        size = 20;
      }

      const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
      const marker = L.marker([pt.lat, pt.lon], { icon, draggable: true }).addTo(layerGroup.current!);

      // Update point position on drag
      marker.on('dragend', (e: any) => {
        const newLatLng = e.target.getLatLng();
        setPath(prev => {
          const updated = [...prev];
          updated[idx] = { lat: newLatLng.lat, lon: newLatLng.lng };
          return updated;
        });
      });
    });
  }, [path, s1Index, s2Index, corners]);

  // Handle map clicks
  useEffect(() => {
    if (!leafletMap.current) return;
    
    const clickHandler = (e: L.LeafletMouseEvent) => {
      const currentMode = modeRef.current;
      const currentPath = pathRef.current;
      const currentS1 = s1IndexRef.current;
      const currentS2 = s2IndexRef.current;

      if (currentMode === 'draw') {
        setPath([...currentPath, { lat: e.latlng.lat, lon: e.latlng.lng }]);
        return;
      }

      if (currentMode === 's1' || currentMode === 's2') {
        if (currentPath.length < 2) return;

        const oldIndex = currentMode === 's1' ? currentS1 : currentS2;
        const workingPath = oldIndex !== undefined
          ? currentPath.filter((_, idx) => idx !== oldIndex)
          : currentPath;

        const map = leafletMap.current!;
        const clickPt = map.latLngToLayerPoint(e.latlng);
        let minDistance = Infinity;
        let bestSegmentIndex = -1;
        let bestProjectedPt: any = clickPt;

        for (let i = 0; i < workingPath.length - 1; i++) {
          const p1 = map.latLngToLayerPoint(L.latLng(workingPath[i].lat, workingPath[i].lon));
          const p2 = map.latLngToLayerPoint(L.latLng(workingPath[i + 1].lat, workingPath[i + 1].lon));
          
          const v = { x: p2.x - p1.x, y: p2.y - p1.y };
          const w = { x: clickPt.x - p1.x, y: clickPt.y - p1.y };
          
          const c1 = w.x * v.x + w.y * v.y;
          const c2 = v.x * v.x + v.y * v.y;
          
          let projPt;
          if (c1 <= 0) {
            projPt = p1;
          } else if (c2 <= c1) {
            projPt = p2;
          } else {
            const b = c1 / c2;
            projPt = { x: p1.x + b * v.x, y: p1.y + b * v.y };
          }
          
          const dist = Math.sqrt(Math.pow(clickPt.x - projPt.x, 2) + Math.pow(clickPt.y - projPt.y, 2));
          
          if (dist < minDistance) {
            minDistance = dist;
            bestSegmentIndex = i;
            bestProjectedPt = projPt;
          }
        }

        // Snap distance threshold (35 screen pixels)
        if (minDistance < 35) {
          const newLatLng = map.layerPointToLatLng(bestProjectedPt as any);
          const newPath = [...workingPath];
          newPath.splice(bestSegmentIndex + 1, 0, { lat: newLatLng.lat, lon: newLatLng.lng });
          const newIndex = bestSegmentIndex + 1;

          const reindexOther = (idx: number | undefined) => {
            if (idx === undefined) return idx;
            let adjusted = idx;
            if (oldIndex !== undefined && oldIndex < adjusted) adjusted--;
            if (bestSegmentIndex < adjusted) adjusted++;
            return adjusted;
          };

          const nextS1 = currentMode === 's1' ? newIndex : reindexOther(currentS1);
          const nextS2 = currentMode === 's2' ? newIndex : reindexOther(currentS2);
          const nextMode = currentMode === 's1' ? 's2' : 'draw';

          setPath(newPath);
          setS1Index(nextS1);
          setS2Index(nextS2);
          setMode(nextMode);
        }
      }
    };

    leafletMap.current.on('click', clickHandler);
    
    return () => {
      leafletMap.current?.off('click', clickHandler);
    };
  }, []);

  const handleEditTrack = (t: any) => {
    setEditingTrackId(t._id);
    setTrackName(t.name);
    setPath(t.path || []);
    setS1Index(t.s1Index);
    setS2Index(t.s2Index);
    setShowTrackList(false);

    if (leafletMap.current && t.path && t.path.length > 0) {
      const bounds = L.latLngBounds(t.path.map((p: any) => [p.lat, p.lon]));
      leafletMap.current.fitBounds(bounds, { padding: [50, 50] });
    }
  };

  const handleCancelEdit = () => {
    setEditingTrackId(null);
    setTrackName('');
    setPath([]);
    setS1Index(undefined);
    setS2Index(undefined);
  };

  const handleSaveOrUpdate = async () => {
    if (path.length < 2) return alert('Trasa musi mieć co najmniej 2 punkty!');
    if (s1Index === undefined || s2Index === undefined) {
      return alert('Trasa musi mieć ustawione oba sektory (S1 i S2) przed zapisem!');
    }

    if (editingTrackId) {
      await updateTrack({ id: editingTrackId as any, name: trackName || 'Zaktualizowana Trasa', path, s1Index, s2Index });
      alert('Trasa została pomyślnie zaktualizowana!');
    } else {
      await saveTrack({ name: trackName || 'Nowa Trasa', path, s1Index, s2Index });
      alert('Zapisano pomyślnie nową trasę!');
    }
    handleCancelEdit();
  };

  const handleUndoPoint = () => {
    setPath(prev => {
      if (prev.length === 0) return prev;
      const newPath = prev.slice(0, -1);
      const newLen = newPath.length;
      if (s1Index !== undefined && s1Index >= newLen) setS1Index(undefined);
      if (s2Index !== undefined && s2Index >= newLen) setS2Index(undefined);
      return newPath;
    });
  };

  const handleClearTrack = () => {
    setPath([]);
    setS1Index(undefined);
    setS2Index(undefined);
  };

  const handleDeleteTrack = async (id: any, name: string) => {
    if (window.confirm(`Czy na pewno chcesz usunąć trasę "${name}" wraz ze wszystkimi wynikami?`)) {
      await deleteTrack({ id });
      if (editingTrackId === id) handleCancelEdit();
    }
  };

  const handleLocate = () => {
    if (leafletMap.current) {
      leafletMap.current.locate({ setView: true, maxZoom: 16 });
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', height: '100%', flexDirection: 'column', position: 'relative' }}>
      
      <motion.div 
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="glass-panel" 
        style={{
          padding: '18px', zIndex: 1000, position: 'absolute', top: '12px', left: 'clamp(8px, 2.5vw, 16px)',
          width: 'clamp(280px, 94vw, 380px)', display: 'flex', flexDirection: 'column', gap: '14px',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ background: 'var(--f1-red)', color: '#fff', fontSize: '10px', fontWeight: 900, padding: '2px 6px', borderRadius: '4px', transform: 'skew(-10deg)' }}>CAD</span>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }}>
                {editingTrackId ? '✏️ EDYTOR TRASY' : 'KREATOR TRAS F1'}
              </h2>
            </div>
            {!panelCollapsed && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '4px' }}>
                {editingTrackId ? 'Modyfikuj punkty, przeciągaj węzły i przesuwaj bramki sektorów.' : 'Rysuj tor i przypinaj sektory do wyrysowanej linii wyścigowej.'}
              </p>
            )}
          </div>
          <button 
            className="btn-secondary" 
            style={{ padding: '4px 8px', fontSize: '10px', whiteSpace: 'nowrap' }}
            onClick={() => setPanelCollapsed(!panelCollapsed)}
          >
            {panelCollapsed ? '📂 Otwórz' : '➖ Zwiń'}
          </button>
        </div>
        
        {!panelCollapsed && (
          <>
            {editingTrackId && (
              <div style={{ background: 'rgba(0,240,255,0.15)', border: '1px solid var(--neon-cyan)', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', color: 'var(--neon-cyan)', fontWeight: 800, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✏️ Tryb Edycji Trasy</span>
                <button style={{ background: 'transparent', border: 'none', color: '#ff0033', cursor: 'pointer', fontWeight: 900 }} onClick={handleCancelEdit}>✕ Anuluj</button>
              </div>
            )}

            <input 
              className="custom-input" 
              placeholder="Nazwa trasy... (np. Szybka Nocna)" 
              value={trackName} 
              onChange={e => setTrackName(e.target.value)} 
              style={{ fontSize: '14px' }}
            />

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" style={{ flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={handleLocate}>
            <span style={{ fontSize: '14px' }}>📍</span> GPS
          </button>
          <button className="btn-secondary" style={{ flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={() => setLabelsVisible(!labelsVisible)}>
            <span style={{ fontSize: '14px' }}>🗺️</span> {labelsVisible ? 'Ukryj' : 'Pokaż'} Ulice
          </button>
        </div>

        {/* Sector Distance & Percentage Breakdown Card */}
        {sectorMetrics && (
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(0,240,255,0.2)', fontSize: '11px' }}>
            <div style={{ fontWeight: 800, color: 'var(--neon-cyan)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🏁 PODGLĄD SEKTORÓW TRASY</span>
              <span style={{ background: 'rgba(0,240,255,0.15)', padding: '2px 6px', borderRadius: '4px', color: 'white' }}>{(sectorMetrics.total / 1000).toFixed(2)} km</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              <div style={{ background: 'rgba(0,240,255,0.1)', padding: '6px', borderRadius: '6px', border: '1px solid rgba(0,240,255,0.3)', textAlign: 'center' }}>
                <div style={{ color: '#00f0ff', fontWeight: 800 }}>SEKTOR 1</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '12px' }}>{sectorMetrics.s1Len}m</div>
              </div>
              <div style={{ background: 'rgba(243,18,60,0.1)', padding: '6px', borderRadius: '6px', border: '1px solid rgba(243,18,60,0.3)', textAlign: 'center' }}>
                <div style={{ color: '#f3123c', fontWeight: 800 }}>SEKTOR 2</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '12px' }}>{sectorMetrics.s2Len}m</div>
              </div>
              <div style={{ background: 'rgba(57,255,20,0.1)', padding: '6px', borderRadius: '6px', border: '1px solid rgba(57,255,20,0.3)', textAlign: 'center' }}>
                <div style={{ color: '#39ff14', fontWeight: 800 }}>SEKTOR 3</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '12px' }}>{sectorMetrics.s3Len}m</div>
              </div>
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '2px 0' }} />

        <AnimatePresence mode="wait">
          <motion.div 
            key={mode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{ 
              background: mode === 'draw' ? 'rgba(0, 240, 255, 0.1)' : mode === 's1' ? 'rgba(243, 18, 60, 0.1)' : 'rgba(255, 145, 0, 0.1)',
              border: `1px solid ${mode === 'draw' ? 'var(--neon-green)' : mode === 's1' ? 'var(--neon-red)' : 'var(--neon-orange)'}`,
              padding: '10px', borderRadius: '10px', textAlign: 'center', color: 'white', fontWeight: 600, fontSize: '13px'
            }}
          >
            {mode === 'draw' && 'Rysowanie Linii (Klikaj na mapie / przeciągaj punkty)'}
            {mode === 's1' && 'Wybieranie Sektora 1 (Kliknij na linię)'}
            {mode === 's2' && 'Wybieranie Sektora 2 (Kliknij na linię)'}
          </motion.div>
        </AnimatePresence>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button 
            className={`btn-secondary ${mode === 'draw' ? 'active-draw' : ''}`} 
            onClick={() => setMode('draw')}
          >
            🖋️ Dodaj Punkty ({path.length})
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-secondary"
              style={{ flex: 1, fontSize: '11px', padding: '8px' }}
              onClick={handleUndoPoint}
              disabled={path.length === 0}
            >
              ↩ Cofnij Punkt
            </button>
            <button
              className="btn-secondary"
              style={{ flex: 1, fontSize: '11px', padding: '8px' }}
              onClick={handleClearTrack}
              disabled={path.length === 0}
            >
              🗑️ Wyczyszcz
            </button>
          </div>
          
          <button 
            className={`btn-secondary ${mode === 's1' ? 'active-s1' : ''}`} 
            onClick={() => setMode('s1')}
            disabled={path.length < 3}
          >
            🏁 Ustaw Sektor 1 {s1Index !== undefined ? `(Punkt #${s1Index})` : ''}
          </button>

          <button
            className={`btn-secondary ${mode === 's2' ? 'active-s2' : ''}`}
            onClick={() => setMode('s2')}
            disabled={s1Index === undefined}
          >
            🏁 Ustaw Sektor 2 {s2Index !== undefined ? `(Punkt #${s2Index})` : ''}
          </button>
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', marginTop: '4px', letterSpacing: '1px', fontSize: '15px' }}
          onClick={handleSaveOrUpdate}
          disabled={path.length < 2 || s1Index === undefined || s2Index === undefined}
        >
          {editingTrackId ? '💾 ZAKTUALIZUJ TRASĘ' : 'ZAPISZ TRASĘ'}
        </button>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4px', paddingTop: '10px' }}>
          <button
            className="btn-secondary"
            style={{ width: '100%', fontSize: '12px' }}
            onClick={() => setShowTrackList(!showTrackList)}
          >
            📁 {showTrackList ? 'Ukryj Zapisane Trasy' : `Menedżer Tras (${tracks.length})`}
          </button>

          {showTrackList && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {tracks.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', padding: '8px' }}>Brak zapisanych tras</div>
              ) : (
                tracks.map((t: any) => (
                  <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'white' }}>{t.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{t.path?.length || 0} punktów</div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--neon-cyan)' }}
                        onClick={() => handleEditTrack(t)}
                      >
                        ✏️ Edytuj
                      </button>
                      <button
                        className="btn-danger"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => handleDeleteTrack(t._id, t.name)}
                      >
                        Usuń
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </>
    )}
  </motion.div>

      <div ref={mapRef} style={{ flex: 1, width: '100%' }} />
    </div>
  );
}
