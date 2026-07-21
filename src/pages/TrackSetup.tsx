import { useState, useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
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

  const saveTrack = useMutation(api.tracks.saveTrack);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const labelsLayer = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    
    leafletMap.current = L.map(mapRef.current, { zoomControl: false, maxBoundsViscosity: 1.0 }).setView([51.95, 20.15], 13);
    
    // Satelite Map Darkened for OLED
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
      className: 'map-tiles-dark'
    }).addTo(leafletMap.current);

    labelsLayer.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    });
    
    if (labelsVisible) {
      labelsLayer.current.addTo(leafletMap.current);
    }

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
            
            const map = leafletMap.current!;
            const clickPt = map.latLngToLayerPoint(e.latlng);
            let minDistance = Infinity;
            let bestSegmentIndex = -1;
            let bestProjectedPt: any = clickPt;

            for (let i = 0; i < currentPath.length - 1; i++) {
              const p1 = map.latLngToLayerPoint(L.latLng(currentPath[i].lat, currentPath[i].lon));
              const p2 = map.latLngToLayerPoint(L.latLng(currentPath[i+1].lat, currentPath[i+1].lon));
              
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

            // Snap distance threshold (150 pixels)
            if (minDistance < 150) {
              const newLatLng = map.layerPointToLatLng(bestProjectedPt as any);
              const newPath = [...currentPath];
              newPath.splice(bestSegmentIndex + 1, 0, { lat: newLatLng.lat, lon: newLatLng.lng });
              
              setS1Index(s1 => {
                let newS1 = s1;
                if (newS1 !== undefined && bestSegmentIndex < newS1) newS1++;
                if (currentMode === 's1') return bestSegmentIndex + 1;
                return newS1;
              });

              setS2Index(s2 => {
                let newS2 = s2;
                if (newS2 !== undefined && bestSegmentIndex < newS2) newS2++;
                if (currentMode === 's2') return bestSegmentIndex + 1;
                return newS2;
              });
              
              return newPath;
            }
          }
          return currentPath;
        });

        // Switch to the next logical step after placing a sector
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

    // Draw path with colors based on sectors
    let s1 = s1Index ?? path.length;
    let s2 = s2Index ?? path.length;

    const p1 = path.slice(0, s1 + 1);
    const p2 = path.slice(s1, s2 + 1);
    const p3 = path.slice(s2, path.length);

    if (p1.length > 0) L.polyline(p1 as any, { color: '#00f0ff', weight: 6, opacity: 0.8 }).addTo(layerGroup.current);
    if (p2.length > 0) L.polyline(p2 as any, { color: '#f3123c', weight: 6, opacity: 0.8 }).addTo(layerGroup.current);
    if (p3.length > 0) L.polyline(p3 as any, { color: '#39ff14', weight: 6, opacity: 0.8 }).addTo(layerGroup.current);

    // Draw pulsating sectors and regular points
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
    await saveTrack({ name: trackName || 'Nowa Trasa', path, s1Index, s2Index });
    alert('Zapisano pomyślnie!');
    setPath([]); setS1Index(undefined); setS2Index(undefined); setTrackName('');
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
        style={{ padding: '24px', zIndex: 1000, position: 'absolute', top: '24px', left: '24px', width: '350px', display: 'flex', flexDirection: 'column', gap: '20px' }}
      >
        <div>
          <h2 style={{ margin: 0, borderLeft: '4px solid var(--neon-purple)', paddingLeft: '12px', fontSize: '20px', textTransform: 'uppercase' }}>Kreator Tras F1</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '8px' }}>
            Rysuj tor, a następnie jednym kliknięciem przypinaj precyzyjnie sektory do wyrysowanej linii wyścigowej.
          </p>
        </div>
        
        <input 
          className="custom-input" 
          placeholder="Nazwa trasy... (np. Szybka Nocna)" 
          value={trackName} 
          onChange={e => setTrackName(e.target.value)} 
          style={{ fontSize: '16px' }}
        />

        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" style={{ flex: 1, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={handleLocate}>
            <span style={{ fontSize: '16px' }}>📍</span> GPS
          </button>
          <button className="btn-secondary" style={{ flex: 1, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => setLabelsVisible(!labelsVisible)}>
            <span style={{ fontSize: '16px' }}>🗺️</span> {labelsVisible ? 'Ukryj' : 'Pokaż'} Ulice
          </button>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '4px 0' }} />

        <AnimatePresence mode="wait">
          <motion.div 
            key={mode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{ 
              background: mode === 'draw' ? 'rgba(0, 240, 255, 0.1)' : mode === 's1' ? 'rgba(243, 18, 60, 0.1)' : 'rgba(255, 145, 0, 0.1)',
              border: `1px solid ${mode === 'draw' ? 'var(--neon-green)' : mode === 's1' ? 'var(--neon-red)' : 'var(--neon-orange)'}`,
              padding: '12px', borderRadius: '12px', textAlign: 'center', color: 'white', fontWeight: 600, fontSize: '14px'
            }}
          >
            {mode === 'draw' && 'Rysowanie Linii Wyścigowej (Klikaj na mapie)'}
            {mode === 's1' && 'Wybieranie Sektora 1 (Kliknij na niebieską linię)'}
            {mode === 's2' && 'Wybieranie Sektora 2 (Kliknij na czerwoną linię)'}
          </motion.div>
        </AnimatePresence>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button 
            className={`btn-secondary ${mode === 'draw' ? 'active-draw' : ''}`} 
            onClick={() => setMode('draw')}
          >
            🖋️ Dodaj Punkty ({path.length})
          </button>
          
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
            disabled={!s1Index}
          >
            🏁 Ustaw Sektor 2
          </button>
        </div>

        <button className="btn-primary" style={{ width: '100%', marginTop: '8px', letterSpacing: '2px', fontSize: '18px' }} onClick={handleSave}>
          ZAPISZ TRASĘ
        </button>
      </motion.div>

      <div ref={mapRef} style={{ flex: 1, width: '100%' }} />
    </div>
  );
}
