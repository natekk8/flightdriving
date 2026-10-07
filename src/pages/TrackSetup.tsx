import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import {
  calculateTrackCorners,
  getTrackLengthMeters,
  generateGateLine,
  isClosedCircuit,
  type Point,
} from '../lib/math';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench,
  Undo2,
  Redo2,
  Trash2,
  Save,
  MapPin,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Plus,
  Flag,
  Crosshair,
  List,
  CheckCircle2,
} from 'lucide-react';

interface HistoryState {
  path: Point[];
  s1Index?: number;
  s2Index?: number;
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
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Undo / Redo history
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);

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
  const s1IndexRef = useRef(s1Index);
  const s2IndexRef = useRef(s2Index);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  useEffect(() => {
    s1IndexRef.current = s1Index;
  }, [s1Index]);
  useEffect(() => {
    s2IndexRef.current = s2Index;
  }, [s2Index]);

  // Push state to undo stack
  const pushHistory = useCallback(
    (newPath: Point[], newS1?: number, newS2?: number) => {
      setHistory((prev) => [...prev.slice(-25), { path, s1Index, s2Index }]);
      setFuture([]);
      setPath(newPath);
      setS1Index(newS1);
      setS2Index(newS2);
    },
    [path, s1Index, s2Index]
  );

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [{ path, s1Index, s2Index }, ...f]);
    setPath(prev.path);
    setS1Index(prev.s1Index);
    setS2Index(prev.s2Index);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, { path, s1Index, s2Index }]);
    setPath(next.path);
    setS1Index(next.s1Index);
    setS2Index(next.s2Index);
  };

  // Corner analysis for current path
  const corners = useMemo(() => calculateTrackCorners(path), [path]);
  const totalLengthMeters = useMemo(() => getTrackLengthMeters(path), [path]);
  const isLoop = useMemo(() => isClosedCircuit(path), [path]);

  // Sector length breakdown
  const sectorLengths = useMemo(() => {
    if (path.length < 2) return null;
    const s1 = s1Index ?? path.length - 1;
    const s2 = s2Index ?? path.length - 1;

    const p1 = path.slice(0, Math.min(s1 + 1, path.length));
    const p2 = path.slice(Math.min(s1, path.length - 1), Math.min(s2 + 1, path.length));
    const p3 = path.slice(Math.min(s2, path.length - 1));

    const s1Len = getTrackLengthMeters(p1);
    const s2Len = getTrackLengthMeters(p2);
    const s3Len = getTrackLengthMeters(p3);

    return { s1Len, s2Len, s3Len, total: totalLengthMeters };
  }, [path, s1Index, s2Index, totalLengthMeters]);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // @ts-ignore
    leafletMap.current = L.map(mapRef.current, {
      zoomControl: false,
      maxBoundsViscosity: 1.0,
      rotate: true,
      touchRotate: true,
    } as any).setView([51.95, 20.15], 13);

    L.tileLayer('http://mt0.google.com/vt/lyrs=s&hl=pl&x={x}&y={y}&z={z}', {
      maxZoom: 24,
      maxNativeZoom: 21,
      className: 'map-tiles-dark',
    }).addTo(leafletMap.current);

    labelsLayer.current = L.tileLayer('http://mt0.google.com/vt/lyrs=h&hl=pl&x={x}&y={y}&z={z}', {
      maxZoom: 24,
      maxNativeZoom: 21,
    });

    layerGroup.current = L.layerGroup().addTo(leafletMap.current);

    // Initial geolocation center
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (leafletMap.current && pathRef.current.length === 0) {
            leafletMap.current.setView([pos.coords.latitude, pos.coords.longitude], 17);
          }
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }

    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  useEffect(() => {
    if (!leafletMap.current || !labelsLayer.current) return;
    if (labelsVisible) {
      if (!leafletMap.current.hasLayer(labelsLayer.current)) {
        labelsLayer.current.addTo(leafletMap.current);
      }
    } else {
      if (leafletMap.current.hasLayer(labelsLayer.current)) {
        leafletMap.current.removeLayer(labelsLayer.current);
      }
    }
  }, [labelsVisible]);

  // Render Polylines, Perpendicular Gate Lines, Markers
  useEffect(() => {
    if (!layerGroup.current) return;
    layerGroup.current.clearLayers();

    const s1 = s1Index ?? path.length;
    const s2 = s2Index ?? path.length;

    const p1 = path.slice(0, s1 + 1);
    const p2 = path.slice(s1, s2 + 1);
    const p3 = path.slice(s2, path.length);

    if (p1.length > 0) {
      L.polyline(p1 as any, { color: 'var(--f1-cyan)', weight: 5, opacity: 0.9 }).addTo(
        layerGroup.current
      );
    }
    if (p2.length > 0) {
      L.polyline(p2 as any, { color: 'var(--f1-red)', weight: 5, opacity: 0.9 }).addTo(
        layerGroup.current
      );
    }
    if (p3.length > 0) {
      L.polyline(p3 as any, { color: 'var(--f1-green)', weight: 5, opacity: 0.9 }).addTo(
        layerGroup.current
      );
    }

    // Render Gate Lines
    if (path.length >= 2) {
      // Start Gate Line
      const startGate = generateGateLine(path, 0, 36);
      L.polyline([
        [startGate[0].lat, startGate[0].lon],
        [startGate[1].lat, startGate[1].lon],
      ], { color: 'var(--f1-cyan)', weight: 3, dashArray: '4, 4' }).addTo(layerGroup.current);

      // S1 Gate Line
      if (s1Index !== undefined && s1Index > 0) {
        const s1Gate = generateGateLine(path, s1Index, 36);
        L.polyline([
          [s1Gate[0].lat, s1Gate[0].lon],
          [s1Gate[1].lat, s1Gate[1].lon],
        ], { color: 'var(--f1-red)', weight: 3, dashArray: '4, 4' }).addTo(layerGroup.current);
      }

      // S2 Gate Line
      if (s2Index !== undefined && s2Index > 0) {
        const s2Gate = generateGateLine(path, s2Index, 36);
        L.polyline([
          [s2Gate[0].lat, s2Gate[0].lon],
          [s2Gate[1].lat, s2Gate[1].lon],
        ], { color: 'var(--f1-yellow)', weight: 3, dashArray: '4, 4' }).addTo(layerGroup.current);
      }

      // Finish Gate Line
      const finishGate = generateGateLine(path, path.length - 1, 36);
      L.polyline([
        [finishGate[0].lat, finishGate[0].lon],
        [finishGate[1].lat, finishGate[1].lon],
      ], { color: 'var(--f1-green)', weight: 3, dashArray: '4, 4' }).addTo(layerGroup.current);
    }

    const cornerMap = new Map(corners.map((c) => [c.index, c]));

    path.forEach((pt, idx) => {
      const isStart = idx === 0;
      const isFinish = idx === path.length - 1;
      const isS1 = idx === s1Index;
      const isS2 = idx === s2Index;
      const corner = cornerMap.get(idx);

      let html = `<div style="width:10px;height:10px;border-radius:50%;background:#ffffff;border:2px solid var(--f1-cyan);box-shadow:0 0 8px var(--f1-cyan);"></div>`;
      let size = 12;

      if (isStart) {
        html = `<div style="background:#050608;color:var(--f1-cyan);border:2px solid var(--f1-cyan);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 14px var(--f1-cyan);">🏁 START</div>`;
        size = 24;
      } else if (isFinish) {
        html = `<div style="background:#050608;color:var(--f1-green);border:2px solid var(--f1-green);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 14px var(--f1-green);">🏁 FINISH</div>`;
        size = 24;
      } else if (isS1) {
        html = `<div style="background:#050608;color:var(--f1-red);border:2px solid var(--f1-red);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 14px var(--f1-red);">🚩 SEKTOR 1</div>`;
        size = 24;
      } else if (isS2) {
        html = `<div style="background:#050608;color:var(--f1-yellow);border:2px solid var(--f1-yellow);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 0 14px var(--f1-yellow);">🚩 SEKTOR 2</div>`;
        size = 24;
      } else if (corner) {
        const badgeColor =
          corner.severity === 'hairpin'
            ? 'var(--f1-red)'
            : corner.severity === 'sharp'
            ? 'var(--f1-yellow)'
            : 'var(--f1-cyan)';
        html = `<div style="background:rgba(5,6,8,0.9);color:${badgeColor};border:1px solid ${badgeColor};border-radius:4px;padding:2px 6px;font-size:9px;font-weight:800;white-space:nowrap;">${corner.label} (${corner.angleDegrees}°)</div>`;
        size = 18;
      }

      const icon = L.divIcon({ html, className: '', iconSize: [size, size] });
      const marker = L.marker([pt.lat, pt.lon], { icon, draggable: true }).addTo(layerGroup.current!);

      marker.on('dragend', (e: any) => {
        const newLatLng = e.target.getLatLng();
        const updated = [...pathRef.current];
        updated[idx] = { lat: newLatLng.lat, lon: newLatLng.lng };
        pushHistory(updated, s1IndexRef.current, s2IndexRef.current);
      });
    });
  }, [path, s1Index, s2Index, corners, pushHistory]);

  // Handle map click events
  useEffect(() => {
    if (!leafletMap.current) return;

    const clickHandler = (e: L.LeafletMouseEvent) => {
      const currentMode = modeRef.current;
      const currentPath = pathRef.current;

      if (currentMode === 'draw') {
        const updated = [...currentPath, { lat: e.latlng.lat, lon: e.latlng.lng }];
        pushHistory(updated, s1IndexRef.current, s2IndexRef.current);
        return;
      }

      // S1 or S2 placement: snap to nearest waypoint
      if ((currentMode === 's1' || currentMode === 's2') && currentPath.length > 2) {
        let nearestIdx = 1;
        let minDist = Infinity;
        for (let i = 1; i < currentPath.length - 1; i++) {
          const d = Math.hypot(currentPath[i].lat - e.latlng.lat, currentPath[i].lon - e.latlng.lng);
          if (d < minDist) {
            minDist = d;
            nearestIdx = i;
          }
        }

        if (currentMode === 's1') {
          pushHistory(currentPath, nearestIdx, s2IndexRef.current);
        } else {
          pushHistory(currentPath, s1IndexRef.current, nearestIdx);
        }
        setMode('draw');
      }
    };

    leafletMap.current.on('click', clickHandler);
    return () => {
      leafletMap.current?.off('click', clickHandler);
    };
  }, [pushHistory]);

  const handleCloseLoop = () => {
    if (path.length < 3) return;
    const startPt = path[0];
    const updated = [...path, { lat: startPt.lat, lon: startPt.lon }];
    pushHistory(updated, s1Index, s2Index);
  };

  const handleClearPath = () => {
    if (window.confirm('Czy na pewno chcesz wyczyścić wytyczoną trasę?')) {
      pushHistory([], undefined, undefined);
      setEditingTrackId(null);
      setTrackName('');
    }
  };

  const handleLocateMe = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (leafletMap.current) {
            leafletMap.current.setView([pos.coords.latitude, pos.coords.longitude], 18);
          }
        },
        () => alert('Nie udało się pobrać aktualnej pozycji GPS.')
      );
    }
  };

  const handleSave = async () => {
    if (!trackName.trim()) {
      alert('Wpisz nazwę trasy!');
      return;
    }
    if (path.length < 2) {
      alert('Trasa musi zawierać co najmniej 2 punkty!');
      return;
    }

    try {
      if (editingTrackId) {
        await updateTrack({
          id: editingTrackId as any,
          name: trackName,
          path,
          s1Index,
          s2Index,
        });
      } else {
        await saveTrack({
          name: trackName,
          path,
          s1Index,
          s2Index,
        });
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      console.error(e);
      alert('Błąd podczas zapisywania trasy.');
    }
  };

  const loadTrack = (track: any) => {
    setEditingTrackId(track._id);
    setTrackName(track.name);
    setPath(track.path || []);
    setS1Index(track.s1Index);
    setS2Index(track.s2Index);
    setHistory([]);
    setFuture([]);
    setShowTrackList(false);

    if (track.path && track.path.length > 0 && leafletMap.current) {
      const bounds = L.latLngBounds(track.path.map((p: any) => [p.lat, p.lon]));
      leafletMap.current.fitBounds(bounds, { padding: [40, 40] });
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Czy na pewno chcesz usunąć tę trasę?')) {
      await deleteTrack({ id: id as any });
      if (editingTrackId === id) {
        handleClearPath();
      }
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 65px)', overflow: 'hidden' }}>
      {/* Fullscreen Map Canvas */}
      <div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 0 }} />

      {/* Floating Left Control Panel (Doppelrand) */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          zIndex: 1000,
          width: 'clamp(320px, 35vw, 440px)',
          maxHeight: 'calc(100vh - 105px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div className="telemetry-card" style={{ padding: '20px' }}>
          {/* Card Header & Collapse Toggle */}
          <div className="card-header" style={{ marginBottom: panelCollapsed ? 0 : '16px' }}>
            <h3>
              <Wrench size={15} color="var(--f1-cyan)" /> KREATOR TRASY
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                className="btn-secondary"
                style={{ padding: '6px 10px', fontSize: '11px' }}
                onClick={() => setShowTrackList(!showTrackList)}
                title="Lista zapisanych tras"
              >
                <List size={13} />
              </button>
              <button
                className="btn-secondary"
                style={{ padding: '6px 10px', fontSize: '11px' }}
                onClick={() => setPanelCollapsed(!panelCollapsed)}
              >
                {panelCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {!panelCollapsed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
              >
                {/* Track Name Input */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '6px',
                      fontSize: '11px',
                      fontWeight: 800,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Nazwa Toru
                  </label>
                  <input
                    className="custom-input"
                    placeholder="Wpisz nazwę np. Tor Modlin GP..."
                    value={trackName}
                    onChange={(e) => setTrackName(e.target.value)}
                  />
                </div>

                {/* Mode Selector Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  <button
                    className={`btn-secondary ${mode === 'draw' ? 'btn-cyan' : ''}`}
                    style={{ padding: '10px 8px', fontSize: '11px' }}
                    onClick={() => setMode('draw')}
                  >
                    <Plus size={13} /> Rysuj
                  </button>
                  <button
                    className={`btn-secondary ${mode === 's1' ? 'btn-primary' : ''}`}
                    style={{ padding: '10px 8px', fontSize: '11px' }}
                    onClick={() => setMode('s1')}
                  >
                    <Flag size={13} /> Sektor 1
                  </button>
                  <button
                    className="btn-secondary"
                    style={{
                      padding: '10px 8px',
                      fontSize: '11px',
                      background: mode === 's2' ? 'rgba(245, 158, 11, 0.2)' : undefined,
                      borderColor: mode === 's2' ? 'var(--f1-yellow)' : undefined,
                      color: mode === 's2' ? 'var(--f1-yellow)' : undefined,
                    }}
                    onClick={() => setMode('s2')}
                  >
                    <Flag size={13} /> Sektor 2
                  </button>
                </div>

                {/* Track Metrics Card */}
                {sectorLengths && (
                  <div className="telemetry-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary)' }}>
                        DYSTANS CAŁKOWITY:
                      </span>
                      <span className="font-digital" style={{ fontSize: '14px', fontWeight: 800, color: 'var(--f1-cyan)' }}>
                        {sectorLengths.total} m ({ (sectorLengths.total / 1000).toFixed(2) } km)
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginTop: '4px' }}>
                      <div style={{ background: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: 'var(--f1-cyan)', fontWeight: 800 }}>S1</div>
                        <div className="font-digital" style={{ fontSize: '12px', fontWeight: 700 }}>{sectorLengths.s1Len}m</div>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: 'var(--f1-red)', fontWeight: 800 }}>S2</div>
                        <div className="font-digital" style={{ fontSize: '12px', fontWeight: 700 }}>{sectorLengths.s2Len}m</div>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: 'var(--f1-green)', fontWeight: 800 }}>S3</div>
                        <div className="font-digital" style={{ fontSize: '12px', fontWeight: 700 }}>{sectorLengths.s3Len}m</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Charakterystyka:</span>
                      <span style={{ color: isLoop ? 'var(--f1-green)' : 'var(--f1-cyan)', fontWeight: 700 }}>
                        {isLoop ? '🔄 Tor Zamknięty (Pętla)' : '🏁 Odcinek Otwarty (Sprint)'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Undo / Redo & Loop Actions */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1, padding: '8px', fontSize: '11px' }}
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    title="Cofnij zmianę"
                  >
                    <Undo2 size={13} /> Cofnij
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1, padding: '8px', fontSize: '11px' }}
                    onClick={handleRedo}
                    disabled={future.length === 0}
                    title="Ponów zmianę"
                  >
                    <Redo2 size={13} /> Ponów
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1.5, padding: '8px', fontSize: '11px', color: 'var(--f1-green)' }}
                    onClick={handleCloseLoop}
                    disabled={path.length < 3 || isLoop}
                    title="Połącz koniec z początkiem"
                  >
                    <RotateCw size={13} /> Zamknij Pętlę
                  </button>
                </div>

                {/* Save & Clear Buttons */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button
                    className="btn-primary"
                    style={{ flex: 2, padding: '12px', fontSize: '12px' }}
                    onClick={handleSave}
                  >
                    {saveSuccess ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={14} /> ZAPISANO!
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Save size={14} /> {editingTrackId ? 'AKTUALIZUJ TOR' : 'ZAPISZ NOWY TOR'}
                      </span>
                    )}
                  </button>
                  <button
                    className="btn-danger"
                    style={{ padding: '12px', fontSize: '12px' }}
                    onClick={handleClearPath}
                    title="Wyczyść trasę"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Saved Tracks Modal / Drawer */}
        <AnimatePresence>
          {showTrackList && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="telemetry-card"
              style={{ maxHeight: '320px', overflowY: 'auto' }}
            >
              <div className="card-header" style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary)' }}>
                  ZAPISANE TRASY ({tracks.length})
                </span>
                <button
                  className="btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '10px' }}
                  onClick={() => setShowTrackList(false)}
                >
                  Zamknij
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {tracks.map((t: any) => (
                  <div
                    key={t._id}
                    onClick={() => loadTrack(t)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: editingTrackId === t._id ? 'rgba(0, 240, 255, 0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${editingTrackId === t._id ? 'var(--f1-cyan)' : 'var(--border-subtle)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '13px', color: '#fff' }}>{t.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {t.path?.length || 0} punktów
                      </div>
                    </div>
                    <button
                      className="btn-danger"
                      style={{ padding: '6px 10px', fontSize: '10px' }}
                      onClick={(e) => handleDelete(t._id, e)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Map Controls (Top Right) */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <button
          className="btn-secondary"
          style={{
            padding: '10px 14px',
            fontSize: '11px',
            background: 'rgba(5, 7, 12, 0.85)',
            backdropFilter: 'blur(16px)',
          }}
          onClick={handleLocateMe}
          title="Centruj na mojej pozycji GPS"
        >
          <Crosshair size={14} color="var(--f1-cyan)" /> Mój GPS
        </button>

        <button
          className="btn-secondary"
          style={{
            padding: '10px 14px',
            fontSize: '11px',
            background: 'rgba(5, 7, 12, 0.85)',
            backdropFilter: 'blur(16px)',
          }}
          onClick={() => setLabelsVisible(!labelsVisible)}
          title="Przełącz ulice"
        >
          <MapPin size={14} /> {labelsVisible ? 'Ukryj Ulice' : 'Pokaż Ulice'}
        </button>
      </div>
    </div>
  );
}
