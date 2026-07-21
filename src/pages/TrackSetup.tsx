import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion, AnimatePresence } from 'framer-motion';

type Point = { lat: number; lon: number };

export default function TrackSetup() {
  const [trackName, setTrackName] = useState('');
  const [path, setPath] = useState<Point[]>([]);
  const [s1Index, setS1Index] = useState<number | undefined>();
  const [s2Index, setS2Index] = useState<number | undefined>();
  const [mode, setMode] = useState<'draw' | 's1' | 's2'>('draw');
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [showTrackList, setShowTrackList] = useState(false);

  // @ts-ignore
  const rawTracks = useQuery(api.tracks.getTracks);
  const tracks = useMemo(() => rawTracks ?? [], [rawTracks]);
  // @ts-ignore
  const saveTrack = useMutation(api.tracks.saveTrack);
  // @ts-ignore
  const deleteTrack = useMutation(api.tracks.deleteTrack);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const labelsLayer = useRef<L.TileLayer | null>(null);

  const s1IndexRef = useRef<number | undefined>(undefined);
  const s2IndexRef = useRef<number | undefined>(undefined);
  useEffect(() => { s1IndexRef.current = s1Index; }, [s1Index]);
  useEffect(() => { s2IndexRef.current = s2Index; }, [s2Index]);

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

  // Handle map clicks
  useEffect(() => {
    if (!leafletMap.current) return;
    
    const clickHandler = (e: L.LeafletMouseEvent) => {
      setMode((currentMode) => {
        setPath(currentPath => {
          if (currentMode === 'draw') {
            return [...currentPath, { lat: e.latlng.lat, lon: e.latlng.lng }];
          }
          
          if (currentMode === 's1' || currentMode === 's2') {
            if (currentPath.length < 2) return currentPath;

            const oldIndex = currentMode === 's1' ? s1IndexRef.current : s2IndexRef.current;
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
              const p2 = map.latLngToLayerPoint(L.latLng(workingPath[i+1].lat, workingPath[i+1].lon));
              
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

            // Accurate snap distance threshold (35 screen pixels)
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

              setS1Index(s1 => currentMode === 's1' ? newIndex : reindexOther(s1));
              setS2Index(s2 => currentMode === 's2' ? newIndex : reindexOther(s2));

              return newPath;
            }
            return currentPath;
          }
          return currentPath;
        });

        if (currentMode === 's1') return 's2';
        if (currentMode === 's2') return 'draw';
        return currentMode;
      });
    };

    leafletMap.current.on('click', clickHandler);
    
    return () => {
      leafletMap.current?.off('click', clickHandler);
    };
  }, []);

  useEffect(() => {
    if (!layerGroup.current) return;
    layerGroup.current.clearLayers();

    let s1 = s1Index ?? path.length;
    let s2 = s2Index ?? path.length;

    const p1 = path.slice(0, s1 + 1);
    const p2 = path.slice(s1, s2 + 1);
    const p3 = path.slice(s2, path.length);

    if (p1.length > 0) L.polyline(p1 as any, { color: '#00f0ff', weight: 6, opacity: 0.8 }).addTo(layerGroup.current);
    if (p2.length > 0) L.polyline(p2 as any, { color: '#f3123c', weight: 6, opacity: 0.8 }).addTo(layerGroup.current);
    if (p3.length > 0) L.polyline(p3 as any, { color: '#39ff14', weight: 6, opacity: 0.8 }).addTo(layerGroup.current);

    path.forEach((pt, idx) => {
      const isStart = idx === 0;
      const isFinish = idx === path.length - 1;
      const isS1 = idx === s1Index;
      const isS2 = idx === s2Index;
      
      let html = `<div style="width:100%;height:100%;border-radius:50%;background:rgba(255,255,255,0.4);border:1px solid white;"></div>`;
      let size = 12;

      if (isStart) {
        html = `<div style="width:100%;height:100%;border-radius:50%;background:#00f0ff;box-shadow:0 0 10px #00f0ff;border:2px solid white;"></div>`;
        size = 18;
      } else if (isFinish) {
        html = `<div style="width:100%;height:100%;border-radius:50%;background:#39ff14;box-shadow:0 0 10px #39ff14;border:2px solid white;"></div>`;
        size = 18;
      } else if (isS1) {
        html = `<div style="width:100%;height:100%;border-radius:50%;background:#f3123c;box-shadow:0 0 15px #f3123c;border:3px solid white;animation: pulse 1.5s infinite;"></div>`;
        size = 24;
      } else if (isS2) {
        html = `<div style="width:100%;height:100%;border-radius:50%;background:#ff9100;box-shadow:0 0 15px #ff9100;border:3px solid white;animation: pulse 1.5s infinite;"></div>`;
        size = 24;
      }

      const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
      L.marker([pt.lat, pt.lon], { icon }).addTo(layerGroup.current!);
    });
  }, [path, s1Index, s2Index]);

  const handleSave = async () => {
    if (path.length < 2) return alert('Trasa musi mieć co najmniej 2 punkty!');
    if (s1Index === undefined || s2Index === undefined) {
      return alert('Trasa musi mieć ustawione oba sektory (S1 i S2) przed zapisem!');
    }
    await saveTrack({ name: trackName || 'Nowa Trasa', path, s1Index, s2Index });
    alert('Zapisano pomyślnie!');
    setPath([]); setS1Index(undefined); setS2Index(undefined); setTrackName('');
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
          padding: '20px', zIndex: 1000, position: 'absolute', top: '16px', left: '16px',
          width: 'clamp(280px, 90vw, 360px)', display: 'flex', flexDirection: 'column', gap: '16px',
          maxHeight: 'calc(100vh - 90px)', overflowY: 'auto'
        }}
      >
        <div>
          <h2 style={{ margin: 0, borderLeft: '4px solid var(--neon-purple)', paddingLeft: '12px', fontSize: '18px', textTransform: 'uppercase' }}>Kreator Tras F1</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '6px' }}>
            Rysuj tor, a następnie jednym kliknięciem przypinaj precyzyjnie sektory do wyrysowanej linii wyścigowej.
          </p>
        </div>
        
        <input 
          className="custom-input" 
          placeholder="Nazwa trasa... (np. Szybka Nocna)" 
          value={trackName} 
          onChange={e => setTrackName(e.target.value)} 
          style={{ fontSize: '15px' }}
        />

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" style={{ flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={handleLocate}>
            <span style={{ fontSize: '14px' }}>📍</span> GPS
          </button>
          <button className="btn-secondary" style={{ flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={() => setLabelsVisible(!labelsVisible)}>
            <span style={{ fontSize: '14px' }}>🗺️</span> {labelsVisible ? 'Ukryj' : 'Pokaż'} Ulice
          </button>
        </div>

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
            {mode === 'draw' && 'Rysowanie Linii Wyścigowej (Klikaj na mapie)'}
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
            🏁 Ustaw Sektor 1
          </button>

          <button
            className={`btn-secondary ${mode === 's2' ? 'active-s2' : ''}`}
            onClick={() => setMode('s2')}
            disabled={s1Index === undefined}
          >
            🏁 Ustaw Sektor 2
          </button>
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', marginTop: '4px', letterSpacing: '1px', fontSize: '16px' }}
          onClick={handleSave}
          disabled={path.length < 2 || s1Index === undefined || s2Index === undefined}
        >
          ZAPISZ TRASĘ
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
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {tracks.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', padding: '8px' }}>Brak zapisanych tras</div>
              ) : (
                tracks.map((t: any) => (
                  <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'white' }}>{t.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{t.path?.length || 0} punktów</div>
                    </div>
                    <button
                      className="btn-danger"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      onClick={() => handleDeleteTrack(t._id, t.name)}
                    >
                      Usuń
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </motion.div>

      <div ref={mapRef} style={{ flex: 1, width: '100%' }} />
    </div>
  );
}
