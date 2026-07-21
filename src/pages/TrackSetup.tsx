import { useState, useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Point = { lat: number; lon: number };

export default function TrackSetup() {
  const [trackName, setTrackName] = useState('');
  const [path, setPath] = useState<Point[]>([]);
  const [s1Index, setS1Index] = useState<number | undefined>();
  const [s2Index, setS2Index] = useState<number | undefined>();
  const [mode, setMode] = useState<'draw' | 's1' | 's2' | 'none'>('draw');
  const [labelsVisible, setLabelsVisible] = useState(true);

  const saveTrack = useMutation(api.tracks.saveTrack);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const labelsLayer = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    
    leafletMap.current = L.map(mapRef.current, { zoomControl: false }).setView([51.95, 20.15], 13);
    
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    }).addTo(leafletMap.current);

    labelsLayer.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    });
    
    if (labelsVisible) {
      labelsLayer.current.addTo(leafletMap.current);
    }

    layerGroup.current = L.layerGroup().addTo(leafletMap.current);

    leafletMap.current.on('click', (e: L.LeafletMouseEvent) => {
      setMode((currentMode) => {
        if (currentMode === 'draw') {
          setPath(p => [...p, { lat: e.latlng.lat, lon: e.latlng.lng }]);
        }
        return currentMode;
      });
    });

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

  useEffect(() => {
    if (!layerGroup.current) return;
    layerGroup.current.clearLayers();

    // Draw path with colors based on sectors
    let s1 = s1Index ?? path.length;
    let s2 = s2Index ?? path.length;

    const p1 = path.slice(0, s1 + 1);
    const p2 = path.slice(s1, s2 + 1);
    const p3 = path.slice(s2, path.length);

    if (p1.length > 0) L.polyline(p1 as any, { color: '#00f0ff', weight: 4 }).addTo(layerGroup.current);
    if (p2.length > 0) L.polyline(p2 as any, { color: '#f3123c', weight: 4 }).addTo(layerGroup.current);
    if (p3.length > 0) L.polyline(p3 as any, { color: '#39ff14', weight: 4 }).addTo(layerGroup.current);

    // Render points to allow clicking for sectors
    path.forEach((pt, idx) => {
      const circle = L.circleMarker([pt.lat, pt.lon], { 
        radius: 6, 
        color: idx === 0 ? 'white' : idx === path.length - 1 ? 'black' : 'gray',
        fillColor: 'white',
        fillOpacity: 1 
      }).addTo(layerGroup.current!);

      circle.on('click', () => {
        setMode((currentMode) => {
          if (currentMode === 's1') setS1Index(idx);
          if (currentMode === 's2') setS2Index(idx);
          return currentMode === 'draw' ? 'draw' : 'none';
        });
      });
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
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', height: '100%', flexDirection: 'column' }}>
      <div className="glass-panel" style={{ padding: '20px', zIndex: 1000, position: 'absolute', top: '20px', left: '20px', width: '300px' }}>
        <h3>Kreator Tras</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '16px' }}>
          Klikaj na mapie, aby wyrysować linię wyścigową (Polyline).
        </p>
        
        <input 
          className="custom-input" 
          placeholder="Nazwa trasy..." 
          value={trackName} 
          onChange={e => setTrackName(e.target.value)} 
          style={{ marginBottom: '12px' }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          <button className="btn-secondary" style={{ fontSize: '12px' }} onClick={handleLocate}>
            📍 Moja Lokalizacja
          </button>
          <button className="btn-secondary" style={{ fontSize: '12px' }} onClick={() => setLabelsVisible(!labelsVisible)}>
            🗺️ {labelsVisible ? 'Wyłącz' : 'Włącz'} Etykiety
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button 
            className={`btn-secondary ${mode === 'draw' ? 'active' : ''}`} 
            onClick={() => setMode('draw')}
          >
            Rysuj Trasę ({path.length} pkt)
          </button>
          
          <button 
            className={`btn-secondary ${mode === 's1' ? 'active' : ''}`} 
            onClick={() => setMode('s1')}
            disabled={path.length < 3}
          >
            Wybierz Sektor 1
          </button>

          <button 
            className={`btn-secondary ${mode === 's2' ? 'active' : ''}`} 
            onClick={() => setMode('s2')}
            disabled={!s1Index}
          >
            Wybierz Sektor 2
          </button>
        </div>

        <button className="btn-primary" style={{ width: '100%', marginTop: '20px' }} onClick={handleSave}>
          ZAPISZ TRASĘ
        </button>
      </div>

      <div ref={mapRef} style={{ flex: 1, width: '100%' }} />
    </div>
  );
}
