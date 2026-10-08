import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import {
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
  Map,
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
  Check,
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

  const totalLengthMeters = useMemo(() => getTrackLengthMeters(path), [path]);
  const isLoop = useMemo(() => isClosedCircuit(path), [path]);

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

    labelsLayer.current = L.tileLayer(
      'http://mt0.google.com/vt/lyrs=h&hl=pl&x={x}&y={y}&z={z}',
      {
        maxZoom: 24,
        maxNativeZoom: 21,
      }
    );

    layerGroup.current = L.layerGroup().addTo(leafletMap.current);

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

  // Render Polylines, Gates, Waypoints
  useEffect(() => {
    if (!layerGroup.current) return;
    layerGroup.current.clearLayers();

    const s1 = s1Index ?? path.length;
    const s2 = s2Index ?? path.length;

    const p1 = path.slice(0, s1 + 1);
    const p2 = path.slice(s1, s2 + 1);
    const p3 = path.slice(s2, path.length);

    if (p1.length > 1) {
      L.polyline(
        p1.map((p) => [p.lat, p.lon]),
        { color: '#38bdf8', weight: 4, opacity: 0.9 }
      ).addTo(layerGroup.current);
    }
    if (p2.length > 1) {
      L.polyline(
        p2.map((p) => [p.lat, p.lon]),
        { color: '#f59e0b', weight: 4, opacity: 0.9 }
      ).addTo(layerGroup.current);
    }
    if (p3.length > 1) {
      L.polyline(
        p3.map((p) => [p.lat, p.lon]),
        { color: '#10b981', weight: 4, opacity: 0.9 }
      ).addTo(layerGroup.current);
    }

    // Perpendicular gate lines (Start, S1, S2)
    const drawGate = (idx: number, color: string, label: string) => {
      if (path.length < 2 || idx < 0 || idx >= path.length) return;
      const [g1, g2] = generateGateLine(path, idx, 36);
      L.polyline(
        [
          [g1.lat, g1.lon],
          [g2.lat, g2.lon],
        ],
        { color, weight: 3, dashArray: '4, 4', opacity: 0.9 }
      )
        .bindTooltip(label, { permanent: true, direction: 'top', className: 'sector-badge' })
        .addTo(layerGroup.current!);
    };

    if (path.length > 1) {
      drawGate(0, '#10b981', 'START / META');
      if (s1Index !== undefined && s1Index > 0 && s1Index < path.length - 1) {
        drawGate(s1Index, '#38bdf8', 'SEKTOR 1');
      }
      if (s2Index !== undefined && s2Index > 0 && s2Index < path.length - 1) {
        drawGate(s2Index, '#f59e0b', 'SEKTOR 2');
      }
    }

    // Draggable point markers
    path.forEach((pt, i) => {
      let iconColor = 'rgba(255, 255, 255, 0.7)';
      let size = 12;

      if (i === 0) {
        iconColor = '#10b981';
        size = 18;
      } else if (i === s1Index) {
        iconColor = '#38bdf8';
        size = 16;
      } else if (i === s2Index) {
        iconColor = '#f59e0b';
        size = 16;
      }

      const iconHtml = `<div style="
        width: ${size}px;
        height: ${size}px;
        background: ${iconColor};
        border-radius: 50%;
        border: 2px solid #090a0f;
        box-shadow: 0 0 6px ${iconColor};
        cursor: grab;
      "></div>`;

      const marker = L.marker([pt.lat, pt.lon], {
        icon: L.divIcon({ html: iconHtml, className: '', iconSize: [size, size] }),
        draggable: true,
      });

      marker.on('dragend', (e) => {
        const newLatLng = e.target.getLatLng();
        const updated = [...pathRef.current];
        updated[i] = { lat: newLatLng.lat, lon: newLatLng.lng };
        pushHistory(updated, s1IndexRef.current, s2IndexRef.current);
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (modeRef.current === 's1') {
          if (i > 0 && (s2IndexRef.current === undefined || i < s2IndexRef.current)) {
            pushHistory(pathRef.current, i, s2IndexRef.current);
            setMode('draw');
          } else {
            alert('Punkt S1 musi znajdować się za startem i przed S2.');
          }
        } else if (modeRef.current === 's2') {
          if (i > (s1IndexRef.current ?? 0) && i < pathRef.current.length) {
            pushHistory(pathRef.current, s1IndexRef.current, i);
            setMode('draw');
          } else {
            alert('Punkt S2 musi znajdować się za punktem S1.');
          }
        }
      });

      marker.addTo(layerGroup.current!);
    });
  }, [path, s1Index, s2Index, pushHistory]);

  // Click handler on map to add points
  useEffect(() => {
    if (!leafletMap.current) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (modeRef.current === 'draw') {
        const newPt: Point = { lat: e.latlng.lat, lon: e.latlng.lng };
        pushHistory([...pathRef.current, newPt], s1IndexRef.current, s2IndexRef.current);
      }
    };

    leafletMap.current.on('click', onClick);
    return () => {
      leafletMap.current?.off('click', onClick);
    };
  }, [pushHistory]);

  const handleCloseLoop = () => {
    if (path.length < 3) return;
    const startPt = path[0];
    const updated = [...path, { lat: startPt.lat, lon: startPt.lon }];
    pushHistory(updated, s1Index, s2Index);
  };

  const handleClearPath = () => {
    if (window.confirm('Wyczyścić aktualną trasę?')) {
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
        () => alert('Nie udało się pobrać pozycji GPS.')
      );
    }
  };

  const handleSave = async () => {
    if (!trackName.trim()) {
      alert('Wpisz nazwę toru.');
      return;
    }
    if (path.length < 2) {
      alert('Tor musi zawierać co najmniej 2 punkty.');
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
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error(e);
      alert('Wystąpił błąd podczas zapisywania toru.');
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
    if (window.confirm('Usunąć ten tor?')) {
      await deleteTrack({ id: id as any });
      if (editingTrackId === id) {
        handleClearPath();
      }
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 58px)',
        overflow: 'hidden',
      }}
    >
      {/* Map Canvas */}
      <div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 0 }} />

      {/* Floating Control Panel */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 1000,
          width: 'clamp(300px, 90vw, 380px)',
          maxHeight: 'calc(100vh - 90px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div className="clean-card" style={{ padding: '16px' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: panelCollapsed ? 0 : '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Map size={16} style={{ color: 'var(--accent-green)' }} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>
                Kreator toru
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                className="btn-secondary"
                style={{ padding: '5px 8px', fontSize: '11px' }}
                onClick={() => setShowTrackList(!showTrackList)}
                title="Zapisane tory"
              >
                <List size={13} />
              </button>
              <button
                className="btn-secondary"
                style={{ padding: '5px 8px', fontSize: '11px' }}
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
                transition={{ duration: 0.18, ease: 'easeOut' }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                {/* Track Name */}
                <div>
                  <input
                    className="custom-input"
                    placeholder="Nazwa toru..."
                    value={trackName}
                    onChange={(e) => setTrackName(e.target.value)}
                  />
                </div>

                {/* Modes: Draw / S1 / S2 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '4px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    padding: '3px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setMode('draw')}
                    style={{
                      padding: '7px 4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: mode === 'draw' ? '#ffffff' : 'var(--text-secondary)',
                      background: mode === 'draw' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                      borderRadius: 'var(--radius-xs)',
                    }}
                  >
                    <Plus size={11} /> Rysuj
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('s1')}
                    style={{
                      padding: '7px 4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: mode === 's1' ? '#38bdf8' : 'var(--text-secondary)',
                      background: mode === 's1' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                      borderRadius: 'var(--radius-xs)',
                    }}
                  >
                    <Flag size={11} /> Sektor 1
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('s2')}
                    style={{
                      padding: '7px 4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: mode === 's2' ? '#f59e0b' : 'var(--text-secondary)',
                      background: mode === 's2' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                      borderRadius: 'var(--radius-xs)',
                    }}
                  >
                    <Flag size={11} /> Sektor 2
                  </button>
                </div>

                {/* Track Metrics */}
                {sectorLengths && (
                  <div
                    className="clean-card-inner"
                    style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span>Długość:</span>
                      <span className="font-digital" style={{ color: '#ffffff', fontWeight: 700 }}>
                        {sectorLengths.total} m {isLoop ? '(Pętla)' : '(Odcinek)'}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '4px',
                        marginTop: '2px',
                      }}
                    >
                      <div
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          padding: '4px',
                          borderRadius: '4px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '9px', color: '#38bdf8' }}>S1</div>
                        <div className="font-digital" style={{ fontSize: '11px' }}>
                          {sectorLengths.s1Len}m
                        </div>
                      </div>
                      <div
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          padding: '4px',
                          borderRadius: '4px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '9px', color: '#f59e0b' }}>S2</div>
                        <div className="font-digital" style={{ fontSize: '11px' }}>
                          {sectorLengths.s2Len}m
                        </div>
                      </div>
                      <div
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          padding: '4px',
                          borderRadius: '4px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '9px', color: '#10b981' }}>S3</div>
                        <div className="font-digital" style={{ fontSize: '11px' }}>
                          {sectorLengths.s3Len}m
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* History & Loop controls */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1, padding: '7px', fontSize: '11px' }}
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    title="Cofnij"
                  >
                    <Undo2 size={12} /> Cofnij
                  </button>

                  <button
                    className="btn-secondary"
                    style={{ flex: 1, padding: '7px', fontSize: '11px' }}
                    onClick={handleRedo}
                    disabled={future.length === 0}
                    title="Ponów"
                  >
                    <Redo2 size={12} /> Ponów
                  </button>

                  <button
                    className="btn-secondary"
                    style={{ flex: 1.2, padding: '7px', fontSize: '11px' }}
                    onClick={handleCloseLoop}
                    disabled={path.length < 3 || isLoop}
                    title="Połącz początek z końcem"
                  >
                    <RotateCw size={12} /> Pętla
                  </button>
                </div>

                {/* Save & Clear */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    className="btn-primary"
                    style={{ flex: 1, padding: '9px', fontSize: '12px' }}
                    onClick={handleSave}
                  >
                    {saveSuccess ? (
                      <>
                        <Check size={14} /> Zapisano!
                      </>
                    ) : (
                      <>
                        <Save size={14} /> {editingTrackId ? 'Zaktualizuj' : 'Zapisz tor'}
                      </>
                    )}
                  </motion.button>

                  <button
                    className="btn-danger"
                    style={{ padding: '9px 12px' }}
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

        {/* Saved Tracks List Modal / Drawer */}
        <AnimatePresence>
          {showTrackList && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="clean-card"
              style={{ maxHeight: '280px', overflowY: 'auto', padding: '14px' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Zapisane tory ({tracks.length})
                </span>
                <button
                  className="btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '10px' }}
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
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background:
                        editingTrackId === t._id
                          ? 'rgba(16, 185, 129, 0.12)'
                          : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${
                        editingTrackId === t._id ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'
                      }`,
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '12px', color: '#ffffff' }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {t.path?.length || 0} pkt
                      </div>
                    </div>
                    <button
                      className="btn-danger"
                      style={{ padding: '5px 8px', fontSize: '10px' }}
                      onClick={(e) => handleDelete(t._id, e)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating GPS & View Controls (Top Right) */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <button
          className="btn-secondary"
          style={{
            padding: '8px 12px',
            fontSize: '11px',
            background: 'rgba(9, 10, 15, 0.85)',
          }}
          onClick={handleLocateMe}
          title="Centruj na pozycji GPS"
        >
          <Crosshair size={13} style={{ color: 'var(--accent-green)' }} />
          <span>Moja pozycja</span>
        </button>

        <button
          className="btn-secondary"
          style={{
            padding: '8px 12px',
            fontSize: '11px',
            background: 'rgba(9, 10, 15, 0.85)',
          }}
          onClick={() => setLabelsVisible(!labelsVisible)}
          title="Przełącz nazwy ulic"
        >
          <MapPin size={13} />
          <span>{labelsVisible ? 'Ukryj ulice' : 'Pokaż ulice'}</span>
        </button>
      </div>
    </div>
  );
}
